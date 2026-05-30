/**
 * Capability negotiation.
 *
 * {@link negotiate} is a pure function of both peers' capabilities and the file
 * size. It is the single point that enforces the WrapDrive guarantee that
 * parallel chunking is used *only* when both sides genuinely support it;
 * otherwise both sides agree on a single-stream fallback. See section 5 of
 * `protocol-spec/wrapdrive-protocol-v1.md`.
 *
 * The function performs no I/O and mutates no external state, so it is fully
 * unit- and property-testable.
 */

import type { Capabilities, TransferPlan } from './models.js';

/** Default chunk size before clamping: 4 MiB. */
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

/** Upper bound on the number of chunks a single file is split into. */
export const MAX_CHUNK_COUNT = 10_000;

/** Clamp `value` into the inclusive range `[low, high]`. */
function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** The sorted intersection of two string lists (ascending). */
function intersectVersions(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b);
  return a.filter((v) => set.has(v)).sort();
}

/**
 * Choose the chunk size for a parallel-chunked plan.
 *
 * Starts from {@link DEFAULT_CHUNK_SIZE} clamped into the overlapping range
 * `[low, high]`. If the file would then split into more than
 * {@link MAX_CHUNK_COUNT} chunks, the size is raised to the smallest value that
 * keeps the count at or below the cap, still bounded by `high`.
 */
function chooseChunkSize(fileSize: number, low: number, high: number): number {
  let chunkSize = clamp(DEFAULT_CHUNK_SIZE, low, high);
  if (fileSize > chunkSize * MAX_CHUNK_COUNT) {
    const needed = Math.ceil(fileSize / MAX_CHUNK_COUNT);
    chunkSize = clamp(needed, low, high);
  }
  return chunkSize;
}

/** Build the single-stream fallback plan for a file of the given size. */
function singleStreamPlan(fileSize: number): TransferPlan {
  return {
    mode: 'single-stream',
    chunkSize: fileSize,
    parallelism: 1,
    chunkProtocolVersion: null,
  };
}

/**
 * Resolve the strongest safe {@link TransferPlan} for a transfer.
 *
 * The result is `parallel-chunked` if and only if **all** hold:
 *  1. `sender.parallelChunkedSend`,
 *  2. `receiver.parallelChunkedReceive`,
 *  3. the peers share at least one chunk-protocol version,
 *  4. the chunk-size ranges overlap, and
 *  5. `fileSize` exceeds the negotiated chunk size.
 *
 * Otherwise the result is `single-stream` (chunkSize = fileSize, parallelism =
 * 1, chunkProtocolVersion = null).
 *
 * @param sender   the sending peer's capabilities
 * @param receiver the receiving peer's capabilities
 * @param fileSize the size of the file to transfer, in bytes (>= 0)
 */
export function negotiate(
  sender: Capabilities,
  receiver: Capabilities,
  fileSize: number,
): TransferPlan {
  const commonVersions = intersectVersions(
    sender.chunkProtocolVersions,
    receiver.chunkProtocolVersions,
  );

  const bothCanChunk =
    sender.parallelChunkedSend && receiver.parallelChunkedReceive && commonVersions.length > 0;

  const low = Math.max(sender.minChunkSize, receiver.minChunkSize);
  const high = Math.min(sender.maxChunkSize, receiver.maxChunkSize);
  const rangesOverlap = low <= high;

  if (!bothCanChunk || !rangesOverlap) {
    return singleStreamPlan(fileSize);
  }

  const chunkSize = chooseChunkSize(fileSize, low, high);

  // A file that fits in a single chunk gains nothing from chunking.
  if (fileSize <= chunkSize) {
    return singleStreamPlan(fileSize);
  }

  const parallelism = Math.max(
    1,
    Math.min(sender.maxParallelConnections, receiver.maxParallelConnections),
  );

  // Highest common version (the intersection is sorted ascending).
  const chunkProtocolVersion = commonVersions[commonVersions.length - 1] as string;

  return {
    mode: 'parallel-chunked',
    chunkSize,
    parallelism,
    chunkProtocolVersion,
  };
}
