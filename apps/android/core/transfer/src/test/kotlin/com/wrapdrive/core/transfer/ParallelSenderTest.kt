package com.wrapdrive.core.transfer

import com.wrapdrive.core.protocol.FileMeta
import com.wrapdrive.core.protocol.TransferMode
import com.wrapdrive.core.protocol.TransferPlan
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.byte
import io.kotest.property.arbitrary.byteArray
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest

/**
 * Property 5 — Bounded concurrency (Kotlin), plus delivery, retry recovery, and
 * failure/cancel behavior.
 *
 * Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
 */
class ParallelSenderTest : StringSpec({
    val target = UploadTarget("s1", "f1", "tok")
    fun meta(size: Long, sha: String?): FileMeta =
        FileMeta("f1", "blob.bin", size, "application/octet-stream", sha, null)
    fun plan(chunkSize: Long, parallelism: Int): TransferPlan =
        TransferPlan(TransferMode.`parallel-chunked`, chunkSize, parallelism, "wd-chunk/1")

    val noBackoff = RetryPolicy(initialBackoffMs = 0, maxBackoffMs = 0)

    "Property 5: in-flight uploads never exceed parallelism" {
        checkAll(
            Arb.byteArray(Arb.int(1, 2048), Arb.byte()),
            Arb.int(64, 512),
            Arb.int(1, 8),
        ) { source, chunkSize, parallelism ->
            runBlocking {
                val adapter = MemoryFileAdapter()
                val receiver =
                    FileReceiver.open(adapter, meta(source.size.toLong(), sha256Hex(source)), chunkSize.toLong())
                val transport = FakeTransport(receiver)
                val sender = ParallelSender(transport, noBackoff) {}

                sender.send(target, MemoryLocalFile(source), plan(chunkSize.toLong(), parallelism))

                transport.peakInFlight shouldBeLessThanOrEqual parallelism
                sha256Hex(adapter.committed.getValue("blob.bin")) shouldBe sha256Hex(source)
            }
        }
    }

    "delivers every chunk and the file arrives intact" {
        runTest {
            val adapter = MemoryFileAdapter()
            val source = ByteArray(1000) { (it % 256).toByte() }
            val receiver = FileReceiver.open(adapter, meta(1000, sha256Hex(source)), 100)
            val transport = FakeTransport(receiver)
            val sender = ParallelSender(transport, noBackoff) {}

            sender.send(target, MemoryLocalFile(source), plan(100, 4))
            adapter.committed.getValue("blob.bin") shouldBe source
        }
    }

    "retries transient 5xx and still succeeds" {
        runTest {
            val adapter = MemoryFileAdapter()
            val source = ByteArray(500) { ((it * 7) % 256).toByte() }
            val receiver = FileReceiver.open(adapter, meta(500, sha256Hex(source)), 100)
            val transport = FakeTransport(receiver, mapOf(2 to listOf(503, 503)))
            val sender = ParallelSender(transport, noBackoff) {}

            sender.send(target, MemoryLocalFile(source), plan(100, 3))
            adapter.committed.getValue("blob.bin") shouldBe source
            transport.cancelCount shouldBe 0
        }
    }

    "aborts and cancels on a non-retriable 4xx" {
        runTest {
            val adapter = MemoryFileAdapter()
            val source = ByteArray(500) { 9 }
            val receiver = FileReceiver.open(adapter, meta(500, null), 100)
            val transport = FakeTransport(receiver, mapOf(1 to listOf(403)))
            val sender = ParallelSender(transport, noBackoff) {}

            shouldThrow<TransferAbortedException> {
                sender.send(target, MemoryLocalFile(source), plan(100, 2))
            }
            transport.cancelCount shouldBe 1
        }
    }

    "fails and cancels after exhausting retries" {
        runTest {
            val adapter = MemoryFileAdapter()
            val source = ByteArray(300) { 1 }
            val receiver = FileReceiver.open(adapter, meta(300, null), 100)
            val transport = FakeTransport(receiver, mapOf(0 to List(6) { 500 }))
            val sender = ParallelSender(transport, noBackoff) {}

            shouldThrow<TransferAbortedException> {
                sender.send(target, MemoryLocalFile(source), plan(100, 1))
            }
            transport.cancelCount shouldBe 1
        }
    }
})
