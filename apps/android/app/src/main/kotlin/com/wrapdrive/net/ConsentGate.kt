package com.wrapdrive.net

import com.wrapdrive.core.protocol.DeviceInfo
import com.wrapdrive.core.protocol.FileMeta

/** A pending consent prompt the UI must resolve. */
data class ConsentRequest(
    val from: DeviceInfo,
    val files: List<FileMeta>,
    val pinRequired: Boolean,
)

/** The user's decision on a consent prompt. */
data class ConsentDecision(val accepted: Boolean, val pin: String? = null)

/**
 * Bridges the receiver server and the UI for the consent + PIN gate. The server
 * calls [request] and suspends until the UI resolves it (or it times out after
 * 60s, treated as a decline).
 */
interface ConsentGate {
    suspend fun request(consent: ConsentRequest): ConsentDecision
}
