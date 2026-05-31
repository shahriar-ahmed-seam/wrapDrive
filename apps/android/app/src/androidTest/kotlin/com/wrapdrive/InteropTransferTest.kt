package com.wrapdrive

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.wrapdrive.core.protocol.FileMeta
import com.wrapdrive.core.protocol.Negotiator
import com.wrapdrive.core.protocol.PrepareUploadRequest
import com.wrapdrive.core.protocol.ProtocolJson
import com.wrapdrive.core.protocol.TransferMode
import com.wrapdrive.core.protocol.WrapDriveProtocol
import com.wrapdrive.core.transfer.FileSystemFileAdapter
import com.wrapdrive.core.transfer.FileSystemLocalFile
import com.wrapdrive.core.transfer.ParallelSender
import com.wrapdrive.core.transfer.UploadTarget
import com.wrapdrive.net.AnnouncementCodec
import com.wrapdrive.net.ConsentDecision
import com.wrapdrive.net.ConsentGate
import com.wrapdrive.net.ConsentRequest
import com.wrapdrive.net.DeviceIdentity
import com.wrapdrive.net.DiscoveryService
import com.wrapdrive.net.HttpSenderTransport
import com.wrapdrive.net.ReceiveServer
import com.wrapdrive.net.SessionManager
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On-device interop test: a sender peer transfers an 8+ MiB file to a receiver
 * peer (a real Ktor [ReceiveServer]) over the loopback interface, verifying the
 * negotiated plan is `parallel-chunked` and the received file is byte-identical
 * (matching sha256). This exercises the full send→server→reassembly→integrity
 * path on a real Android runtime, the same code that runs across two AVDs.
 *
 * Validates: Requirements 13.3, 13.4
 */
@RunWith(AndroidJUnit4::class)
class InteropTransferTest {
    @Test
    fun parallelChunkedTransferArrivesByteIdentical() = runBlocking {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        val receiverInfo = DeviceIdentity.deviceInfo("Receiver", "AVD-A")
        val senderInfo = DeviceIdentity.deviceInfo("Sender", "AVD-B")
        val caps = DeviceIdentity.capabilities()

        // Receiver writes into a dedicated dir; sender reads from another.
        val inbox = File(ctx.filesDir, "test-inbox").apply { mkdirs() }
        val outbox = File(ctx.filesDir, "test-outbox").apply { mkdirs() }
        val adapter = FileSystemFileAdapter(inbox)
        val sessions = SessionManager(adapter)

        val discovery = DiscoveryService(receiverInfo, caps, scope)
        val autoConsent =
            object : ConsentGate {
                override suspend fun request(consent: ConsentRequest): ConsentDecision =
                    ConsentDecision(accepted = true, pin = null)
            }
        val port = 53400
        val server =
            ReceiveServer(
                self = receiverInfo,
                capabilities = caps,
                sessions = sessions,
                consentGate = autoConsent,
                discovery = discovery,
                pinProvider = { null },
            )
        server.start(port)

        try {
            // Build a 12 MiB deterministic source file.
            val source = File(outbox, "interop.bin")
            generate(source, 12L * 1024 * 1024)
            val sourceHash = sha256(source)

            val baseUrl = "http://127.0.0.1:$port"
            val meta =
                FileMeta(
                    id = "file-1",
                    fileName = "interop.bin",
                    size = source.length(),
                    fileType = "application/octet-stream",
                    sha256 = sourceHash,
                    preview = null,
                )
            val plan = Negotiator.negotiate(caps, caps, source.length())
            assertEquals(TransferMode.`parallel-chunked`, plan.mode)

            val client = HttpClient(CIO)
            val request =
                PrepareUploadRequest(senderInfo, caps, mapOf(meta.id to meta), plan, null)
            val resultJson =
                client
                    .post("$baseUrl${WrapDriveProtocol.API_NAMESPACE}/prepare-upload") {
                        setBody(ProtocolJson.serialize(request))
                    }
                    .bodyAsText()
            val result = ProtocolJson.parsePrepareUploadResult(resultJson)
            assertEquals(TransferMode.`parallel-chunked`, result.acceptedPlan.mode)

            val transport = HttpSenderTransport(baseUrl)
            val sender = ParallelSender(transport)
            sender.send(
                UploadTarget(result.sessionId, meta.id, result.files.getValue(meta.id)),
                FileSystemLocalFile(source),
                result.acceptedPlan,
            )
            transport.close()
            client.close()

            val received = File(inbox, "interop.bin")
            assertTrue("received file should exist", received.exists())
            assertEquals("received size matches", source.length(), received.length())
            assertEquals("received sha256 matches", sourceHash, sha256(received))
        } finally {
            server.stop()
        }
    }

    private fun generate(file: File, size: Long) {
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
}
