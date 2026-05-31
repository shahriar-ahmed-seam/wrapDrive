/**
 * Property 2 — Reassembly fidelity (order independence): for any permutation of
 * chunk arrival order, the committed file is byte-identical to the source.
 *
 * Property 8 — Integrity gate: a file is committed only if its SHA-256 matches
 * the declared hash (when provided); otherwise it is discarded.
 *
 * Plus unit coverage of pre-allocation failure, bounds validation, and
 * idempotent duplicate writes.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 9.8, 9.9
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FileMeta } from '@wrapdrive/protocol';
import { planChunks } from './chunk-planner.js';
import { FileReceiver } from './chunk-receiver.js';
import { AllocationError, ChunkBoundsError, IntegrityError } from './errors.js';
import type { FileAdapter, SparseFileHandle } from './file-adapter.js';
import { MemoryFileAdapter, hashBytes } from './testing/memory-file-adapter.js';

const RUNS = { numRuns: 200 };

function meta(size: number, sha256: string | null): FileMeta {
  return {
    id: 'f1',
    fileName: 'blob.bin',
    size,
    fileType: 'application/octet-stream',
    sha256,
    preview: null,
  };
}

/** Shuffle a copy of `items` using fast-check-provided swap indices. */
function shuffle<T>(items: T[], swaps: number[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (swaps[i] ?? 0) % (i + 1);
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
}

describe('FileReceiver — Property 2: reassembly order independence', () => {
  it('produces a byte-identical file for any chunk arrival order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 4096 }),
        fc.integer({ min: 1, max: 512 }),
        fc.array(fc.nat(), { maxLength: 64 }),
        async (source, chunkSize, swaps) => {
          const adapter = new MemoryFileAdapter();
          const sha = hashBytes(source);
          const fileMeta = meta(source.byteLength, sha);
          const receiver = await FileReceiver.open(adapter, fileMeta, '/dst/blob.bin', chunkSize);

          const chunks = planChunks(source.byteLength, chunkSize);
          const order = shuffle(chunks, swaps);

          let done = false;
          for (const c of order) {
            const outcome = await receiver.receiveChunk({
              index: c.index,
              offset: c.offset,
              length: c.length,
              data: source.slice(c.offset, c.offset + c.length),
            });
            if (outcome.state === 'done') done = true;
          }

          if (source.byteLength === 0) {
            // No chunks to send; nothing to assert beyond no crash.
            return;
          }
          expect(done).toBe(true);
          const committed = adapter.getCommitted('/dst/blob.bin');
          expect(committed).toBeDefined();
          expect(hashBytes(committed as Uint8Array)).toBe(sha);
        },
      ),
      RUNS,
    );
  });
});

describe('FileReceiver — Property 8: integrity gate', () => {
  it('commits a matching file and discards a corrupted one', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 2048 }),
        fc.integer({ min: 1, max: 256 }),
        fc.boolean(),
        async (source, chunkSize, corrupt) => {
          const adapter = new MemoryFileAdapter();
          const declaredHash = hashBytes(source);
          const receiver = await FileReceiver.open(
            adapter,
            meta(source.byteLength, declaredHash),
            '/dst/blob.bin',
            chunkSize,
          );

          const chunks = planChunks(source.byteLength, chunkSize);
          let threw = false;
          try {
            for (const c of chunks) {
              const bytes = source.slice(c.offset, c.offset + c.length);
              if (corrupt && c.index === 0 && bytes.length > 0) {
                bytes[0] = bytes[0]! ^ 0xff; // flip a bit in the first chunk
              }
              await receiver.receiveChunk({
                index: c.index,
                offset: c.offset,
                length: c.length,
                data: bytes,
              });
            }
          } catch (err) {
            threw = true;
            expect(err).toBeInstanceOf(IntegrityError);
          }

          if (corrupt) {
            expect(threw).toBe(true);
            expect(adapter.getCommitted('/dst/blob.bin')).toBeUndefined();
          } else {
            expect(threw).toBe(false);
            expect(hashBytes(adapter.getCommitted('/dst/blob.bin') as Uint8Array)).toBe(
              declaredHash,
            );
          }
        },
      ),
      RUNS,
    );
  });

  it('commits without a hash when all chunks arrive', async () => {
    const adapter = new MemoryFileAdapter();
    const source = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const receiver = await FileReceiver.open(adapter, meta(source.byteLength, null), '/dst/x', 3);
    const chunks = planChunks(source.byteLength, 3);
    let finalPath: string | undefined;
    for (const c of chunks) {
      const outcome = await receiver.receiveChunk({
        index: c.index,
        offset: c.offset,
        length: c.length,
        data: source.slice(c.offset, c.offset + c.length),
      });
      if (outcome.state === 'done') finalPath = outcome.finalPath;
    }
    expect(finalPath).toBe('/dst/x');
    expect(adapter.getCommitted('/dst/x')).toEqual(source);
  });
});

describe('FileReceiver — bounds, duplicates, and allocation', () => {
  const adapter = () => new MemoryFileAdapter();

  it('records duplicate chunk indices once and keeps bytes unchanged', async () => {
    const a = adapter();
    const source = new Uint8Array([10, 20, 30, 40]);
    const receiver = await FileReceiver.open(a, meta(4, hashBytes(source)), '/dst/d', 2);

    await receiver.receiveChunk({ index: 0, offset: 0, length: 2, data: source.slice(0, 2) });
    await receiver.receiveChunk({ index: 0, offset: 0, length: 2, data: source.slice(0, 2) });
    expect(receiver.receivedCount).toBe(1);

    const outcome = await receiver.receiveChunk({
      index: 1,
      offset: 2,
      length: 2,
      data: source.slice(2, 4),
    });
    expect(outcome.state).toBe('done');
    expect(a.getCommitted('/dst/d')).toEqual(source);
  });

  it('rejects out-of-bounds and length-mismatched chunks without writing', async () => {
    const a = adapter();
    const receiver = await FileReceiver.open(a, meta(10, null), '/dst/b', 5);

    await expect(
      receiver.receiveChunk({ index: 0, offset: -1, length: 5, data: new Uint8Array(5) }),
    ).rejects.toBeInstanceOf(ChunkBoundsError);

    await expect(
      receiver.receiveChunk({ index: 1, offset: 8, length: 5, data: new Uint8Array(5) }),
    ).rejects.toBeInstanceOf(ChunkBoundsError);

    await expect(
      receiver.receiveChunk({ index: 0, offset: 0, length: 5, data: new Uint8Array(4) }),
    ).rejects.toBeInstanceOf(ChunkBoundsError);

    expect(receiver.receivedCount).toBe(0);
  });

  it('throws AllocationError when pre-allocation fails and writes nothing', async () => {
    const failing: FileAdapter = {
      openSparse(): Promise<SparseFileHandle> {
        return Promise.reject(new Error('disk full'));
      },
      readRange: () => Promise.resolve(new Uint8Array(0)),
      sha256: () => Promise.resolve(''),
      delete: () => Promise.resolve(),
    };
    await expect(FileReceiver.open(failing, meta(100, null), '/dst/f', 10)).rejects.toBeInstanceOf(
      AllocationError,
    );
  });
});
