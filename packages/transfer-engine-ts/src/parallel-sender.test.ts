/**
 * Property 5 — Bounded concurrency: during a parallel send the number of
 * in-flight chunk requests never exceeds the negotiated parallelism.
 *
 * Plus end-to-end send→receive byte-identity, transient-retry recovery, and
 * non-retriable (4xx) and exhaustion failure handling with cancel.
 *
 * Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TransferPlan } from '@wrapdrive/protocol';
import { FileReceiver } from './chunk-receiver.js';
import { TransferAbortedError } from './errors.js';
import { sendParallel } from './parallel-sender.js';
import type { RetryPolicy } from './retry.js';
import type { UploadTarget } from './transport.js';
import { FakeTransport } from './testing/fake-transport.js';
import { MemoryFileAdapter, hashBytes } from './testing/memory-file-adapter.js';

const target: UploadTarget = { sessionId: 's1', fileId: 'f1', token: 'tok' };

const fileMeta = (size: number, sha256: string | null) => ({
  id: 'f1',
  fileName: 'blob.bin',
  size,
  fileType: 'application/octet-stream',
  sha256,
  preview: null,
});

const plan = (chunkSize: number, parallelism: number): TransferPlan => ({
  mode: 'parallel-chunked',
  chunkSize,
  parallelism,
  chunkProtocolVersion: 'wd-chunk/1',
});

const noBackoff: RetryPolicy = {
  maxRetries: 5,
  initialBackoffMs: 0,
  maxBackoffMs: 0,
  requestTimeoutMs: 1000,
};

describe('sendParallel — Property 5: bounded concurrency', () => {
  it('never exceeds the negotiated parallelism in flight', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 2048 }),
        fc.integer({ min: 64, max: 512 }),
        fc.integer({ min: 1, max: 8 }),
        async (source, chunkSize, parallelism) => {
          const adapter = new MemoryFileAdapter();
          const file = adapter.addSource('/src/blob.bin', source);
          const receiver = await FileReceiver.open(
            adapter,
            fileMeta(source.byteLength, hashBytes(source)),
            '/dst/blob.bin',
            chunkSize,
          );
          // A single event-loop yield per chunk widens the in-flight window
          // enough to observe peak concurrency without slow real timers.
          const transport = new FakeTransport(receiver, { perChunkDelayMs: 0 });

          await sendParallel(target, file, plan(chunkSize, parallelism), adapter, transport, {
            sleep: async () => {},
          });

          expect(transport.peakInFlight).toBeLessThanOrEqual(parallelism);
          expect(hashBytes(adapter.getCommitted('/dst/blob.bin') as Uint8Array)).toBe(
            hashBytes(source),
          );
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('sendParallel — delivery and recovery', () => {
  it('delivers every chunk exactly once and reports progress', async () => {
    const adapter = new MemoryFileAdapter();
    const source = new Uint8Array(1000).map((_, i) => i % 256);
    const file = adapter.addSource('/src/x', source);
    const receiver = await FileReceiver.open(
      adapter,
      fileMeta(1000, hashBytes(source)),
      '/dst/x',
      100,
    );
    const transport = new FakeTransport(receiver);

    let lastCompleted = 0;
    await sendParallel(target, file, plan(100, 4), adapter, transport, {
      sleep: async () => {},
      onProgress: (completed, total) => {
        expect(total).toBe(10);
        lastCompleted = completed;
      },
    });

    expect(lastCompleted).toBe(10);
    expect(adapter.getCommitted('/dst/x')).toEqual(source);
  });

  it('retries transient 5xx failures and still succeeds', async () => {
    const adapter = new MemoryFileAdapter();
    const source = new Uint8Array(500).map((_, i) => (i * 7) % 256);
    const file = adapter.addSource('/src/r', source);
    const receiver = await FileReceiver.open(
      adapter,
      fileMeta(500, hashBytes(source)),
      '/dst/r',
      100,
    );
    // Chunk 2 fails twice (503) before succeeding.
    const failures = new Map<number, number[]>([[2, [503, 503]]]);
    const transport = new FakeTransport(receiver, { failuresByIndex: failures });

    await sendParallel(target, file, plan(100, 3), adapter, transport, {
      sleep: async () => {},
      retryPolicy: noBackoff,
    });

    expect(adapter.getCommitted('/dst/r')).toEqual(source);
    expect(transport.cancelCount).toBe(0);
  });

  it('aborts immediately on a non-retriable 4xx and cancels', async () => {
    const adapter = new MemoryFileAdapter();
    const source = new Uint8Array(500).fill(9);
    const file = adapter.addSource('/src/c', source);
    const receiver = await FileReceiver.open(adapter, fileMeta(500, null), '/dst/c', 100);
    const failures = new Map<number, number[]>([[1, [403]]]);
    const transport = new FakeTransport(receiver, { failuresByIndex: failures });

    await expect(
      sendParallel(target, file, plan(100, 2), adapter, transport, {
        sleep: async () => {},
        retryPolicy: noBackoff,
      }),
    ).rejects.toBeInstanceOf(TransferAbortedError);
    expect(transport.cancelCount).toBe(1);
    expect(adapter.getCommitted('/dst/c')).toBeUndefined();
  });

  it('fails and cancels after exhausting retries', async () => {
    const adapter = new MemoryFileAdapter();
    const source = new Uint8Array(300).fill(1);
    const file = adapter.addSource('/src/e', source);
    const receiver = await FileReceiver.open(adapter, fileMeta(300, null), '/dst/e', 100);
    // Chunk 0 returns 500 forever (6 entries > maxRetries of 5).
    const failures = new Map<number, number[]>([[0, [500, 500, 500, 500, 500, 500]]]);
    const transport = new FakeTransport(receiver, { failuresByIndex: failures });

    await expect(
      sendParallel(target, file, plan(100, 1), adapter, transport, {
        sleep: async () => {},
        retryPolicy: noBackoff,
      }),
    ).rejects.toBeInstanceOf(TransferAbortedError);
    expect(transport.cancelCount).toBe(1);
    expect(adapter.getCommitted('/dst/e')).toBeUndefined();
  });
});
