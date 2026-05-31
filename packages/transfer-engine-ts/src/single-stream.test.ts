/**
 * Tests for single-stream transfer (fallback mode).
 *
 * Covers full-file send→receive byte-identity, the integrity gate, the
 * incomplete-stream discard path, and the over-size protocol violation.
 *
 * Validates: Requirements 5.1, 5.2, 5.5, 5.6, 5.7
 */

import { describe, expect, it } from 'vitest';
import type { FileMeta } from '@wrapdrive/protocol';
import { IntegrityError, TransferAbortedError } from './errors.js';
import { receiveSingleStream, sendSingleStream } from './single-stream.js';
import type { SenderTransport, UploadTarget } from './transport.js';
import { MemoryFileAdapter, hashBytes } from './testing/memory-file-adapter.js';

const target: UploadTarget = { sessionId: 's1', fileId: 'f1', token: 'tok' };

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

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const parts: Uint8Array[] = [];
  for await (const p of body) parts.push(p);
  return parts;
}

describe('single-stream send + receive', () => {
  it('round-trips a file byte-identically through the receiver', async () => {
    const adapter = new MemoryFileAdapter();
    const source = new Uint8Array(5000).map((_, i) => (i * 13) % 256);
    const file = adapter.addSource('/src/s', source);
    const sha = hashBytes(source);

    // Wire the sender's stream directly into the receiver.
    let received: Awaited<ReturnType<typeof receiveSingleStream>> | undefined;
    const transport: SenderTransport = {
      async uploadChunk() {
        return { status: 200 };
      },
      async uploadStream(_t, body) {
        received = await receiveSingleStream(meta(source.byteLength, sha), '/dst/s', body, adapter);
        return { status: 200 };
      },
      async cancel() {},
    };

    await sendSingleStream(target, file, adapter, transport);
    expect(received?.state).toBe('done');
    expect(adapter.getCommitted('/dst/s')).toEqual(source);
  });

  it('commits when the byte count matches and no hash is provided', async () => {
    const adapter = new MemoryFileAdapter();
    const source = new Uint8Array([1, 2, 3, 4, 5]);
    async function* body() {
      yield source.slice(0, 2);
      yield source.slice(2);
    }
    const outcome = await receiveSingleStream(meta(5, null), '/dst/n', body(), adapter);
    expect(outcome).toEqual({ state: 'done', finalPath: '/dst/n' });
    expect(adapter.getCommitted('/dst/n')).toEqual(source);
  });

  it('discards on hash mismatch (integrity gate)', async () => {
    const adapter = new MemoryFileAdapter();
    const source = new Uint8Array([9, 8, 7, 6]);
    async function* body() {
      yield source;
    }
    await expect(
      receiveSingleStream(meta(4, 'deadbeef'.repeat(8)), '/dst/m', body(), adapter),
    ).rejects.toBeInstanceOf(IntegrityError);
    expect(adapter.getCommitted('/dst/m')).toBeUndefined();
  });

  it('fails as incomplete when the stream ends early', async () => {
    const adapter = new MemoryFileAdapter();
    async function* body() {
      yield new Uint8Array([1, 2, 3]); // only 3 of 10 declared bytes
    }
    const outcome = await receiveSingleStream(meta(10, null), '/dst/i', body(), adapter);
    expect(outcome).toEqual({ state: 'failed', reason: 'incomplete' });
    expect(adapter.getCommitted('/dst/i')).toBeUndefined();
  });

  it('rejects a body that exceeds the declared size', async () => {
    const adapter = new MemoryFileAdapter();
    async function* body() {
      yield new Uint8Array([1, 2, 3, 4, 5, 6]); // 6 bytes for a declared 4
    }
    await expect(
      receiveSingleStream(meta(4, null), '/dst/o', body(), adapter),
    ).rejects.toBeInstanceOf(TransferAbortedError);
    expect(adapter.getCommitted('/dst/o')).toBeUndefined();
  });

  it('sender throws and cancels when upload is not acknowledged', async () => {
    const adapter = new MemoryFileAdapter();
    const file = adapter.addSource('/src/f', new Uint8Array(10));
    let cancelled = false;
    const transport: SenderTransport = {
      async uploadChunk() {
        return { status: 200 };
      },
      async uploadStream(_t, body) {
        await collect(body);
        return { status: 500 };
      },
      async cancel() {
        cancelled = true;
      },
    };
    await expect(sendSingleStream(target, file, adapter, transport)).rejects.toBeInstanceOf(
      TransferAbortedError,
    );
    expect(cancelled).toBe(true);
  });
});
