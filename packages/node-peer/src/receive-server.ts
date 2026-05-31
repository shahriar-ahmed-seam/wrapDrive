/**
 * Node HTTP receive server implementing the WrapDrive v1 API.
 *
 * Hosts `/register`, `/info`, `/prepare-upload`, `/upload-chunk`, `/upload`,
 * and `/cancel`. Enforces the consent + PIN gate, per-file tokens with
 * sender-IP pinning, and the single-active-session lock. Used by both the
 * desktop main process and the web-host bridge.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  API_NAMESPACE,
  negotiate,
  parseCapabilities,
  parseDeviceInfo,
  parsePrepareUploadRequest,
  serializeDeviceInfo,
  serializePrepareUploadResult,
  type Capabilities,
  type DeviceInfo,
  type FileMeta,
  type PrepareUploadResult,
  type TransferPlan,
} from '@wrapdrive/protocol';
import { FileReceiver, receiveSingleStream, type FileAdapter } from '@wrapdrive/transfer-engine';
import { encodeAnnouncement } from './discovery.js';

/** A consent prompt the host UI must resolve. */
export interface ConsentRequest {
  from: DeviceInfo;
  files: FileMeta[];
  pinRequired: boolean;
}

/** The user's decision on a consent prompt. */
export interface ConsentDecision {
  accepted: boolean;
}

/** Host hooks the server calls into the surrounding app. */
export interface ReceiveServerHooks {
  requestConsent(req: ConsentRequest): Promise<ConsentDecision>;
  onRegister(info: DeviceInfo, capabilities: Capabilities, address: string): void;
  resolveDestination(fileName: string): string;
  getPin(): string | null;
  onFileDone?(finalPath: string): void;
  /** Optional: expose the current peer list as JSON (used by the web bridge). */
  listPeers?(): unknown;
}

interface FileState {
  token: string;
  meta: FileMeta;
  receiver: FileReceiver;
}

interface Session {
  sessionId: string;
  senderIp: string;
  plan: TransferPlan;
  files: Map<string, FileState>;
}

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 60_000;
const CONSENT_TIMEOUT_MS = 60_000;

/** The Node receive server. */
export class ReceiveServer {
  private server: Server | null = null;
  private session: Session | null = null;
  private readonly pinAttempts = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly self: DeviceInfo,
    private readonly capabilities: Capabilities,
    private readonly adapter: FileAdapter,
    private readonly hooks: ReceiveServerHooks,
  ) {}

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => void this.route(req, res));
      this.server.listen(port, () => resolve());
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  private send(res: ServerResponse, status: number, body = ''): void {
    res.writeHead(status, {
      'content-type': 'application/json',
      // Allow browser callers (the web app / web-host bridge); LAN-only posture.
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end(body);
  }

  private async readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  private clientIp(req: IncomingMessage): string {
    return (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'OPTIONS') {
        return this.send(res, 204);
      }
      if (path === `${API_NAMESPACE}/info` && req.method === 'GET') {
        return this.send(res, 200, serializeDeviceInfo(this.self));
      }
      if (path === `${API_NAMESPACE}/peers` && req.method === 'GET') {
        return this.send(res, 200, JSON.stringify(this.hooks.listPeers?.() ?? []));
      }
      if (path === `${API_NAMESPACE}/register` && req.method === 'POST') {
        return await this.handleRegister(req, res);
      }
      if (path === `${API_NAMESPACE}/prepare-upload` && req.method === 'POST') {
        return await this.handlePrepareUpload(req, res);
      }
      if (path === `${API_NAMESPACE}/upload-chunk` && req.method === 'POST') {
        return await this.handleUploadChunk(req, res, url);
      }
      if (path === `${API_NAMESPACE}/upload` && req.method === 'POST') {
        return await this.handleUpload(req, res, url);
      }
      if (path === `${API_NAMESPACE}/cancel` && req.method === 'POST') {
        const id = url.searchParams.get('sessionId');
        if (id && this.session?.sessionId === id) this.endSession();
        return this.send(res, 200, '"ok"');
      }
      this.send(res, 404, '"not found"');
    } catch {
      this.send(res, 500, '"error"');
    }
  }

  private async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await this.readBody(req)).toString('utf8');
    try {
      const obj = JSON.parse(body);
      const info = parseDeviceInfo(JSON.stringify(obj));
      const caps = parseCapabilities(JSON.stringify(obj.capabilities));
      this.hooks.onRegister(info, caps, this.clientIp(req));
    } catch {
      // ignore malformed register
    }
    this.send(res, 200, encodeAnnouncement(this.self, this.capabilities));
  }

  private async handlePrepareUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = this.clientIp(req);
    const body = (await this.readBody(req)).toString('utf8');
    const request = parsePrepareUploadRequest(body);

    const requiredPin = this.hooks.getPin();
    if (requiredPin !== null) {
      const entry = this.pinAttempts.get(ip);
      if (entry && entry.count >= PIN_MAX_ATTEMPTS && Date.now() < entry.until) {
        return this.send(res, 429, '"locked"');
      }
      if (request.pin !== requiredPin) {
        const count = (entry?.count ?? 0) + 1;
        this.pinAttempts.set(ip, { count, until: Date.now() + PIN_LOCKOUT_MS });
        return this.send(res, 401, '"pin"');
      }
      this.pinAttempts.delete(ip);
    }

    if (this.session) {
      return this.send(res, 409, '"busy"');
    }

    const files = Object.values(request.files);
    const decision = await this.withTimeout(
      this.hooks.requestConsent({ from: request.info, files, pinRequired: requiredPin !== null }),
      CONSENT_TIMEOUT_MS,
    );
    if (!decision || !decision.accepted) {
      return this.send(res, 403, '"declined"');
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const plan = negotiate(request.capabilities, this.capabilities, totalSize);

    const fileStates = new Map<string, FileState>();
    const tokens: Record<string, string> = {};
    for (const [id, meta] of Object.entries(request.files)) {
      const finalPath = this.hooks.resolveDestination(meta.fileName);
      const receiver = await FileReceiver.open(this.adapter, meta, finalPath, plan.chunkSize);
      const token = randomUUID();
      fileStates.set(id, { token, meta, receiver });
      tokens[id] = token;
    }

    this.session = { sessionId: randomUUID(), senderIp: ip, plan, files: fileStates };

    const result: PrepareUploadResult = {
      sessionId: this.session.sessionId,
      files: tokens,
      acceptedPlan: plan,
    };
    this.send(res, 200, serializePrepareUploadResult(result));
  }

  private authorize(url: URL, ip: string): FileState | null {
    const sessionId = url.searchParams.get('sessionId');
    const fileId = url.searchParams.get('fileId');
    const token = url.searchParams.get('token');
    if (!this.session || this.session.sessionId !== sessionId) return null;
    if (this.session.senderIp !== ip) return null;
    const file = fileId ? this.session.files.get(fileId) : undefined;
    if (!file || !token || file.token !== token) return null;
    return file;
  }

  private async handleUploadChunk(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const file = this.authorize(url, this.clientIp(req));
    if (!file) return this.send(res, 403, '"forbidden"');

    const offset = Number(url.searchParams.get('offset'));
    const length = Number(url.searchParams.get('length'));
    const chunkIndex = Number(url.searchParams.get('chunkIndex'));
    const body = await this.readBody(req);

    try {
      const outcome = await file.receiver.receiveChunk({
        index: chunkIndex,
        offset,
        length,
        data: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      });
      if (outcome.state === 'done') this.hooks.onFileDone?.(outcome.finalPath);
      this.send(res, 200, '"ok"');
    } catch {
      this.send(res, 400, '"bad chunk"');
    }
  }

  private async handleUpload(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const file = this.authorize(url, this.clientIp(req));
    if (!file) return this.send(res, 403, '"forbidden"');
    const finalPath = this.hooks.resolveDestination(file.meta.fileName);
    async function* body(): AsyncIterable<Uint8Array> {
      for await (const c of req) yield new Uint8Array(c as Buffer);
    }
    try {
      const outcome = await receiveSingleStream(file.meta, finalPath, body(), this.adapter);
      if (outcome.state === 'done') {
        this.hooks.onFileDone?.(outcome.finalPath);
        this.send(res, 200, '"ok"');
      } else {
        this.send(res, 400, '"incomplete"');
      }
    } catch {
      this.send(res, 400, '"failed"');
    }
  }

  private endSession(): void {
    this.session = null;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return Promise.race([
      promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  }
}
