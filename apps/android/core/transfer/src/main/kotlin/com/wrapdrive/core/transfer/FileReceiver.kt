package com.wrapdrive.core.transfer

import com.wrapdrive.core.protocol.FileMeta
import java.util.concurrent.ConcurrentHashMap

/** Context describing a single incoming chunk. */
data class IncomingChunk(
    val index: Int,
    val offset: Long,
    val length: Int,
    val data: ByteArray,
) {
    override fun equals(other: Any?): Boolean = this === other
    override fun hashCode(): Int = index
}

/** Terminal outcome of a file receive. */
sealed interface ReceiveOutcome {
    data object InProgress : ReceiveOutcome
    data class Done(val name: String) : ReceiveOutcome
}

/**
 * Receiver-side chunk assembly with implicit reassembly (Kotlin port).
 *
 * Pre-allocates the destination to its full size, then writes each chunk at its
 * byte offset. Positional, idempotent writes mean any arrival order yields a
 * byte-identical file and concurrent writes to disjoint ranges are safe. When
 * all chunks are recorded the whole-file hash is verified (when provided) and
 * the file committed; otherwise discarded.
 */
class FileReceiver private constructor(
    private val meta: FileMeta,
    private val handle: SparseFileHandle,
    private val totalChunks: Int,
) {
    private val recorded = ConcurrentHashMap.newKeySet<Int>()
    @Volatile private var settled = false

    val receivedCount: Int get() = recorded.size

    companion object {
        /**
         * Open a receiver, pre-allocating the destination to the full size.
         *
         * @throws AllocationException if pre-allocation fails; nothing is written.
         */
        fun open(adapter: FileAdapter, meta: FileMeta, chunkSize: Long): FileReceiver {
            val handle =
                try {
                    adapter.openSparse(meta.fileName, meta.size)
                } catch (cause: Exception) {
                    throw AllocationException(
                        "failed to pre-allocate ${meta.size} bytes for ${meta.fileName}: $cause",
                    )
                }
            val effective = if (chunkSize > 0) chunkSize else maxOf(meta.size, 1)
            val total = ChunkPlanner.planChunks(meta.size, effective).size
            return FileReceiver(meta, handle, total)
        }
    }

    /**
     * Validate and write one chunk, finalizing if it completes the file.
     *
     * @throws ChunkBoundsException on invalid bounds (nothing written)
     * @throws IntegrityException on whole-file hash mismatch
     */
    @Synchronized
    fun receiveChunk(chunk: IncomingChunk): ReceiveOutcome {
        validateBounds(chunk)

        if (recorded.contains(chunk.index)) {
            return if (settled) ReceiveOutcome.Done(meta.fileName) else ReceiveOutcome.InProgress
        }

        handle.writeAt(chunk.offset, chunk.data)
        recorded.add(chunk.index)

        return if (recorded.size < totalChunks) ReceiveOutcome.InProgress else finalize()
    }

    private fun validateBounds(chunk: IncomingChunk) {
        if (chunk.offset < 0) {
            throw ChunkBoundsException("chunk ${chunk.index} offset ${chunk.offset} is negative")
        }
        if (chunk.offset + chunk.length > meta.size) {
            throw ChunkBoundsException(
                "chunk ${chunk.index} range exceeds file size ${meta.size}",
            )
        }
        if (chunk.data.size != chunk.length) {
            throw ChunkBoundsException(
                "chunk ${chunk.index} body ${chunk.data.size} != declared ${chunk.length}",
            )
        }
    }

    private fun finalize(): ReceiveOutcome {
        val expected = meta.sha256
        if (expected != null) {
            val actual = handle.sha256()
            if (!actual.equals(expected, ignoreCase = true)) {
                handle.close()
                settled = true
                throw IntegrityException(
                    "integrity check failed for ${meta.fileName}: expected $expected, got $actual",
                )
            }
        }
        handle.commit()
        settled = true
        return ReceiveOutcome.Done(meta.fileName)
    }

    /** Abort the receive, discarding the partial file. */
    @Synchronized
    fun abort() {
        if (settled) return
        settled = true
        handle.close()
    }
}
