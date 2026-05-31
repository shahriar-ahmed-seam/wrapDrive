package com.wrapdrive.core.transfer

/** Identifies the session/file/token a chunk or upload belongs to. */
data class UploadTarget(val sessionId: String, val fileId: String, val token: String)

/** One chunk upload request. */
data class ChunkUpload(
    val target: UploadTarget,
    val chunkIndex: Int,
    val offset: Long,
    val length: Int,
    val data: ByteArray,
) {
    override fun equals(other: Any?): Boolean = this === other
    override fun hashCode(): Int = chunkIndex
}

/** Abstraction over the sender's network calls (HTTP client in production). */
interface SenderTransport {
    /** POST one chunk (`/upload-chunk`). Returns an HTTP-style status. */
    suspend fun uploadChunk(upload: ChunkUpload): Int

    /** POST `/cancel` for a session. Best-effort. */
    suspend fun cancel(sessionId: String)
}
