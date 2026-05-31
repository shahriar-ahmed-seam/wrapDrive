package com.wrapdrive.core.protocol

/**
 * Capability negotiation (Kotlin port).
 *
 * Pure function mirroring the TypeScript `negotiate`: it selects
 * `parallel-chunked` only when both peers genuinely support it, a common chunk
 * protocol exists, the size ranges overlap, and the file exceeds one chunk;
 * otherwise `single-stream`. See section 5 of the protocol spec.
 */
object Negotiator {
    /** Default chunk size before clamping: 4 MiB. */
    const val DEFAULT_CHUNK_SIZE: Long = 4L * 1024 * 1024

    /** Upper bound on the number of chunks a single file is split into. */
    const val MAX_CHUNK_COUNT: Long = 10_000

    private fun clamp(value: Long, low: Long, high: Long): Long =
        when {
            value < low -> low
            value > high -> high
            else -> value
        }

    private fun chooseChunkSize(fileSize: Long, low: Long, high: Long): Long {
        var chunkSize = clamp(DEFAULT_CHUNK_SIZE, low, high)
        if (fileSize > chunkSize * MAX_CHUNK_COUNT) {
            val needed = (fileSize + MAX_CHUNK_COUNT - 1) / MAX_CHUNK_COUNT // ceil
            chunkSize = clamp(needed, low, high)
        }
        return chunkSize
    }

    private fun singleStream(fileSize: Long): TransferPlan =
        TransferPlan(
            mode = TransferMode.`single-stream`,
            chunkSize = fileSize,
            parallelism = 1,
            chunkProtocolVersion = null,
        )

    /**
     * Resolve the strongest safe [TransferPlan] for a transfer.
     *
     * @param sender the sending peer's capabilities
     * @param receiver the receiving peer's capabilities
     * @param fileSize the size of the file to transfer, in bytes (>= 0)
     */
    fun negotiate(sender: Capabilities, receiver: Capabilities, fileSize: Long): TransferPlan {
        val common =
            sender.chunkProtocolVersions.filter { it in receiver.chunkProtocolVersions }.sorted()

        val bothCanChunk =
            sender.parallelChunkedSend && receiver.parallelChunkedReceive && common.isNotEmpty()

        val low = maxOf(sender.minChunkSize, receiver.minChunkSize)
        val high = minOf(sender.maxChunkSize, receiver.maxChunkSize)
        val rangesOverlap = low <= high

        if (!bothCanChunk || !rangesOverlap) {
            return singleStream(fileSize)
        }

        val chunkSize = chooseChunkSize(fileSize, low, high)
        if (fileSize <= chunkSize) {
            return singleStream(fileSize)
        }

        val parallelism = maxOf(1, minOf(sender.maxParallelConnections, receiver.maxParallelConnections))

        return TransferPlan(
            mode = TransferMode.`parallel-chunked`,
            chunkSize = chunkSize,
            parallelism = parallelism,
            chunkProtocolVersion = common.last(),
        )
    }
}
