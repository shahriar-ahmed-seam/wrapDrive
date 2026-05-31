package com.wrapdrive.core.transfer

import com.wrapdrive.core.protocol.FileMeta
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.byte
import io.kotest.property.arbitrary.byteArray
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll

/**
 * Property 2 — reassembly order-independence, and Property 8 — integrity gate
 * (Kotlin), plus bounds and duplicate handling.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.8, 9.8, 9.9
 */
class FileReceiverTest : StringSpec({
    fun meta(size: Long, sha: String?): FileMeta =
        FileMeta("f1", "blob.bin", size, "application/octet-stream", sha, null)

    "Property 2: any chunk arrival order yields a byte-identical file" {
        checkAll(
            Arb.byteArray(Arb.int(1, 4096), Arb.byte()),
            Arb.int(1, 512),
        ) { source, chunkSize ->
            val adapter = MemoryFileAdapter()
            val sha = sha256Hex(source)
            val receiver = FileReceiver.open(adapter, meta(source.size.toLong(), sha), chunkSize.toLong())
            val chunks = ChunkPlanner.planChunks(source.size.toLong(), chunkSize.toLong()).shuffled()

            var done = false
            for (c in chunks) {
                val slice = source.copyOfRange(c.offset.toInt(), (c.offset + c.length).toInt())
                val outcome =
                    receiver.receiveChunk(
                        IncomingChunk(c.index, c.offset, c.length.toInt(), slice),
                    )
                if (outcome is ReceiveOutcome.Done) done = true
            }
            done shouldBe true
            sha256Hex(adapter.committed.getValue("blob.bin")) shouldBe sha
        }
    }

    "Property 8: corrupted data fails the integrity gate and commits nothing" {
        val adapter = MemoryFileAdapter()
        val source = ByteArray(500) { (it % 256).toByte() }
        val receiver = FileReceiver.open(adapter, meta(500, sha256Hex(source)), 100)
        val chunks = ChunkPlanner.planChunks(500, 100)
        shouldThrow<IntegrityException> {
            for (c in chunks) {
                val slice = source.copyOfRange(c.offset.toInt(), (c.offset + c.length).toInt())
                if (c.index == 0) slice[0] = (slice[0] + 1).toByte()
                receiver.receiveChunk(IncomingChunk(c.index, c.offset, c.length.toInt(), slice))
            }
        }
        adapter.committed.containsKey("blob.bin") shouldBe false
    }

    "commits without a hash when all chunks arrive" {
        val adapter = MemoryFileAdapter()
        val source = ByteArray(10) { it.toByte() }
        val receiver = FileReceiver.open(adapter, meta(10, null), 3)
        for (c in ChunkPlanner.planChunks(10, 3)) {
            val slice = source.copyOfRange(c.offset.toInt(), (c.offset + c.length).toInt())
            receiver.receiveChunk(IncomingChunk(c.index, c.offset, c.length.toInt(), slice))
        }
        adapter.committed.getValue("blob.bin") shouldBe source
    }

    "records duplicate indices once and rejects out-of-bounds chunks" {
        val adapter = MemoryFileAdapter()
        val receiver = FileReceiver.open(adapter, meta(10, null), 5)
        receiver.receiveChunk(IncomingChunk(0, 0, 5, ByteArray(5)))
        receiver.receiveChunk(IncomingChunk(0, 0, 5, ByteArray(5)))
        receiver.receivedCount shouldBe 1

        shouldThrow<ChunkBoundsException> {
            receiver.receiveChunk(IncomingChunk(1, 8, 5, ByteArray(5)))
        }
        shouldThrow<ChunkBoundsException> {
            receiver.receiveChunk(IncomingChunk(1, 5, 5, ByteArray(4)))
        }
    }

    "AllocationException when pre-allocation fails" {
        val failing =
            object : FileAdapter {
                override fun openSparse(name: String, totalSize: Long): SparseFileHandle =
                    throw RuntimeException("disk full")
            }
        shouldThrow<AllocationException> { FileReceiver.open(failing, meta(100, null), 10) }
    }
})
