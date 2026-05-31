/**
 * Parallel send scheduler.
 *
 * Sends a file as concurrent chunk uploads, bounded by the negotiated
 * parallelism, with per-chunk retry and backoff. Concurrency is bounded by
 * running exactly `parallelism` workers that pull chunk indices from a shared
 * cursor, so the number of in-flight uploads never exceeds `parallelism`.
 * Reading byte ranges on demand keeps peak memory at `parallelism * chunkSize`,
 * independent of file size.
 *
 * See section 6.2 of `protocol-spec/wrapdrive-protocol-v1.md` and the
 * `sendParallel` low-level design.
 */

import type { TransferPlan } from '@wrapdrive/protocol';
import { planChunks } from './chunk-planner.js';
import { TransferAbortedError } from './errors.js';
import type { FileAdapter, LocalFile } from './file-adapter.js';
import {
  DEFAULT_RETRY_POLICY,
  backoffDelayMs,
  isClientErrorStatus,
  isRetriableStatus,
  type RetryPolicy,
} from './retry.js';
import type { ChunkUpload, SenderTransport, UploadTarget } from './transport.js';

/** Progress callback signalled after each chunk completes. */
export type ChunkProgress = (completed: number, total: number, bytes: number) => void;

/** Options controlling a parallel send. */
export interface SendOptions {
  /** Sleep function (injectable for tests); defaults to real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Retry policy; defaults to {@link DEFAULT_RETRY_POLICY}. */
  retryPolicy?: RetryPolicy;
  /** Progress callback. */
  onProgress?: ChunkProgress;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send `file` to the receiver as parallel chunks per `plan`.
 *
 * On success every planned chunk has been delivered and acknowledged exactly
 * once. On unrecoverable failure (retry exhaustion or a 4xx) the scheduler
 * issues `/cancel` and throws, leaving the receiver to commit no file.
 *
 * @throws TransferAbortedError if a chunk cannot be delivered
 */
export async function sendParallel(
  target: UploadTarget,
  file: LocalFile,
  plan: TransferPlan,
  adapter: FileAdapter,
  transport: SenderTransport,
  options: SendOptions = {},
): Promise<void> {
  if (plan.mode !== 'parallel-chunked') {
    throw new TypeError('sendParallel requires a parallel-chunked plan');
  }

  const sleep = options.sleep ?? realSleep;
  const policy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const chunks = planChunks(file.size, plan.chunkSize);
  const total = chunks.length;

  let nextIndex = 0;
  let completed = 0;
  let bytesSent = 0;
  let aborted: Error | null = null;

  /** Deliver one chunk with retry/backoff; throws on unrecoverable failure. */
  const deliverChunk = async (upload: ChunkUpload): Promise<void> => {
    let attempt = 0;
    for (;;) {
      const response = await transport.uploadChunk(upload).catch(() => ({ status: 0 }));

      if (response.status === 200) {
        return;
      }
      if (isClientErrorStatus(response.status)) {
        throw new TransferAbortedError(
          `chunk ${upload.chunkIndex} rejected with status ${response.status}`,
        );
      }
      // Transient (5xx) or network error (status 0): retry with backoff.
      const transient = response.status === 0 || isRetriableStatus(response.status);
      if (!transient || attempt >= policy.maxRetries) {
        throw new TransferAbortedError(
          `chunk ${upload.chunkIndex} failed after ${attempt} retries (status ${response.status})`,
        );
      }
      attempt += 1;
      await sleep(backoffDelayMs(attempt, policy));
    }
  };

  const worker = async (): Promise<void> => {
    while (!aborted) {
      const i = nextIndex;
      if (i >= total) return;
      nextIndex += 1;
      const chunk = chunks[i];
      if (!chunk) return;

      try {
        const data = await adapter.readRange(file, chunk.offset, chunk.length);
        await deliverChunk({
          ...target,
          chunkIndex: chunk.index,
          offset: chunk.offset,
          length: chunk.length,
          data,
        });
      } catch (err) {
        aborted ??= err instanceof Error ? err : new TransferAbortedError(String(err));
        return;
      }

      completed += 1;
      bytesSent += chunk.length;
      options.onProgress?.(completed, total, bytesSent);
    }
  };

  const workers = Array.from({ length: Math.min(plan.parallelism, Math.max(total, 1)) }, () =>
    worker(),
  );
  await Promise.all(workers);

  if (aborted) {
    await transport.cancel(target.sessionId).catch(() => undefined);
    throw aborted;
  }
}
