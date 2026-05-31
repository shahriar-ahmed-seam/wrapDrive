/**
 * High-level Node peer: wires discovery, the receive server, and the sender
 * into one object the host app (Electron main or web-host) drives.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  API_NAMESPACE,
  negotiate,
  parsePrepareUploadResult,
  serializePrepareUploadRequest,
  type Capabilities,
  type DeviceInfo,
  type FileMeta,
  type PrepareUploadRequest,
} from '@wrapdrive/protocol';
import {
  NodeFileAdapter,
  sendParallel,
  sendSingleStream,
  type LocalFile,
} from '@wrapdrive/transfer-engine';
import { Discovery, encodeAnnouncement, type NodePeer } from './discovery.js';
import { HttpSenderTransport } from './http-sender-transport.js';
import { ReceiveServer, type ConsentDecision, type ConsentRequest } from './receive-server.js';

/** Callbacks the host app provides to the peer. */
export interface PeerHooks {
  requestConsent(req: ConsentRequest): Promise<ConsentDecision>;
  resolveDestination(fileName: string): string;
  getPin(): string | null;
  onPeers?(peers: NodePeer[]): void;
  onProgress?(fileName: string, fraction: number, bytesPerSecond: number): void;
  onFileReceived?(finalPath: string): void;
}

/** Progress shape emitted while sending. */
export interface SendProgress {
  completed: number;
  total: number;
  bytes: number;
}

/** A running WrapDrive peer hosted in Node. */
export class Peer {
  private readonly adapter = new NodeFileAdapter();
  private readonly discovery: Discovery;
  private readonly server: ReceiveServer;

  constructor(
    private readonly self: DeviceInfo,
    private readonly capabilities: Capabilities,
    private readonly hooks: PeerHooks,
  ) {
    this.discovery = new Discovery(self, capabilities, (address) => {
      // Two-way register so the announcing peer learns about us.
      void this.registerWith(address);
    });
    this.server = new ReceiveServer(self, capabilities, this.adapter, {
      requestConsent: hooks.requestConsent,
      onRegister: (info, caps, address) => this.discovery.recordPeer(info, caps, address),
      resolveDestination: hooks.resolveDestination,
      getPin: hooks.getPin,
      onFileDone: hooks.onFileReceived,
    });
  }

  async start(): Promise<void> {
    await this.server.listen(this.self.port);
    this.discovery.start();
    if (this.hooks.onPeers) this.discovery.onPeersChanged(this.hooks.onPeers);
  }

  async stop(): Promise<void> {
    this.discovery.stop();
    await this.server.close();
  }

  getPeers(): NodePeer[] {
    return this.discovery.getPeers();
  }

  /** Send a file on disk to a peer, negotiating and driving progress. */
  async sendFile(peer: NodePeer, filePath: string): Promise<void> {
    const info = await stat(filePath);
    const size = info.size;
    const sha256 = await this.hashFile(filePath);
    const fileName = basename(filePath);
    const meta: FileMeta = {
      id: 'file-1',
      fileName,
      size,
      fileType: 'application/octet-stream',
      sha256,
      preview: null,
    };

    const baseUrl = `http://${peer.address}:${peer.info.port}`;
    const plan = negotiate(this.capabilities, peer.capabilities, size);
    const request: PrepareUploadRequest = {
      info: this.self,
      capabilities: this.capabilities,
      files: { [meta.id]: meta },
      proposedPlan: plan,
    };

    const prepRes = await fetch(`${baseUrl}${API_NAMESPACE}/prepare-upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: serializePrepareUploadRequest(request),
    });
    if (!prepRes.ok) throw new Error(`prepare-upload failed: ${prepRes.status}`);
    const result = parsePrepareUploadResult(await prepRes.text());
    const token = result.files[meta.id];
    if (!token) throw new Error('no token issued');

    const target = { sessionId: result.sessionId, fileId: meta.id, token };
    const localFile: LocalFile = { path: filePath, size };
    const transport = new HttpSenderTransport(baseUrl);

    if (result.acceptedPlan.mode === 'parallel-chunked') {
      await sendParallel(target, localFile, result.acceptedPlan, this.adapter, transport, {
        onProgress: (completed, total, bytes) => {
          this.hooks.onProgress?.(fileName, completed / total, this.speed(bytes));
        },
      });
    } else {
      await sendSingleStream(target, localFile, this.adapter, transport);
      this.hooks.onProgress?.(fileName, 1, 0);
    }
  }

  private async registerWith(address: string): Promise<void> {
    const url = `http://${address}:${this.self.port}${API_NAMESPACE}/register`;
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: encodeAnnouncement(this.self, this.capabilities),
    }).catch(() => undefined);
  }

  private async hashFile(path: string): Promise<string> {
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      createReadStream(path)
        .on('data', (d) => hash.update(d))
        .on('end', () => resolve())
        .on('error', reject);
    });
    return hash.digest('hex');
  }

  private lastBytes = 0;
  private lastTime = Date.now();
  private speed(bytes: number): number {
    const now = Date.now();
    const dt = (now - this.lastTime) / 1000;
    if (dt <= 0) return 0;
    const bps = (bytes - this.lastBytes) / dt;
    this.lastBytes = bytes;
    this.lastTime = now;
    return Math.max(0, Math.round(bps));
  }
}
