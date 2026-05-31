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
import com.wrapdrive.ui.WrapDriveViewModel
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Composition root for the Android networking + transfer stack.
 *
 * Wires the [DiscoveryService], the [ReceiveServer] (with consent/PIN gate and
 * session manager), and the sender path into the [WrapDriveViewModel]. Exposes
 * a demo send used by the UI's tap-to-send and the two-AVD interop test.
 */
class AppContainer(
    context: Context,
    private val vm: WrapDriveViewModel,
    private val scope: CoroutineScope,
) {
    private val filesDir: File = context.filesDir
    private val downloads = File(filesDir, "received").apply { mkdirs() }
    private val outbox = File(filesDir, "outbox").apply { mkdirs() }

    private val self =
        DeviceIdentity.deviceInfo(alias = aliasFor(), model = Build.MODEL ?: "Android")
    private val capabilities = DeviceIdentity.capabilities()

    private val adapter = FileSystemFileAdapter(downloads)
    private val sessions = SessionManager(adapter)
    private val client = HttpClient(CIO)

    @Volatile private var pin: String? = null
    @Volatile private var pendingConsent: CompletableDeferred<ConsentDecision>? = null

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
                withContext(Dispatchers.Main) {
                    vm.showConsent(ConsentUi(consent.from.alias, summary, consent.pinRequired))
                }
                val decision = deferred.await()
                withContext(Dispatchers.Main) { vm.showConsent(null) }
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
            onFileDone = { name -> scope.launch(Dispatchers.Main) { vm.markCompleted(name) } },
        )

    fun start() {
        vm.setSelfAlias(self.alias)
        server.start()
        discovery.start()
        scope.launch(Dispatchers.Main) {
            discovery.peers.collect { vm.setPeers(it) }
        }
    }

    suspend fun stop() {
        discovery.stop()
        server.stop()
        client.close()
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

        val resultJson =
            client
                .post("$baseUrl${WrapDriveProtocol.API_NAMESPACE}/prepare-upload") {
                    setBody(ProtocolJson.serialize(request))
                }
                .bodyAsText()
        val result = ProtocolJson.parsePrepareUploadResult(resultJson)
        val token = result.files.getValue(meta.id)
        val accepted = result.acceptedPlan

        withContext(Dispatchers.Main) {
            vm.updateTransfer(TransferUi(file.name, 0f, 0, "transferring"))
        }

        if (accepted.mode == TransferMode.`parallel-chunked`) {
            val transport = HttpSenderTransport(baseUrl)
            val sender = ParallelSender(transport)
            val progress =
                ChunkProgress { completed, total, bytes ->
                    val fraction = completed.toFloat() / total
                    scope.launch(Dispatchers.Main) {
                        vm.updateTransfer(TransferUi(file.name, fraction, bytes, "transferring"))
                    }
                }
            sender.send(
                UploadTarget(result.sessionId, meta.id, token),
                FileSystemLocalFile(file),
                accepted,
                progress,
            )
            transport.close()
        }

        withContext(Dispatchers.Main) { vm.markCompleted(file.name) }
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
