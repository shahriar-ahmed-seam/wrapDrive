package com.wrapdrive.core.transfer

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.long
import io.kotest.property.checkAll

/**
 * Property 1 — Chunk coverage and tiling (Kotlin).
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */
class ChunkPlannerTest : StringSpec({
    "tiles [0, fileSize) contiguously with no gaps or overlaps" {
        checkAll(Arb.long(0L, 1_000_000L), Arb.long(1L, 1_000_000L)) { fileSize, chunkSize ->
            val chunkCount = if (chunkSize >= fileSize) 1 else (fileSize / chunkSize) + 1
            if (chunkCount <= 5000) {
                val chunks = ChunkPlanner.planChunks(fileSize, chunkSize)

                chunks.sumOf { it.length } shouldBe fileSize

                var expectedOffset = 0L
                chunks.forEachIndexed { i, c ->
                    c.index shouldBe i
                    c.offset shouldBe expectedOffset
                    (c.length > 0) shouldBe true
                    if (i < chunks.size - 1) {
                        c.length shouldBe chunkSize
                    } else {
                        (c.length <= chunkSize) shouldBe true
                    }
                    expectedOffset += c.length
                }
            }
        }
    }

    "returns an empty list for a zero-size file" {
        ChunkPlanner.planChunks(0, 1024) shouldBe emptyList()
    }

    "handles exact multiples and remainders" {
        ChunkPlanner.planChunks(100, 25).map { it.length } shouldBe listOf(25L, 25L, 25L, 25L)
        ChunkPlanner.planChunks(90, 25).map { it.length } shouldBe listOf(25L, 25L, 25L, 15L)
        ChunkPlanner.planChunks(10, 25).map { it.length } shouldBe listOf(10L)
    }

    "rejects invalid arguments" {
        shouldThrow<IllegalArgumentException> { ChunkPlanner.planChunks(-1, 10) }
        shouldThrow<IllegalArgumentException> { ChunkPlanner.planChunks(10, 0) }
    }
})
