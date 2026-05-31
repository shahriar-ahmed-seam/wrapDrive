/**
 * Receiver-side chunk assembly with implicit reassembly.
 *
 * On accepting a parallel-chunked file the receiver pre-allocates the
 * destination to its full size, then writes each arriving chunk at its byte
 * offset. Because chunks carry absolute offsets and writes are positional and
 * idempotent, any arrival order produces a byte-identical result and concurrent
 * writes to disjoint ranges need no global lock. When every chunk index has
 * been recorded, the whole-file hash is verified (when provided) and the file
 * is committed; otherwise it is discarded.
 *
 * See section 6.3 of `protocol-spec/wrapdrive-protocol-v1.md`.
 */

import type { FileMeta } from '@wrapdrive/protocol';
import { planChunks } from './chunk-planner.js';
import { AllocationError, ChunkBoundsError, IntegrityError } from './errors.js';
import type { FileAdapter, SparseFileHandle } from './file-adapter.js';

/** Context describing a single incoming chunk. */
export interface IncomingChunk {
  /** Zero-based chunk index. */
  index: number;
  /** Absolute byte offset of the chunk within the file. */
  offset: number;
  /** Declared chunk length in bytes. */
  length: number;
  /** The chunk body. */
  data: Uint8Array;
}

/** The terminal outcome of a file receive. */
export type ReceiveOutcome =
  | { state: 'in-progress' }
  | { state: 'done'; finalPath: string }
  | { state: 'failed'; reason: 'integrity' };

/**
 * Tracks the receive of one file: a pre-allocated destination, the set of
 * recorded chunk indices, and the commit/verify logic.
 *
 * A single instance is not safe to construct twice for the same file; create
 * one per `(sessionId, fileId)`. Its {@link receiveChunk} method *is* safe to
 * call concurrently because positional writes touch disjoint ranges.
 */
export class FileReceiver {
  private readonly handle: SparseFileHandle;
  private readonly recorded = new Set<number>();
  private readonly totalChunks: number;
  private settled = false;

  private constructor(
    private readonly adapter: FileAdapter,
    private readonly meta: FileMeta,
    private readonly finalPath: string,
    private readonly partPath: string,
    handle: SparseFileHandle,
    chunkSize: number,
  ) {
    this.handle = handle;
    this.totalChunks = planChunks(meta.size, chunkSize).length;
  }

  /**
   * Open a receiver, pre-allocating the destination to the full declared size.
   *
   * @throws AllocationError if pre-allocation fails; nothing is written.
   */
  static async open(
    adapter: FileAdapter,
    meta: FileMeta,
    finalPath: string,
    chunkSize: number,
  ): Promise<FileReceiver> {
    let handle: SparseFileHandle;
    try {
      handle = await adapter.openSparse(finalPath, meta.size);
    } catch (cause) {
      throw new AllocationError(
        `failed to pre-allocate ${meta.size} bytes for ${meta.fileName}: ${String(cause)}`,
      );
    }
    const partPath = `${finalPath}.wdpart`;
    const effectiveChunkSize = chunkSize > 0 ? chunkSize : Math.max(meta.size, 1);
    return new FileReceiver(adapter, meta, finalPath, partPath, handle, effectiveChunkSize);
  }

  /** Number of distinct chunks recorded so far. */
  get receivedCount(): number {
    return this.recorded.size;
  }

  /**
   * Validate and write one chunk, then finalize if it completes the file.
   *
   * Validation: `offset >= 0`, `offset + length <= file size`, and
   * `data.length === length`. A failure throws {@link ChunkBoundsError} and
   * writes nothing. A duplicate index is recorded once and re-acknowledged.
   *
   * @returns the receive outcome after this chunk
   * @throws ChunkBoundsError on invalid bounds; IntegrityError on hash mismatch
   */
  async receiveChunk(chunk: IncomingChunk): Promise<ReceiveOutcome> {
    this.validateBounds(chunk);

    if (this.recorded.has(chunk.index)) {
      // Idempotent: already have this chunk; leave bytes unchanged.
      return this.settled ? this.terminalOutcome() : { state: 'in-progress' };
    }

    await this.handle.writeAt(chunk.offset, chunk.data);
    this.recorded.add(chunk.index);

    if (this.recorded.size < this.totalChunks) {
      return { state: 'in-progress' };
    }
    return this.finalize();
  }

  private validateBounds(chunk: IncomingChunk): void {
    if (chunk.offset < 0) {
      throw new ChunkBoundsError(`chunk ${chunk.index} offset ${chunk.offset} is negative`);
    }
    if (chunk.offset + chunk.length > this.meta.size) {
      throw new ChunkBoundsError(
        `chunk ${chunk.index} range [${chunk.offset}, ${chunk.offset + chunk.length}) ` +
          `exceeds file size ${this.meta.size}`,
      );
    }
    if (chunk.data.byteLength !== chunk.length) {
      throw new ChunkBoundsError(
        `chunk ${chunk.index} body length ${chunk.data.byteLength} != declared ${chunk.length}`,
      );
    }
  }

  /** Verify the whole-file hash (when provided) and commit, else discard. */
  private async finalize(): Promise<ReceiveOutcome> {
    if (this.meta.sha256 !== null) {
      const actual = await this.adapter.sha256(this.partPath);
      if (actual.toLowerCase() !== this.meta.sha256.toLowerCase()) {
        await this.handle.close();
        await this.adapter.delete(this.partPath);
        this.settled = true;
        throw new IntegrityError(
          `integrity check failed for ${this.meta.fileName}: ` +
            `expected ${this.meta.sha256}, got ${actual}`,
        );
      }
    }
    await this.handle.commit(this.finalPath);
    this.settled = true;
    return { state: 'done', finalPath: this.finalPath };
  }

  private terminalOutcome(): ReceiveOutcome {
    return { state: 'done', finalPath: this.finalPath };
  }

  /** Abort the receive, closing the handle and discarding the partial file. */
  async abort(): Promise<void> {
    if (this.settled) {
      return;
    }
    this.settled = true;
    await this.handle.close();
  }
}
