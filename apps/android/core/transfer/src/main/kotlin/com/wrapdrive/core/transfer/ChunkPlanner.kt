package com.wrapdrive.core.transfer

import com.wrapdrive.core.protocol.ChunkRef

/**
 * Chunk planning (Kotlin port).
 *
 * Splits a file into an ordered list of [ChunkRef]s that exactly tile
 * `[0, fileSize)` — contiguous, no gaps, no overlaps — identical to the
 * TypeScript `planChunks`. See section 6.1 of the protocol spec.
 */
object ChunkPlanner {
    /**
     * Plan the chunks for a file.
     *
     * @param fileSize total file size in bytes; must be `>= 0`
     * @param chunkSize maximum chunk size in bytes; must be `> 0`
     * @throws IllegalArgumentException if arguments are out of range
     */
    fun planChunks(fileSize: Long, chunkSize: Long): List<ChunkRef> {
        require(fileSize >= 0) { "fileSize must be non-negative" }
        require(chunkSize > 0) { "chunkSize must be positive" }

        val chunks = ArrayList<ChunkRef>()
        var offset = 0L
        var index = 0
        while (offset < fileSize) {
            val length = minOf(chunkSize, fileSize - offset)
            chunks.add(ChunkRef(index = index, offset = offset, length = length))
            offset += length
            index += 1
        }
        return chunks
    }
}
