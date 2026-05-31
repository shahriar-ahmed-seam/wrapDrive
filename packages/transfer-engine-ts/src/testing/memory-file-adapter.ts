/**
 * In-memory {@link FileAdapter} for tests.
 *
 * Backs files with `Uint8Array`s held in maps, implementing genuine positional
 * writes and SHA-256 so the engine's reassembly and integrity logic can be
 * exercised without touching the filesystem.
 */

import { createHash } from 'node:crypto';
import type { FileAdapter, LocalFile, SparseFileHandle } from '../file-adapter.js';

const PART_SUFFIX = '.wdpart';

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A {@link FileAdapter} whose files live in memory. */
export class MemoryFileAdapter implements FileAdapter {
  /** Committed and in-progress files, keyed by path. */
  readonly files = new Map<string, Uint8Array>();
  /** Source files registered for the sender to read. */
  private readonly sources = new Map<string, Uint8Array>();

  /** Register a source file the sender can read ranges from. */
  addSource(path: string, data: Uint8Array): LocalFile {
    this.sources.set(path, data);
    return { path, size: data.byteLength };
  }

  /** Return the committed bytes at `path`, or undefined if absent. */
  getCommitted(path: string): Uint8Array | undefined {
    return this.files.get(path);
  }

  async openSparse(path: string, totalSize: number): Promise<SparseFileHandle> {
    const partPath = `${path}${PART_SUFFIX}`;
    const buffer = new Uint8Array(totalSize);
    this.files.set(partPath, buffer);
    const files = this.files;
    let committed = false;

    return {
      async writeAt(offset: number, data: Uint8Array): Promise<void> {
        buffer.set(data, offset);
      },
      async commit(finalPath: string): Promise<void> {
        files.set(finalPath, buffer);
        files.delete(partPath);
        committed = true;
      },
      async close(): Promise<void> {
        if (!committed) {
          files.delete(partPath);
        }
      },
    };
  }

  async readRange(file: LocalFile, offset: number, length: number): Promise<Uint8Array> {
    const source = this.sources.get(file.path);
    if (!source) {
      throw new Error(`no source registered for ${file.path}`);
    }
    return source.slice(offset, offset + length);
  }

  async sha256(path: string): Promise<string> {
    const bytes = this.files.get(path);
    if (!bytes) {
      throw new Error(`no file at ${path}`);
    }
    return sha256Hex(bytes);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }
}

/** Compute the SHA-256 hex of a byte array (test convenience). */
export const hashBytes = sha256Hex;
