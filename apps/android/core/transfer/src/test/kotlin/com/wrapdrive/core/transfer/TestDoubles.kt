package com.wrapdrive.core.transfer

import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger

/** SHA-256 of a byte array as lowercase hex (test helper). */
fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** In-memory [FileAdapter] backing destination files with byte arrays. */
class MemoryFileAdapter : FileAdapter {
    val committed = HashMap<String, ByteArray>()

    override fun openSparse(name: String, totalSize: Long): SparseFileHandle {
        val buffer = ByteArray(totalSize.toInt())
        return object : SparseFileHandle {
            private var done = false

            override fun writeAt(offset: Long, data: ByteArray) {
                synchronized(buffer) { data.copyInto(buffer, offset.toInt()) }
            }

            override fun sha256(): String = sha256Hex(buffer)

            override fun commit() {
                committed[name] = buffer
                done = true
            }

            override fun close() {
                // discard if not committed
            }
        }
    }
}

/** A [LocalFile] backed by an in-memory byte array. */
class MemoryLocalFile(private val bytes: ByteArray) : LocalFile {
    override val size: Long get() = bytes.size.toLong()

    override fun readRange(offset: Long, length: Int): ByteArray =
        bytes.copyOfRange(offset.toInt(), offset.toInt() + length)
}

/** Fake transport routing chunks into a [FileReceiver], tracking concurrency. */
class FakeTransport(
    private val receiver: FileReceiver,
    private val failuresByIndex: Map<Int, List<Int>> = emptyMap(),
) : SenderTransport {
    @Volatile var peakInFlight = 0
    @Volatile var cancelCount = 0
    private val inFlight = AtomicInteger(0)
    private val attempts = HashMap<Int, Int>()

    override suspend fun uploadChunk(upload: ChunkUpload): Int {
        val now = inFlight.incrementAndGet()
        synchronized(this) { if (now > peakInFlight) peakInFlight = now }
        try {
            kotlinx.coroutines.yield()
            val scripted = failuresByIndex[upload.chunkIndex]
            if (scripted != null) {
                val attempt = synchronized(attempts) { attempts.getOrDefault(upload.chunkIndex, 0) }
                if (attempt < scripted.size) {
                    synchronized(attempts) { attempts[upload.chunkIndex] = attempt + 1 }
                    return scripted[attempt]
                }
            }
            receiver.receiveChunk(
                IncomingChunk(
                    index = upload.chunkIndex,
                    offset = upload.offset,
                    length = upload.length,
                    data = upload.data,
                ),
            )
            return 200
        } finally {
            inFlight.decrementAndGet()
        }
    }

    override suspend fun cancel(sessionId: String) {
        cancelCount += 1
    }
}
