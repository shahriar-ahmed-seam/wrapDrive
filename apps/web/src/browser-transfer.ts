/**
 * Browser-side sending support.
 *
 * The browser can SEND parallel chunks: `File.slice` yields a byte-range Blob
 * and `fetch` issues concurrent POSTs (the browser pools ~6 connections/host).
 * These adapt a `File` and `fetch` to the engine's `FileAdapter`/`SenderTransport`
 * so the shared `sendParallel` drives the upload.
 */

import { API_NAMESPACE } from '@wrapdrive/protocol';
import type {
  ChunkUpload,
  FileAdapter,
  LocalFile,
  SenderTransport,
  SparseFileHandle,
  TransportResponse,
  UploadTarget,
} from '@wrapdrive/transfer-engine';

/** A {@link LocalFile} backed by a browser {@link File}. */
export function browserLocalFile(file: File): LocalFile {
  return { path: file.name, size: file.size };
}

/**
 * A {@link FileAdapter} that can only read ranges from browser {@link File}s.
 * The browser cannot receive chunked (no server), so the sparse-write methods
 * throw; they are never called on the send path.
 */
export class BrowserFileAdapter implements FileAdapter {
  constructor(private readonly file: File) {}

  openSparse(): Promise<SparseFileHandle> {
    throw new Error('pure browser cannot host a chunked receiver');
  }

  async readRange(_file: LocalFile, offset: number, length: number): Promise<Uint8Array> {
    const blob = this.file.slice(offset, offset + length);
    return new Uint8Array(await blob.arrayBuffer());
  }

  async sha256(): Promise<string> {
    const buffer = await this.file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async delete(): Promise<void> {
    // no-op in the browser
  }
}

/** A {@link SenderTransport} using the browser `fetch`. */
export class FetchSenderTransport implements SenderTransport {
  constructor(private readonly baseUrl: string) {}

  async uploadChunk(upload: ChunkUpload): Promise<TransportResponse> {
    const url =
      `${this.baseUrl}${API_NAMESPACE}/upload-chunk` +
      `?sessionId=${encodeURIComponent(upload.sessionId)}` +
      `&fileId=${encodeURIComponent(upload.fileId)}` +
      `&token=${encodeURIComponent(upload.token)}` +
      `&chunkIndex=${upload.chunkIndex}` +
      `&offset=${upload.offset}` +
      `&length=${upload.length}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Blob([upload.data as BlobPart]),
    });
    return { status: res.status };
  }

  async uploadStream(
    target: UploadTarget,
    body: AsyncIterable<Uint8Array>,
  ): Promise<TransportResponse> {
    const url =
      `${this.baseUrl}${API_NAMESPACE}/upload` +
      `?sessionId=${encodeURIComponent(target.sessionId)}` +
      `&fileId=${encodeURIComponent(target.fileId)}` +
      `&token=${encodeURIComponent(target.token)}`;
    const parts: Uint8Array[] = [];
    for await (const c of body) parts.push(c);
    const blob = new Blob(parts as BlobPart[]);
    const res = await fetch(url, { method: 'POST', body: blob });
    return { status: res.status };
  }

  async cancel(sessionId: string): Promise<void> {
    await fetch(`${this.baseUrl}${API_NAMESPACE}/cancel?sessionId=${sessionId}`, {
      method: 'POST',
    }).catch(() => undefined);
  }
}
