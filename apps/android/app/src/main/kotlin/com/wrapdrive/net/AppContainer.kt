package com.wrapdrive.net

import android.content.Context
import android.os.Build
import com.wrapdrive.core.protocol.FileMeta
import com.wrapdrive.core.protocol.Negotiator
import com.wrapdrive.core.protocol.PrepareUploadRequest
import com.wrapdrive.core.protocol.ProtocolJson
import com.wrapdrive.core.protocol.TransferMode
import com.wrapdrive.core.protocol.WrapDriveProtocol
import com.wrapdrive.core.transfer.ChunkProgress
import com.wrapdrive.core.transfer.FileSystemFileAdapter
import com.wrapdrive.core.transfer.FileSystemLocalFile
import com.wrapdrive.core.transfer.ParallelSender
import com.wrapdrive.core.transfer.UploadTarget
import com.wrapdrive.ui.ConsentUi
import com.wrapdrive.ui.TransferUi
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/**
 * Composition root for the Android networking + transfer stack.
 *
 * This is a **process-level singleton** ([getInstance]) started exactly once via
 * [start]. That matters because Android can recreate the Activity (config
 * change, process restart); without the singleton each recreation would spin up
 * a second [ReceiveServer] on the same port and fail with "Address already in
 * use". The container owns its own state flows; the UI observes them.
 */
class AppContainer private constructor(
    context: Context,
    private val scope: CoroutineScope,
) {
    companion object {
        @Volatile private var instance: AppContainer? = null

        /** Get or create the single process-wide container. */
        fun getInstance(context: Context, scope: CoroutineScope): AppContainer =
            instance
                ?: synchronized(this) {
                    instance ?: AppContainer(context.applicationContext, scope).also { instance = it }
                }
    }

    private val filesDir: File = context.filesDir
    private val downloads = File(filesDir, "received").apply { mkdirs() }
    private val outbox = File(filesDir, "outbox").apply { mkdirs() }

    private val self =
        DeviceIdentity.deviceInfo(alias = aliasFor(), model = Build.MODEL ?: "Android")
    private val capabilities = DeviceIdentity.capabilities()

    private val adapter = FileSystemFileAdapter(downloads)
    private val sessions = SessionManager(adapter)
    private val client = HttpClient(CIO)

    @Volatile private var started = false
    @Volatile private var pin: String? = null
    @Volatile private var pendingConsent: CompletableDeferred<ConsentDecision>? = null

    /** This device's display alias, exposed to the UI. */
    val selfAlias: String get() = self.alias

    /** Observable UI state owned by the container (survives Activity recreation). */
    val uiPeers: MutableStateFlow<List<Peer>> = MutableStateFlow(emptyList())
    val uiConsent: MutableStateFlow<ConsentUi?> = MutableStateFlow(null)
    val uiTransfer: MutableStateFlow<TransferUi?> = MutableStateFlow(null)
    val uiError: MutableStateFlow<String?> = MutableStateFlow(null)

    private val discovery =
        DiscoveryService(
            self = self,
            capabilities = capabilities,
            scope = scope,
            onAnnouncementPeer = { address -> registerWith(address) },
        )

    private val consentGate =
        object : ConsentGate {
            override suspend fun request(consent: ConsentRequest): ConsentDecision {
                val deferred = CompletableDeferred<ConsentDecision>()
                pendingConsent = deferred
                val summary =
                    consent.files.joinToString("\n") { "${it.fileName} (${humanSize(it.size)})" }
                uiConsent.value = ConsentUi(consent.from.alias, summary, consent.pinRequired)
                val decision = deferred.await()
                uiConsent.value = null
                return decision
            }
        }

    private val server =
        ReceiveServer(
            self = self,
            capabilities = capabilities,
            sessions = sessions,
            consentGate = consentGate,
            discovery = discovery,
            pinProvider = { pin },
            onFileDone = { name -> uiTransfer.value = null },
        )

    /** Start networking once. Safe to call repeatedly; later calls are no-ops. */
    @Synchronized
    fun start() {
        if (started) return
        started = true
        scope.launch(Dispatchers.IO) {
            // Try the default port, then a small range, so a leftover bind never
            // crashes startup.
            var bound = false
            for (candidate in WrapDriveProtocol.DEFAULT_PORT..(WrapDriveProtocol.DEFAULT_PORT + 5)) {
                if (server.start(candidate)) {
                    bound = true
                    break
                }
            }
            if (!bound) android.util.Log.e("WrapDrive", "could not bind receive server")
            runCatching { discovery.start() }
                .onFailure { android.util.Log.e("WrapDrive", "discovery start failed", it) }
        }
        scope.launch { discovery.peers.collect { uiPeers.value = it } }
    }

    suspend fun stop() {
        discovery.stop()
        server.stop()
        client.close()
        started = false
    }

    /** Resolve a pending consent prompt from the UI. */
    fun resolveConsent(accepted: Boolean) {
        pendingConsent?.complete(ConsentDecision(accepted, pin))
        pendingConsent = null
    }

    /** Send a generated demo file to [peer] (used by UI tap + interop test). */
    suspend fun sendDemoFile(peer: Peer, sizeBytes: Long = 12L * 1024 * 1024) {
        val file = File(outbox, "wrapdrive-demo-${sizeBytes}.bin")
        if (!file.exists() || file.length() != sizeBytes) {
            generateFile(file, sizeBytes)
        }
        sendFile(peer, file)
    }

    /** Send a real file to a peer, negotiating the plan and driving progress. */
    suspend fun sendFile(peer: Peer, file: File) {
        try {
            sendFileInternal(peer, file)
        } catch (t: Throwable) {
            android.util.Log.e("WrapDrive", "send failed", t)
            uiError.value = "Send failed: ${t.message ?: t.javaClass.simpleName}"
            uiTransfer.value = null
        }
    }

    private suspend fun sendFileInternal(peer: Peer, file: File) {
        val baseUrl = "http://${peer.address}:${peer.info.port}"
        val sha = sha256(file)
        val meta =
            FileMeta(
                id = "file-1",
                fileName = file.name,
                size = file.length(),
                fileType = "application/octet-stream",
                sha256 = sha,
                preview = null,
            )
        val plan = Negotiator.negotiate(capabilities, peer.capabilities, file.length())
        val request =
            PrepareUploadRequest(
                info = self,
                capabilities = capabilities,
                files = mapOf(meta.id to meta),
                proposedPlan = plan,
                pin = null,
            )

        uiTransfer.value = TransferUi(file.name, 0f, 0, "waiting for the other device…")

        val response =
            client.post("$baseUrl${WrapDriveProtocol.API_NAMESPACE}/prepare-upload") {
                contentType(ContentType.Application.Json)
                setBody(ProtocolJson.serialize(request))
            }
        if (response.status.value != 200) {
            val reason =
                when (response.status.value) {
                    403 -> "declined by the other device"
                    401 -> "PIN required"
                    409 -> "the other device is busy"
                    else -> "rejected (${response.status.value})"
                }
            uiError.value = "Transfer $reason"
            uiTransfer.value = null
            return
        }

        val result = ProtocolJson.parsePrepareUploadResult(response.bodyAsText())
        val token = result.files[meta.id]
        if (token == null) {
            uiError.value = "Transfer failed: no token issued"
            uiTransfer.value = null
            return
        }
        val accepted = result.acceptedPlan
        val target = UploadTarget(result.sessionId, meta.id, token)
        val transport = HttpSenderTransport(baseUrl)

        try {
            uiTransfer.value = TransferUi(file.name, 0f, 0, "transferring")
            if (accepted.mode == TransferMode.`parallel-chunked`) {
                val sender = ParallelSender(transport)
                sender.send(
                    target,
                    FileSystemLocalFile(file),
                    accepted,
                    ChunkProgress { completed, total, bytes ->
                        uiTransfer.value =
                            TransferUi(file.name, completed.toFloat() / total, bytes, "transferring")
                    },
                )
            } else {
                // Single-stream fallback: one full-file POST to /upload.
                sendSingleStream(baseUrl, target, file)
            }
            uiTransfer.value = TransferUi(file.name, 1f, 0, "done")
        } finally {
            transport.close()
        }
        uiTransfer.value = null
    }

    /** Single-stream upload: one full-file body to /upload. */
    private suspend fun sendSingleStream(baseUrl: String, target: UploadTarget, file: File) {
        client.post(
            "$baseUrl${WrapDriveProtocol.API_NAMESPACE}/upload" +
                "?sessionId=${target.sessionId}&fileId=${target.fileId}&token=${target.token}",
        ) {
            contentType(ContentType.Application.OctetStream)
            setBody(file.readBytes())
        }
    }

    private suspend fun registerWith(address: String) {
        runCatching {
            client.post("http://$address:${WrapDriveProtocol.DEFAULT_PORT}${WrapDriveProtocol.API_NAMESPACE}/register") {
                setBody(AnnouncementCodec.encode(self, capabilities))
            }
        }
    }

    private fun generateFile(file: File, size: Long) {
        file.outputStream().use { out ->
            val buffer = ByteArray(64 * 1024)
            var written = 0L
            var seed = 1
            while (written < size) {
                for (i in buffer.indices) {
                    seed = seed * 1103515245 + 12345
                    buffer[i] = (seed ushr 16).toByte()
                }
                val toWrite = minOf(buffer.size.toLong(), size - written).toInt()
                out.write(buffer, 0, toWrite)
                written += toWrite
            }
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun aliasFor(): String {
        val model = Build.MODEL ?: "Android"
        return "WrapDrive $model"
    }

    private fun humanSize(bytes: Long): String {
        val mb = bytes / (1024.0 * 1024.0)
        return if (mb >= 1) "%.1f MB".format(mb) else "%d KB".format(bytes / 1024)
    }
}
