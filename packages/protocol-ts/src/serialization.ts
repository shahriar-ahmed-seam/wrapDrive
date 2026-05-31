/**
 * Canonical JSON serialization for WrapDrive protocol messages.
 *
 * Serialization is *canonical*: object keys are emitted in a fixed order and
 * map/record keys are sorted, so the TypeScript and Kotlin implementations
 * produce byte-identical UTF-8 JSON for the same message (the conformance
 * guarantee in section 9 of the protocol spec). Round-tripping preserves every
 * field, including explicit `null`s and absent optional fields.
 */

import type {
  Capabilities,
  ChunkRef,
  DeviceInfo,
  FileMeta,
  PrepareUploadRequest,
  PrepareUploadResult,
  TransferPlan,
  TransferProgress,
} from './models.js';

/** Raised when {@link parse} receives JSON that is not the expected shape. */
export class ProtocolParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolParseError';
  }
}

/** A JSON value, used for the intermediate canonical representation. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// --- Canonical object builders (fixed key order) ---------------------------

function canonicalDeviceInfo(info: DeviceInfo): Json {
  return {
    alias: info.alias,
    version: info.version,
    deviceModel: info.deviceModel,
    deviceType: info.deviceType,
    fingerprint: info.fingerprint,
    port: info.port,
    protocol: info.protocol,
    download: info.download,
  };
}

function canonicalCapabilities(caps: Capabilities): Json {
  return {
    appProtocol: caps.appProtocol,
    parallelChunkedSend: caps.parallelChunkedSend,
    parallelChunkedReceive: caps.parallelChunkedReceive,
    maxParallelConnections: caps.maxParallelConnections,
    minChunkSize: caps.minChunkSize,
    maxChunkSize: caps.maxChunkSize,
    chunkProtocolVersions: [...caps.chunkProtocolVersions],
  };
}

function canonicalTransferPlan(plan: TransferPlan): Json {
  return {
    mode: plan.mode,
    chunkSize: plan.chunkSize,
    parallelism: plan.parallelism,
    chunkProtocolVersion: plan.chunkProtocolVersion,
  };
}

function canonicalFileMeta(file: FileMeta): Json {
  return {
    id: file.id,
    fileName: file.fileName,
    size: file.size,
    fileType: file.fileType,
    sha256: file.sha256,
    preview: file.preview,
  };
}

function canonicalChunkRef(chunk: ChunkRef): Json {
  const out: { [key: string]: Json } = {
    index: chunk.index,
    offset: chunk.offset,
    length: chunk.length,
  };
  if (chunk.sha256 !== undefined) {
    out.sha256 = chunk.sha256;
  }
  return out;
}

/** Build a key-sorted canonical object from a record of canonical values. */
function canonicalRecord<T>(record: Record<string, T>, map: (value: T) => Json): Json {
  // Use a null-prototype object so reserved keys such as `__proto__` become
  // ordinary own properties instead of mutating the prototype chain.
  const out: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
  for (const key of Object.keys(record).sort()) {
    out[key] = map(record[key] as T);
  }
  return out;
}

function canonicalPrepareUploadRequest(req: PrepareUploadRequest): Json {
  const out: { [key: string]: Json } = {
    info: canonicalDeviceInfo(req.info),
    capabilities: canonicalCapabilities(req.capabilities),
    files: canonicalRecord(req.files, canonicalFileMeta),
    proposedPlan: canonicalTransferPlan(req.proposedPlan),
  };
  if (req.pin !== undefined) {
    out.pin = req.pin;
  }
  return out;
}

function canonicalPrepareUploadResult(res: PrepareUploadResult): Json {
  return {
    sessionId: res.sessionId,
    files: canonicalRecord(res.files, (token) => token),
    acceptedPlan: canonicalTransferPlan(res.acceptedPlan),
  };
}

function canonicalTransferProgress(progress: TransferProgress): Json {
  return {
    sessionId: progress.sessionId,
    fileId: progress.fileId,
    bytesTransferred: progress.bytesTransferred,
    totalBytes: progress.totalBytes,
    chunksCompleted: progress.chunksCompleted,
    totalChunks: progress.totalChunks,
    bytesPerSecond: progress.bytesPerSecond,
    state: progress.state,
  };
}

// --- Serializers -----------------------------------------------------------

const serializeCanonical = (value: Json): string => JSON.stringify(value);

/** Serialize a {@link DeviceInfo} to canonical UTF-8 JSON. */
export const serializeDeviceInfo = (info: DeviceInfo): string =>
  serializeCanonical(canonicalDeviceInfo(info));

/** Serialize a {@link Capabilities} to canonical UTF-8 JSON. */
export const serializeCapabilities = (caps: Capabilities): string =>
  serializeCanonical(canonicalCapabilities(caps));

/** Serialize a {@link TransferPlan} to canonical UTF-8 JSON. */
export const serializeTransferPlan = (plan: TransferPlan): string =>
  serializeCanonical(canonicalTransferPlan(plan));

/** Serialize a {@link FileMeta} to canonical UTF-8 JSON. */
export const serializeFileMeta = (file: FileMeta): string =>
  serializeCanonical(canonicalFileMeta(file));

/** Serialize a {@link ChunkRef} to canonical UTF-8 JSON. */
export const serializeChunkRef = (chunk: ChunkRef): string =>
  serializeCanonical(canonicalChunkRef(chunk));

/** Serialize a {@link PrepareUploadRequest} to canonical UTF-8 JSON. */
export const serializePrepareUploadRequest = (req: PrepareUploadRequest): string =>
  serializeCanonical(canonicalPrepareUploadRequest(req));

/** Serialize a {@link PrepareUploadResult} to canonical UTF-8 JSON. */
export const serializePrepareUploadResult = (res: PrepareUploadResult): string =>
  serializeCanonical(canonicalPrepareUploadResult(res));

/** Serialize a {@link TransferProgress} to canonical UTF-8 JSON. */
export const serializeTransferProgress = (progress: TransferProgress): string =>
  serializeCanonical(canonicalTransferProgress(progress));

// --- Parse helpers ---------------------------------------------------------

function asObject(value: unknown, context: string): { [key: string]: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolParseError(`${context}: expected an object`);
  }
  return value as { [key: string]: unknown };
}

function asString(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new ProtocolParseError(`${context}: expected a string`);
  }
  return value;
}

function asNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProtocolParseError(`${context}: expected a finite number`);
  }
  return value;
}

function asBoolean(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ProtocolParseError(`${context}: expected a boolean`);
  }
  return value;
}

function asStringOrNull(value: unknown, context: string): string | null {
  return value === null ? null : asString(value, context);
}

// --- Parsers (from a plain JS value) ---------------------------------------

function readDeviceInfo(value: unknown): DeviceInfo {
  const o = asObject(value, 'DeviceInfo');
  return {
    alias: asString(o.alias, 'DeviceInfo.alias'),
    version: asString(o.version, 'DeviceInfo.version'),
    deviceModel: asStringOrNull(o.deviceModel, 'DeviceInfo.deviceModel'),
    deviceType: asStringOrNull(o.deviceType, 'DeviceInfo.deviceType') as DeviceInfo['deviceType'],
    fingerprint: asString(o.fingerprint, 'DeviceInfo.fingerprint'),
    port: asNumber(o.port, 'DeviceInfo.port'),
    protocol: asString(o.protocol, 'DeviceInfo.protocol') as DeviceInfo['protocol'],
    download: asBoolean(o.download, 'DeviceInfo.download'),
  };
}

function readCapabilities(value: unknown): Capabilities {
  const o = asObject(value, 'Capabilities');
  const versions = o.chunkProtocolVersions;
  if (!Array.isArray(versions)) {
    throw new ProtocolParseError('Capabilities.chunkProtocolVersions: expected an array');
  }
  return {
    appProtocol: asString(o.appProtocol, 'Capabilities.appProtocol'),
    parallelChunkedSend: asBoolean(o.parallelChunkedSend, 'Capabilities.parallelChunkedSend'),
    parallelChunkedReceive: asBoolean(
      o.parallelChunkedReceive,
      'Capabilities.parallelChunkedReceive',
    ),
    maxParallelConnections: asNumber(
      o.maxParallelConnections,
      'Capabilities.maxParallelConnections',
    ),
    minChunkSize: asNumber(o.minChunkSize, 'Capabilities.minChunkSize'),
    maxChunkSize: asNumber(o.maxChunkSize, 'Capabilities.maxChunkSize'),
    chunkProtocolVersions: versions.map((v, i) =>
      asString(v, `Capabilities.chunkProtocolVersions[${i}]`),
    ),
  };
}

function readTransferPlan(value: unknown): TransferPlan {
  const o = asObject(value, 'TransferPlan');
  return {
    mode: asString(o.mode, 'TransferPlan.mode') as TransferPlan['mode'],
    chunkSize: asNumber(o.chunkSize, 'TransferPlan.chunkSize'),
    parallelism: asNumber(o.parallelism, 'TransferPlan.parallelism'),
    chunkProtocolVersion: asStringOrNull(
      o.chunkProtocolVersion,
      'TransferPlan.chunkProtocolVersion',
    ),
  };
}

function readFileMeta(value: unknown): FileMeta {
  const o = asObject(value, 'FileMeta');
  return {
    id: asString(o.id, 'FileMeta.id'),
    fileName: asString(o.fileName, 'FileMeta.fileName'),
    size: asNumber(o.size, 'FileMeta.size'),
    fileType: asString(o.fileType, 'FileMeta.fileType'),
    sha256: asStringOrNull(o.sha256, 'FileMeta.sha256'),
    preview: asStringOrNull(o.preview, 'FileMeta.preview'),
  };
}

function readChunkRef(value: unknown): ChunkRef {
  const o = asObject(value, 'ChunkRef');
  const chunk: ChunkRef = {
    index: asNumber(o.index, 'ChunkRef.index'),
    offset: asNumber(o.offset, 'ChunkRef.offset'),
    length: asNumber(o.length, 'ChunkRef.length'),
  };
  if (o.sha256 !== undefined) {
    chunk.sha256 = asString(o.sha256, 'ChunkRef.sha256');
  }
  return chunk;
}

function readRecord<T>(
  value: unknown,
  context: string,
  read: (item: unknown) => T,
): Record<string, T> {
  const o = asObject(value, context);
  // Null-prototype result so keys like `__proto__` round-trip as own keys.
  const out: Record<string, T> = Object.create(null) as Record<string, T>;
  for (const key of Object.keys(o)) {
    out[key] = read(o[key]);
  }
  return out;
}

function readPrepareUploadRequest(value: unknown): PrepareUploadRequest {
  const o = asObject(value, 'PrepareUploadRequest');
  const req: PrepareUploadRequest = {
    info: readDeviceInfo(o.info),
    capabilities: readCapabilities(o.capabilities),
    files: readRecord(o.files, 'PrepareUploadRequest.files', readFileMeta),
    proposedPlan: readTransferPlan(o.proposedPlan),
  };
  if (o.pin !== undefined) {
    req.pin = asString(o.pin, 'PrepareUploadRequest.pin');
  }
  return req;
}

function readPrepareUploadResult(value: unknown): PrepareUploadResult {
  const o = asObject(value, 'PrepareUploadResult');
  return {
    sessionId: asString(o.sessionId, 'PrepareUploadResult.sessionId'),
    files: readRecord(o.files, 'PrepareUploadResult.files', (token) =>
      asString(token, 'PrepareUploadResult.files[value]'),
    ),
    acceptedPlan: readTransferPlan(o.acceptedPlan),
  };
}

function readTransferProgress(value: unknown): TransferProgress {
  const o = asObject(value, 'TransferProgress');
  return {
    sessionId: asString(o.sessionId, 'TransferProgress.sessionId'),
    fileId: asString(o.fileId, 'TransferProgress.fileId'),
    bytesTransferred: asNumber(o.bytesTransferred, 'TransferProgress.bytesTransferred'),
    totalBytes: asNumber(o.totalBytes, 'TransferProgress.totalBytes'),
    chunksCompleted: asNumber(o.chunksCompleted, 'TransferProgress.chunksCompleted'),
    totalChunks: asNumber(o.totalChunks, 'TransferProgress.totalChunks'),
    bytesPerSecond: asNumber(o.bytesPerSecond, 'TransferProgress.bytesPerSecond'),
    state: asString(o.state, 'TransferProgress.state') as TransferProgress['state'],
  };
}

function parseJson(json: string, context: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new ProtocolParseError(`${context}: invalid JSON`);
  }
}

// --- Public parsers --------------------------------------------------------

/** Parse canonical JSON into a {@link DeviceInfo}. */
export const parseDeviceInfo = (json: string): DeviceInfo =>
  readDeviceInfo(parseJson(json, 'DeviceInfo'));

/** Parse canonical JSON into a {@link Capabilities}. */
export const parseCapabilities = (json: string): Capabilities =>
  readCapabilities(parseJson(json, 'Capabilities'));

/** Parse canonical JSON into a {@link TransferPlan}. */
export const parseTransferPlan = (json: string): TransferPlan =>
  readTransferPlan(parseJson(json, 'TransferPlan'));

/** Parse canonical JSON into a {@link FileMeta}. */
export const parseFileMeta = (json: string): FileMeta => readFileMeta(parseJson(json, 'FileMeta'));

/** Parse canonical JSON into a {@link ChunkRef}. */
export const parseChunkRef = (json: string): ChunkRef => readChunkRef(parseJson(json, 'ChunkRef'));

/** Parse canonical JSON into a {@link PrepareUploadRequest}. */
export const parsePrepareUploadRequest = (json: string): PrepareUploadRequest =>
  readPrepareUploadRequest(parseJson(json, 'PrepareUploadRequest'));

/** Parse canonical JSON into a {@link PrepareUploadResult}. */
export const parsePrepareUploadResult = (json: string): PrepareUploadResult =>
  readPrepareUploadResult(parseJson(json, 'PrepareUploadResult'));

/** Parse canonical JSON into a {@link TransferProgress}. */
export const parseTransferProgress = (json: string): TransferProgress =>
  readTransferProgress(parseJson(json, 'TransferProgress'));
