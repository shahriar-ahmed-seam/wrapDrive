package com.wrapdrive.core.transfer

/** A reference to local source-file bytes the sender can read in ranges. */
interface LocalFile {
    /** Total size of the file in bytes. */
    val size: Long

    /** Read [length] bytes starting at [offset]. */
    fun readRange(offset: Long, length: Int): ByteArray
}

/**
 * A handle to a destination file pre-allocated to its full size, supporting
 * idempotent positional writes and a commit to the final location.
 */
interface SparseFileHandle {
    /** Write [data] at absolute byte [offset]. Idempotent and thread-safe. */
    fun writeAt(offset: Long, data: ByteArray)

    /** Compute the SHA-256 of the bytes written so far, as lowercase hex. */
    fun sha256(): String

    /** Atomically finalize the completed file to its destination. */
    fun commit()

    /** Release the handle and discard the file if not committed. */
    fun close()
}

/** The platform-specific file primitives the engine depends on. */
interface FileAdapter {
    /** Open a destination pre-allocated to [totalSize] bytes for positional writes. */
    fun openSparse(name: String, totalSize: Long): SparseFileHandle
}
