package com.wrapdrive.net

import com.wrapdrive.core.protocol.Capabilities
import com.wrapdrive.core.protocol.DeviceInfo

/** A discovered peer with its resolved address and last-seen timestamp. */
data class Peer(
    val info: DeviceInfo,
    val capabilities: Capabilities,
    val address: String,
    val lastSeen: Long,
)
