package com.wrapdrive.net

import com.wrapdrive.core.protocol.FileMeta
import com.wrapdrive.core.protocol.TransferPlan
import com.wrapdrive.core.transfer.FileAdapter
import com.wrapdrive.core.transfer.FileReceiver
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Per-file state within an active receive session. */
class FileSession(
    val token: String,
    val meta: FileMeta,
    val receiver: FileReceiver,
)

/** An active receive session, pinned to one sender IP. */
class ReceiveSession(
    val sessionId: String,
    val senderIp: String,
    val plan: TransferPlan,
    val files: Map<String, FileSession>,
) {
    @Volatile var lastActivity: Long = System.currentTimeMillis()
}

/**
 * Enforces the protocol's session rules on the receiver: a single active
 * session at a time, per-file opaque tokens, and sender-IP pinning. The consent
 * and PIN gates are applied by the server before a session is created here.
 */
class SessionManager(private val adapter: FileAdapter) {
    private val active = ConcurrentHashMap<String, ReceiveSession>()
    private val lock = Any()

    /** True if any session is currently active (used to answer 409). */
    fun hasActiveSession(): Boolean = active.isNotEmpty()

    /**
     * Create a session after consent has been granted. Returns null if another
     * session is already active (the caller responds 409).
     */
    fun createSession(
        senderIp: String,
        plan: TransferPlan,
        files: Map<String, FileMeta>,
    ): ReceiveSession? {
        synchronized(lock) {
            if (active.isNotEmpty()) return null
            val sessionId = UUID.randomUUID().toString()
            val fileSessions =
                files.mapValues { (_, meta) ->
                    FileSession(
                        token = UUID.randomUUID().toString(),
                        meta = meta,
                        receiver = FileReceiver.open(adapter, meta, plan.chunkSize),
                    )
                }
            val session = ReceiveSession(sessionId, senderIp, plan, fileSessions)
            active[sessionId] = session
            return session
        }
    }

    fun get(sessionId: String): ReceiveSession? = active[sessionId]

    /** Validate that the request matches the session token and pinned IP. */
    fun authorize(sessionId: String, fileId: String, token: String, ip: String): FileSession? {
        val session = active[sessionId] ?: return null
        if (session.senderIp != ip) return null
        val file = session.files[fileId] ?: return null
        if (file.token != token) return null
        session.lastActivity = System.currentTimeMillis()
        return file
    }

    fun endSession(sessionId: String) {
        active.remove(sessionId)?.files?.values?.forEach { runCatching { it.receiver.abort() } }
    }
}
