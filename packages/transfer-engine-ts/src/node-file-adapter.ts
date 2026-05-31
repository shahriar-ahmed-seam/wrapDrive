/**
 * Node implementation of {@link FileAdapter}.
 *
 * Used by the Electron desktop main process and the web-host bridge. Positional
 * writes use `FileHandle.write(buffer, offset, length, position)` into a
 * `.part` file pre-grown with `truncate`, so chunks written in any order land
 * at their final byte positions. Commit renames the `.part` file to the final
 * path.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, truncate } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { FileAdapter, LocalFile, SparseFileHandle } from './file-adapter.js';

/** Suffix used for in-progress destination files. */
const PART_SUFFIX = '.wdpart';

class NodeSparseFileHandle implements SparseFileHandle {
  private committed = false;

  constructor(
    private readonly handle: FileHandle,
    private readonly partPath: string,
  ) {}

  async writeAt(offset: number, data: Uint8Array): Promise<void> {
    await this.handle.write(data, 0, data.byteLength, offset);
  }

  async commit(finalPath: string): Promise<void> {
    await this.handle.close();
    await rename(this.partPath, finalPath);
    this.committed = true;
  }

  async close(): Promise<void> {
    if (this.committed) {
      return;
    }
    // Close then remove the incomplete temporary file.
    try {
      await this.handle.close();
    } finally {
      await rm(this.partPath, { force: true });
    }
  }
}

/** A {@link FileAdapter} backed by the Node `fs` module. */
export class NodeFileAdapter implements FileAdapter {
  async openSparse(path: string, totalSize: number): Promise<SparseFileHandle> {
    const partPath = `${path}${PART_SUFFIX}`;
    // 'w' creates or truncates the file; pre-grow it to the full size so
    // positional writes never need to extend it.
    const handle = await open(partPath, 'w');
    if (totalSize > 0) {
      await truncate(partPath, totalSize);
    }
    return new NodeSparseFileHandle(handle, partPath);
  }

  async readRange(file: LocalFile, offset: number, length: number): Promise<Uint8Array> {
    if (length === 0) {
      return new Uint8Array(0);
    }
    const end = offset + length - 1; // createReadStream end is inclusive
    const stream = createReadStream(file.path, { start: offset, end });
    const parts: Buffer[] = [];
    for await (const part of stream) {
      parts.push(part as Buffer);
    }
    const buffer = Buffer.concat(parts);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  async sha256(path: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    for await (const part of stream) {
      hash.update(part as Buffer);
    }
    return hash.digest('hex');
  }

  async delete(path: string): Promise<void> {
    await rm(path, { force: true });
  }
}
