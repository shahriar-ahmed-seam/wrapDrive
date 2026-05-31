package com.wrapdrive.net

import com.wrapdrive.core.protocol.Capabilities
import com.wrapdrive.core.protocol.DeviceInfo
import com.wrapdrive.core.protocol.Negotiator
import com.wrapdrive.core.protocol.PrepareUploadRequest
import com.wrapdrive.core.protocol.PrepareUploadResult
import com.wrapdrive.core.protocol.ProtocolJson
import com.wrapdrive.core.protocol.WrapDriveProtocol
import com.wrapdrive.core.transfer.IncomingChunk
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import io.ktor.server.engine.ApplicationEngine
import io.ktor.server.plugins.origin
import io.ktor.server.request.receiveChannel
import io.ktor.server.request.receiveText
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import io.ktor.utils.io.jvm.javaio.toInputStream
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The Ktor HTTP server implementing the WrapDrive v1 receive API on Android.
 *
 * Serves discovery (`/register`, `/info`), the metadata+consent handshake
 * (`/prepare-upload`), chunked upload (`/upload-chunk`), single-stream upload
 * (`/upload`), and `/cancel`. Enforces consent, optional PIN with lockout,
 * per-file tokens + sender-IP pinning, and the single-active-session lock.
 */
class ReceiveServer(
    private val self: DeviceInfo,
    private val capabilities: Capabilities,
    private val sessions: SessionManager,
    private val consentGate: ConsentGate,
    private val discovery: DiscoveryService,
    private val pinProvider: () -> String?,
    private val onFileDone: (name: String) -> Unit = {},
) {
    private val ns = WrapDriveProtocol.API_NAMESPACE
    private var engine: ApplicationEngine? = null
    private val pinAttempts = HashMap<String, Int>()

    /**
     * Start the receive server. Returns true if it bound successfully.
     *
     * The CIO engine binds on a background coroutine, so a late
     * [java.net.BindException] would otherwise crash the process. We therefore
     * pre-check that the port is free with a throwaway [java.net.ServerSocket]
     * (synchronous, catchable) and only start Ktor when the bind will succeed.
     */
    fun start(port: Int = WrapDriveProtocol.DEFAULT_PORT): Boolean {
        if (engine != null) return true // already running; never start twice
        if (!isPortFree(port)) {
            android.util.Log.w("WrapDrive", "port $port is in use")
            return false
        }
        return try {
            val created =
                embeddedServer(CIO, port = port) {
                    routing {
                        get("$ns/info") {
                        call.respondText(ProtocolJson.serialize(self), status = HttpStatusCode.OK)
                    }

                    post("$ns/register") {
                        val body = call.receiveText()
                        runCatching {
                            val obj = AnnouncementCodec.decode(bodyWithDefaults(body))
                            discovery.onRegister(obj.info, obj.capabilities, call.request.origin.remoteHost)
                        }
                        call.respondText(
                            AnnouncementCodec.encode(self, capabilities),
                            status = HttpStatusCode.OK,
                        )
                    }

                    post("$ns/prepare-upload") {
                        handlePrepareUpload()
                    }

                    post("$ns/upload-chunk") {
                        handleUploadChunk()
                    }

                    post("$ns/cancel") {
                        val sessionId = call.request.queryParameters["sessionId"]
                        if (sessionId != null) sessions.endSession(sessionId)
                        call.respondText("ok", status = HttpStatusCode.OK)
                    }
                }
            }
            created.start(wait = false)
            engine = created
            true
        } catch (t: Throwable) {
            android.util.Log.e("WrapDrive", "failed to start receive server on :$port", t)
            false
        }
    }

    fun stop() {
        engine?.stop(500, 1000)
        engine = null
    }

    /** True if [port] can currently be bound (synchronous, catchable check). */
    private fun isPortFree(port: Int): Boolean =
        try {
            java.net.ServerSocket().use { socket ->
                socket.reuseAddress = false
                socket.bind(java.net.InetSocketAddress(port))
                true
            }
        } catch (_: Exception) {
            false
        }

    // --- Handlers (extension on the call's pipeline) -----------------------

    private suspend fun io.ktor.util.pipeline.PipelineContext<Unit, io.ktor.server.application.ApplicationCall>.handlePrepareUpload() {
        val ip = call.request.origin.remoteHost
        val req: PrepareUploadRequest =
            runCatching { ProtocolJson.parsePrepareUploadRequest(call.receiveText()) }.getOrNull()
                ?: run {
                    call.respondText("bad request", status = HttpStatusCode.BadRequest)
                    return
                }

        // PIN gate with per-IP lockout.
        val requiredPin = pinProvider()
        if (requiredPin != null) {
            val attempts = synchronized(pinAttempts) { pinAttempts.getOrDefault(ip, 0) }
            if (attempts >= 5) {
                call.respondText("locked", status = HttpStatusCode.TooManyRequests)
                return
            }
            if (req.pin != requiredPin) {
                synchronized(pinAttempts) { pinAttempts[ip] = attempts + 1 }
                call.respondText("pin", status = HttpStatusCode.Unauthorized)
                return
            }
            synchronized(pinAttempts) { pinAttempts.remove(ip) }
        }

        // Single active session lock.
        if (sessions.hasActiveSession()) {
            call.respondText("busy", status = HttpStatusCode.Conflict)
            return
        }

        // Consent gate (60s timeout treated as decline).
        val decision =
            withTimeoutOrNull(60_000) {
                consentGate.request(
                    ConsentRequest(req.info, req.files.values.toList(), requiredPin != null),
                )
            }
        if (decision == null || !decision.accepted) {
            call.respondText("declined", status = HttpStatusCode.Forbidden)
            return
        }

        val totalSize = req.files.values.sumOf { it.size }
        val plan = Negotiator.negotiate(req.capabilities, capabilities, totalSize)
        val session = sessions.createSession(ip, plan, req.files)
        if (session == null) {
            call.respondText("busy", status = HttpStatusCode.Conflict)
            return
        }

        val result =
            PrepareUploadResult(
                sessionId = session.sessionId,
                files = session.files.mapValues { it.value.token },
                acceptedPlan = plan,
            )
        call.respondText(ProtocolJson.serialize(result), status = HttpStatusCode.OK)
    }

    private suspend fun io.ktor.util.pipeline.PipelineContext<Unit, io.ktor.server.application.ApplicationCall>.handleUploadChunk() {
        val q = call.request.queryParameters
        val ip = call.request.origin.remoteHost
        val sessionId = q["sessionId"] ?: return badRequest()
        val fileId = q["fileId"] ?: return badRequest()
        val token = q["token"] ?: return badRequest()
        val offset = q["offset"]?.toLongOrNull() ?: return badRequest()
        val length = q["length"]?.toIntOrNull() ?: return badRequest()
        val chunkIndex = q["chunkIndex"]?.toIntOrNull() ?: return badRequest()

        val file =
            sessions.authorize(sessionId, fileId, token, ip)
                ?: run {
                    call.respondText("forbidden", status = HttpStatusCode.Forbidden)
                    return
                }

        val data = call.receiveChannel().toInputStream().readBytes()
        val outcome =
            runCatching {
                    file.receiver.receiveChunk(IncomingChunk(chunkIndex, offset, length, data))
                }
                .getOrElse {
                    call.respondText("bad chunk", status = HttpStatusCode.BadRequest)
                    return
                }
        if (outcome is com.wrapdrive.core.transfer.ReceiveOutcome.Done) {
            onFileDone(outcome.name)
        }
        call.respondText("ok", status = HttpStatusCode.OK)
    }

    private suspend fun io.ktor.util.pipeline.PipelineContext<Unit, io.ktor.server.application.ApplicationCall>.badRequest() {
        call.respondText("bad request", status = HttpStatusCode.BadRequest)
    }

    /** A register body may be a bare DeviceInfo+capabilities; normalize it. */
    private fun bodyWithDefaults(body: String): String = body
}
