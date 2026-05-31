/**
 * Configurable in-memory {@link SenderTransport} for tests.
 *
 * Routes uploaded chunks into a {@link FileReceiver} so the sender and receiver
 * can be exercised end to end, and instruments concurrency so tests can assert
 * the in-flight bound. A scripted failure map lets tests force transient (5xx)
 * or client (4xx) responses for specific chunk indices.
 */

import type { FileReceiver } from '../chunk-receiver.js';
import type { ChunkUpload, SenderTransport, TransportResponse } from '../transport.js';

/** Per-chunk scripted responses; absent means success after any retries. */
export interface ChunkScript {
  /** Statuses returned in order for a chunk index before it finally succeeds. */
  failuresByIndex?: Map<number, number[]>;
  /** A delay (ms) applied to each chunk to widen the concurrency window. */
  perChunkDelayMs?: number;
}

/** A fake transport that forwards chunks to a receiver and tracks concurrency. */
export class FakeTransport implements SenderTransport {
  /** Peak number of concurrently in-flight chunk uploads observed. */
  peakInFlight = 0;
  /** Number of cancel calls received. */
  cancelCount = 0;

  private inFlight = 0;
  private readonly attempts = new Map<number, number>();

  constructor(
    private readonly receiver: FileReceiver,
    private readonly script: ChunkScript = {},
  ) {}

  async uploadChunk(upload: ChunkUpload): Promise<TransportResponse> {
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    try {
      // Always yield at least once so concurrent uploads genuinely overlap,
      // letting tests observe the true peak in-flight count.
      await delay(this.script.perChunkDelayMs ?? 0);

      const scripted = this.script.failuresByIndex?.get(upload.chunkIndex);
      if (scripted && scripted.length > 0) {
        const attempt = this.attempts.get(upload.chunkIndex) ?? 0;
        if (attempt < scripted.length) {
          this.attempts.set(upload.chunkIndex, attempt + 1);
          return { status: scripted[attempt] as number };
        }
      }

      await this.receiver.receiveChunk({
        index: upload.chunkIndex,
        offset: upload.offset,
        length: upload.length,
        data: upload.data,
      });
      return { status: 200 };
    } finally {
      this.inFlight -= 1;
    }
  }

  async uploadStream(): Promise<TransportResponse> {
    return { status: 200 };
  }

  async cancel(): Promise<void> {
    this.cancelCount += 1;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
