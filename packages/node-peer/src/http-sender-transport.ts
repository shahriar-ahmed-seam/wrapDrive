/**
 * Node {@link SenderTransport} using the global `fetch` (backed by undici,
 * which pools connections per origin), so parallel chunk POSTs reuse sockets.
 */

import { API_NAMESPACE } from '@wrapdrive/protocol';
import type {
  ChunkUpload,
  SenderTransport,
  TransportResponse,
  UploadTarget,
} from '@wrapdrive/transfer-engine';

/** Posts chunks/streams to a peer's WrapDrive endpoints over HTTP. */
export class HttpSenderTransport implements SenderTransport {
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
      body: upload.data,
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
    const chunks: Uint8Array[] = [];
    for await (const c of body) chunks.push(c);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.concat(chunks),
    });
    return { status: res.status };
  }

  async cancel(sessionId: string): Promise<void> {
    await fetch(`${this.baseUrl}${API_NAMESPACE}/cancel?sessionId=${sessionId}`, {
      method: 'POST',
    }).catch(() => undefined);
  }
}
