package com.wrapdrive.core.protocol

import kotlinx.serialization.Serializable

/**
 * WrapDrive v1 wire-protocol data models (Kotlin port).
 *
 * These mirror the TypeScript `@wrapdrive/protocol` models field-for-field and
 * serialize to byte-identical canonical JSON (verified by the shared test
 * vectors). Field names match LocalSend v2.1 where they overlap.
 */

/** The category of a device. */
enum class DeviceType {
    mobile,
    desktop,
    web,
    headless,
    server,
}

/** Transport scheme. v1 always uses `http`. */
enum class Protocol {
    http,
    https,
}

/** Resolved transfer mode after negotiation. */
enum class TransferMode {
    `parallel-chunked`,
    `single-stream`,
}

/** Lifecycle states reported through [TransferProgress]. */
enum class TransferState {
    negotiating,
    transferring,
    verifying,
    done,
    failed,
    cancelled,
}

/** Identity broadcast by a device during discovery and registration. */
@Serializable
data class DeviceInfo(
    val alias: String,
    val version: String,
    val deviceModel: String?,
    val deviceType: DeviceType?,
    val fingerprint: String,
    val port: Int,
    val protocol: Protocol,
    val download: Boolean,
)

/** The WrapDrive capability advertisement that drives transfer negotiation. */
@Serializable
data class Capabilities(
    val appProtocol: String,
    val parallelChunkedSend: Boolean,
    val parallelChunkedReceive: Boolean,
    val maxParallelConnections: Int,
    val minChunkSize: Long,
    val maxChunkSize: Long,
    val chunkProtocolVersions: List<String>,
)

/** The negotiated agreement that governs how a session moves bytes. */
@Serializable
data class TransferPlan(
    val mode: TransferMode,
    val chunkSize: Long,
    val parallelism: Int,
    val chunkProtocolVersion: String?,
)

/** Metadata describing a single file offered in a transfer. */
@Serializable
data class FileMeta(
    val id: String,
    val fileName: String,
    val size: Long,
    val fileType: String,
    val sha256: String?,
    val preview: String?,
)

/** A contiguous byte range of a single file. */
@Serializable
data class ChunkRef(
    val index: Int,
    val offset: Long,
    val length: Long,
    val sha256: String? = null,
)

/** Body of `POST /prepare-upload`. */
@Serializable
data class PrepareUploadRequest(
    val info: DeviceInfo,
    val capabilities: Capabilities,
    val files: Map<String, FileMeta>,
    val proposedPlan: TransferPlan,
    val pin: String? = null,
)

/** Successful `POST /prepare-upload` response. */
@Serializable
data class PrepareUploadResult(
    val sessionId: String,
    val files: Map<String, String>,
    val acceptedPlan: TransferPlan,
)

/** A progress snapshot emitted by the transfer engine for one file. */
@Serializable
data class TransferProgress(
    val sessionId: String,
    val fileId: String,
    val bytesTransferred: Long,
    val totalBytes: Long,
    val chunksCompleted: Int,
    val totalChunks: Int,
    val bytesPerSecond: Long,
    val state: TransferState,
)
