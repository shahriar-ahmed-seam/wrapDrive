/**
 * Single-stream transfer (fallback mode).
 *
 * When negotiation resolves to `single-stream`, the sender transmits one
 * full-file body over a single connection and the receiver streams it to a
 * temporary file, verifying integrity before commit. This is also the path used
 * for reverse-download into a pure browser.
 *
 * See section 7 of `protocol-spec/wrapdrive-protocol-v1.md`.
 */

import type { FileMeta } from '@wrapdrive/protocol';
import { IntegrityError, TransferAbortedError } from './errors.js';
import type { FileAdapter, LocalFile, SparseFileHandle } from './file-adapter.js';
import type { SenderTransport, UploadTarget } from './transport.js';

/** Default streaming read size for the sender body. */
const STREAM_CHUNK = 1024 * 1024;

/**
 * Send `file` as a single full-file body via the transport's `uploadStream`.
 *
 * @throws TransferAbortedError if the upload is not acknowledged with 200
 */
export async function sendSingleStream(
  target: UploadTarget,
  file: LocalFile,
  adapter: FileAdapter,
  transport: SenderTransport,
): Promise<void> {
  async function* body(): AsyncIterable<Uint8Array> {
    let offset = 0;
    while (offset < file.size) {
      const length = Math.min(STREAM_CHUNK, file.size - offset);
      yield await adapter.readRange(file, offset, length);
      offset += length;
    }
  }

  const response = await transport.uploadStream(target, body());
  if (response.status !== 200) {
    await transport.cancel(target.sessionId).catch(() => undefined);
    throw new TransferAbortedError(`single-stream upload failed with status ${response.status}`);
  }
}

/** Outcome of a single-stream receive. */
export type SingleStreamOutcome =
  | { state: 'done'; finalPath: string }
  | { state: 'failed'; reason: 'integrity' | 'incomplete' };

/**
 * Receive a single full-file body, streaming it to a temporary file, then
 * verify and commit.
 *
 * Commits only when the received byte count equals the declared size AND, when
 * a hash was provided, the computed SHA-256 matches. On a short stream the
 * partial file is discarded; on a hash mismatch the file is discarded.
 *
 * @throws IntegrityError on hash mismatch; TransferAbortedError on short stream
 */
export async function receiveSingleStream(
  meta: FileMeta,
  finalPath: string,
  body: AsyncIterable<Uint8Array>,
  adapter: FileAdapter,
): Promise<SingleStreamOutcome> {
  const partPath = `${finalPath}.wdpart`;
  const handle: SparseFileHandle = await adapter.openSparse(finalPath, meta.size);

  let written = 0;
  try {
    for await (const part of body) {
      if (written + part.byteLength > meta.size) {
        // Sender is sending more than declared; treat as a protocol violation.
        await handle.close();
        await adapter.delete(partPath);
        throw new TransferAbortedError(`single-stream body exceeded declared size ${meta.size}`);
      }
      await handle.writeAt(written, part);
      written += part.byteLength;
    }
  } catch (err) {
    if (err instanceof TransferAbortedError) throw err;
    await handle.close();
    await adapter.delete(partPath);
    throw new TransferAbortedError(`single-stream receive failed: ${String(err)}`);
  }

  if (written !== meta.size) {
    await handle.close();
    await adapter.delete(partPath);
    return { state: 'failed', reason: 'incomplete' };
  }

  if (meta.sha256 !== null) {
    const actual = await adapter.sha256(partPath);
    if (actual.toLowerCase() !== meta.sha256.toLowerCase()) {
      await handle.close();
      await adapter.delete(partPath);
      throw new IntegrityError(
        `integrity check failed for ${meta.fileName}: expected ${meta.sha256}, got ${actual}`,
      );
    }
  }

  await handle.commit(finalPath);
  return { state: 'done', finalPath };
}
