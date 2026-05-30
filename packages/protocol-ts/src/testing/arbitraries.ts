/**
 * fast-check arbitraries for WrapDrive protocol models.
 *
 * These generators are shared across property-based tests in this package.
 * They intentionally explore the full value space (including `null` optionals
 * and Unicode strings) so round-trip and validation properties are exercised
 * broadly.
 */

import fc from 'fast-check';
import { APP_PROTOCOL } from '../constants.js';
import type {
  Capabilities,
  ChunkRef,
  DeviceInfo,
  FileMeta,
  PrepareUploadRequest,
  PrepareUploadResult,
  TransferPlan,
  TransferProgress,
} from '../models.js';

const deviceType = fc.constantFrom(
  'mobile',
  'desktop',
  'web',
  'headless',
  'server',
) as fc.Arbitrary<DeviceInfo['deviceType']>;

const protocol = fc.constantFrom('http', 'https') as fc.Arbitrary<DeviceInfo['protocol']>;

const transferMode = fc.constantFrom('parallel-chunked', 'single-stream') as fc.Arbitrary<
  TransferPlan['mode']
>;

const transferState = fc.constantFrom(
  'negotiating',
  'transferring',
  'verifying',
  'done',
  'failed',
  'cancelled',
) as fc.Arbitrary<TransferProgress['state']>;

/** Non-negative safe integer, used for sizes/offsets/counts. */
const nat = fc.nat({ max: Number.MAX_SAFE_INTEGER });

/** Arbitrary {@link DeviceInfo} spanning valid and edge-case shapes. */
export const arbDeviceInfo: fc.Arbitrary<DeviceInfo> = fc.record({
  alias: fc.string(),
  version: fc.string(),
  deviceModel: fc.option(fc.string(), { nil: null }),
  deviceType: fc.option(deviceType, { nil: null }),
  fingerprint: fc.string(),
  port: fc.integer({ min: 0, max: 65535 }),
  protocol,
  download: fc.boolean(),
});

/** Arbitrary {@link Capabilities} with the WrapDrive app protocol. */
export const arbCapabilities: fc.Arbitrary<Capabilities> = fc.record({
  appProtocol: fc.constant(APP_PROTOCOL),
  parallelChunkedSend: fc.boolean(),
  parallelChunkedReceive: fc.boolean(),
  maxParallelConnections: fc.integer({ min: 1, max: 16 }),
  minChunkSize: fc.integer({ min: 1, max: 1_048_576 }),
  maxChunkSize: fc.integer({ min: 1, max: 67_108_864 }),
  chunkProtocolVersions: fc.array(fc.string(), { maxLength: 4 }),
});

/** Arbitrary {@link TransferPlan}. */
export const arbTransferPlan: fc.Arbitrary<TransferPlan> = fc.record({
  mode: transferMode,
  chunkSize: nat,
  parallelism: fc.integer({ min: 1, max: 16 }),
  chunkProtocolVersion: fc.option(fc.string(), { nil: null }),
});

/** Arbitrary {@link FileMeta}. */
export const arbFileMeta: fc.Arbitrary<FileMeta> = fc.record({
  id: fc.string(),
  fileName: fc.string(),
  size: nat,
  fileType: fc.string(),
  sha256: fc.option(fc.hexaString({ minLength: 64, maxLength: 64 }), { nil: null }),
  preview: fc.option(fc.string(), { nil: null }),
});

/** Arbitrary {@link ChunkRef}; the optional `sha256` is present ~half the time. */
export const arbChunkRef: fc.Arbitrary<ChunkRef> = fc
  .record({
    index: nat,
    offset: nat,
    length: nat,
    sha256: fc.option(fc.hexaString({ minLength: 64, maxLength: 64 }), { nil: undefined }),
  })
  .map((c) => {
    const chunk: ChunkRef = { index: c.index, offset: c.offset, length: c.length };
    if (c.sha256 !== undefined) {
      chunk.sha256 = c.sha256;
    }
    return chunk;
  });

const arbFileRecord = fc.dictionary(fc.string(), arbFileMeta, { maxKeys: 4 });

/** Arbitrary {@link PrepareUploadRequest}; the optional `pin` may be absent. */
export const arbPrepareUploadRequest: fc.Arbitrary<PrepareUploadRequest> = fc
  .record({
    info: arbDeviceInfo,
    capabilities: arbCapabilities,
    files: arbFileRecord,
    proposedPlan: arbTransferPlan,
    pin: fc.option(fc.string(), { nil: undefined }),
  })
  .map((r) => {
    const req: PrepareUploadRequest = {
      info: r.info,
      capabilities: r.capabilities,
      files: r.files,
      proposedPlan: r.proposedPlan,
    };
    if (r.pin !== undefined) {
      req.pin = r.pin;
    }
    return req;
  });

/** Arbitrary {@link PrepareUploadResult}. */
export const arbPrepareUploadResult: fc.Arbitrary<PrepareUploadResult> = fc.record({
  sessionId: fc.string(),
  files: fc.dictionary(fc.string(), fc.string(), { maxKeys: 4 }),
  acceptedPlan: arbTransferPlan,
});

/** Arbitrary {@link TransferProgress}. */
export const arbTransferProgress: fc.Arbitrary<TransferProgress> = fc.record({
  sessionId: fc.string(),
  fileId: fc.string(),
  bytesTransferred: nat,
  totalBytes: nat,
  chunksCompleted: nat,
  totalChunks: nat,
  bytesPerSecond: nat,
  state: transferState,
});
