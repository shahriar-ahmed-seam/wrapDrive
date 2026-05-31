/**
 * Platform file abstraction.
 *
 * The transfer engine is platform-agnostic; the few genuinely
 * platform-specific I/O primitives it needs live behind {@link FileAdapter}.
 * The crux is positional writes ({@link SparseFileHandle.writeAt}): pre-allocate
 * the destination to its full size, then write each chunk at its byte offset.
 *
 * Implementations:
 *  - Node (Desktop, web-host): `fs` positional writes — see `node-file-adapter`.
 *  - Android (Kotlin): `RandomAccessFile` — implemented in the Kotlin port.
 *  - Browser (Chromium): File System Access API — implemented in the web app.
 */

/** A reference to local source-file bytes the sender can read in ranges. */
export interface LocalFile {
  /** Absolute path or platform-specific locator for the source file. */
  readonly path: string;
  /** Total size of the file in bytes. */
  readonly size: number;
}

/**
 * A handle to a destination file pre-allocated to its full size, supporting
 * idempotent positional writes and an atomic commit to the final path.
 */
export interface SparseFileHandle {
  /**
   * Write `data` at absolute byte `offset`. Idempotent: writing the same bytes
   * at the same offset more than once is harmless. Concurrent writes to
   * disjoint ranges are safe.
   */
  writeAt(offset: number, data: Uint8Array): Promise<void>;
  /** Atomically move the completed temporary file to `finalPath`. */
  commit(finalPath: string): Promise<void>;
  /** Release the handle and delete the temporary file if not committed. */
  close(): Promise<void>;
}

/** The platform-specific file primitives the engine depends on. */
export interface FileAdapter {
  /**
   * Open a destination file pre-allocated to `totalSize` bytes at a temporary
   * path derived from `path`. The returned handle accepts positional writes.
   */
  openSparse(path: string, totalSize: number): Promise<SparseFileHandle>;
  /** Read `length` bytes from `file` starting at `offset`, without loading all of it. */
  readRange(file: LocalFile, offset: number, length: number): Promise<Uint8Array>;
  /** Compute the SHA-256 of the file at `path`, returned as lowercase hex. */
  sha256(path: string): Promise<string>;
  /** Delete the file at `path` if it exists. */
  delete(path: string): Promise<void>;
}
