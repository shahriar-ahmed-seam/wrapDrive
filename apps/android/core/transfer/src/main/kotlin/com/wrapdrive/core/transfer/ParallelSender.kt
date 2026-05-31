package com.wrapdrive.core.transfer

import com.wrapdrive.core.protocol.TransferMode
import com.wrapdrive.core.protocol.TransferPlan
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Progress callback signalled after each chunk completes. */
fun interface ChunkProgress {
    fun onProgress(completed: Int, total: Int, bytes: Long)
}

/**
 * Parallel send scheduler (Kotlin port).
 *
 * Launches exactly `parallelism` coroutine workers that pull chunk indices from
 * a shared cursor, so in-flight uploads never exceed `parallelism`. Each chunk
 * is read on demand (memory bounded by `parallelism × chunkSize`) and retried
 * on transient failures with exponential backoff; a 4xx aborts immediately. On
 * any unrecoverable failure the session is cancelled and the error rethrown.
 */
class ParallelSender(
    private val transport: SenderTransport,
    private val retryPolicy: RetryPolicy = RetryPolicy.DEFAULT,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    /**
     * Send [file] to the receiver as parallel chunks per [plan].
     *
     * @throws TransferAbortedException if a chunk cannot be delivered
     */
    suspend fun send(
        target: UploadTarget,
        file: LocalFile,
        plan: TransferPlan,
        onProgress: ChunkProgress? = null,
    ) {
        require(plan.mode == TransferMode.`parallel-chunked`) {
            "ParallelSender requires a parallel-chunked plan"
        }

        val chunks = ChunkPlanner.planChunks(file.size, plan.chunkSize)
        val total = chunks.size
        val cursor = AtomicInteger(0)
        val completed = AtomicInteger(0)
        val progressLock = Mutex()
        var bytesSent = 0L
        val aborted = AtomicReference<Throwable?>(null)

        suspend fun deliver(upload: ChunkUpload) {
            var attempt = 0
            while (true) {
                val status =
                    try {
                        transport.uploadChunk(upload)
                    } catch (_: Exception) {
                        0 // network error → treat as transient
                    }
                if (status == 200) return
                if (RetryPolicy.isClientError(status)) {
                    throw TransferAbortedException(
                        "chunk ${upload.chunkIndex} rejected with status $status",
                    )
                }
                val transient = status == 0 || RetryPolicy.isRetriable(status)
                if (!transient || attempt >= retryPolicy.maxRetries) {
                    throw TransferAbortedException(
                        "chunk ${upload.chunkIndex} failed after $attempt retries (status $status)",
                    )
                }
                attempt += 1
                sleep(retryPolicy.backoffMs(attempt))
            }
        }

        coroutineScope {
            val workerCount = minOf(plan.parallelism, maxOf(total, 1))
            repeat(workerCount) {
                launch {
                    while (aborted.get() == null) {
                        val i = cursor.getAndIncrement()
                        if (i >= total) break
                        val chunk = chunks[i]
                        try {
                            val data = file.readRange(chunk.offset, chunk.length.toInt())
                            deliver(
                                ChunkUpload(
                                    target = target,
                                    chunkIndex = chunk.index,
                                    offset = chunk.offset,
                                    length = chunk.length.toInt(),
                                    data = data,
                                ),
                            )
                        } catch (t: Throwable) {
                            aborted.compareAndSet(null, t)
                            break
                        }
                        val done = completed.incrementAndGet()
                        val sent = progressLock.withLock { bytesSent += chunk.length; bytesSent }
                        onProgress?.onProgress(done, total, sent)
                    }
                }
            }
        }

        aborted.get()?.let {
            runCatching { transport.cancel(target.sessionId) }
            throw it
        }
    }
}
