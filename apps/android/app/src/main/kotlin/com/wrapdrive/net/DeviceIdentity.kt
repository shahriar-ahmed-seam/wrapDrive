package com.wrapdrive.net

import com.wrapdrive.core.protocol.Capabilities
import com.wrapdrive.core.protocol.DeviceInfo
import com.wrapdrive.core.protocol.DeviceType
import com.wrapdrive.core.protocol.Protocol
import com.wrapdrive.core.protocol.WrapDriveProtocol
import java.util.UUID

/** Builds this device's identity and capabilities for discovery/transfer. */
object DeviceIdentity {
    /** Android is fully chunk-capable for both send and receive. */
    fun capabilities(): Capabilities =
        Capabilities(
            appProtocol = WrapDriveProtocol.APP_PROTOCOL,
            parallelChunkedSend = true,
            parallelChunkedReceive = true,
            maxParallelConnections = 6,
            minChunkSize = 64 * 1024,
            maxChunkSize = 16L * 1024 * 1024,
            chunkProtocolVersions = listOf(WrapDriveProtocol.CHUNK_PROTOCOL_VERSION),
        )

    fun deviceInfo(alias: String, model: String): DeviceInfo =
        DeviceInfo(
            alias = alias,
            version = WrapDriveProtocol.PROTOCOL_VERSION,
            deviceModel = model,
            deviceType = DeviceType.mobile,
            fingerprint = UUID.randomUUID().toString().replace("-", ""),
            port = WrapDriveProtocol.DEFAULT_PORT,
            protocol = Protocol.http,
            download = false,
        )
}
