package com.wrapdrive.net

import com.wrapdrive.core.protocol.WrapDriveProtocol
import com.wrapdrive.core.transfer.ChunkUpload
import com.wrapdrive.core.transfer.SenderTransport
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.contentType

/**
 * [SenderTransport] backed by the Ktor CIO client. Posts chunks to the peer's
 * `/upload-chunk` endpoint and supports `/cancel`. Connection pooling/keep-alive
 * is handled by the shared client.
 */
class HttpSenderTransport(
    private val baseUrl: String, // e.g. http://192.168.1.5:53317
) : SenderTransport {
    private val client = HttpClient(CIO)
    private val ns = WrapDriveProtocol.API_NAMESPACE

    override suspend fun uploadChunk(upload: ChunkUpload): Int {
        val url =
            "$baseUrl$ns/upload-chunk" +
                "?sessionId=${upload.target.sessionId}" +
                "&fileId=${upload.target.fileId}" +
                "&token=${upload.target.token}" +
                "&chunkIndex=${upload.chunkIndex}" +
                "&offset=${upload.offset}" +
                "&length=${upload.length}"
        val response: HttpResponse =
            client.post(url) {
                contentType(ContentType.Application.OctetStream)
                setBody(upload.data)
            }
        return response.status.value
    }

    override suspend fun cancel(sessionId: String) {
        runCatching { client.post("$baseUrl$ns/cancel?sessionId=$sessionId") }
    }

    fun close() {
        client.close()
    }
}
