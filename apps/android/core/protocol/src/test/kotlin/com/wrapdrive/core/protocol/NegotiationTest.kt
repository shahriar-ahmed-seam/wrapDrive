package com.wrapdrive.core.protocol

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.booleans.shouldBeTrue
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.long
import io.kotest.property.arbitrary.subsequence
import io.kotest.property.checkAll

/**
 * Property 3 (negotiation safety) and Property 4 (determinism/idempotence) for
 * the Kotlin negotiator, plus a focused truth table. Mirrors the TypeScript
 * negotiation tests.
 *
 * Validates: Requirements 2.2, 2.3, 2.5, 2.6, 2.7, 2.8, 5.4, 11.1, 11.2
 */
class NegotiationTest : StringSpec({
    val arbCaps: Arb<Capabilities> =
        Arb.bind(
            Arb.boolean(),
            Arb.boolean(),
            Arb.int(1, 16),
            Arb.long(1L, 8L * 1024 * 1024),
            Arb.long(0L, 64L * 1024 * 1024),
            Arb.subsequence(listOf("wd-chunk/1", "wd-chunk/2", "wd-chunk/3")),
        ) { send, receive, conns, minChunk, span, versions ->
            Capabilities(
                appProtocol = WrapDriveProtocol.APP_PROTOCOL,
                parallelChunkedSend = send,
                parallelChunkedReceive = receive,
                maxParallelConnections = conns,
                minChunkSize = minChunk,
                maxChunkSize = minChunk + span,
                chunkProtocolVersions = versions,
            )
        }
    val arbSize = Arb.long(0L, Long.MAX_VALUE / 4)

    fun hasCommon(a: Capabilities, b: Capabilities): Boolean =
        a.chunkProtocolVersions.any { it in b.chunkProtocolVersions }

    "Property 3: parallel-chunked implies both capable and a common protocol" {
        checkAll(arbCaps, arbCaps, arbSize) { sender, receiver, size ->
            val plan = Negotiator.negotiate(sender, receiver, size)
            if (plan.mode == TransferMode.`parallel-chunked`) {
                sender.parallelChunkedSend.shouldBeTrue()
                receiver.parallelChunkedReceive.shouldBeTrue()
                hasCommon(sender, receiver).shouldBeTrue()
                plan.chunkProtocolVersion shouldNotBe null
            }
        }
    }

    "Property 3: missing capability always yields single-stream" {
        checkAll(arbCaps, arbCaps, arbSize) { sender, receiver, size ->
            val incapable =
                !sender.parallelChunkedSend ||
                    !receiver.parallelChunkedReceive ||
                    !hasCommon(sender, receiver)
            if (incapable) {
                Negotiator.negotiate(sender, receiver, size).mode shouldBe TransferMode.`single-stream`
            }
        }
    }

    "Property 4: deterministic for identical inputs" {
        checkAll(arbCaps, arbCaps, arbSize) { sender, receiver, size ->
            Negotiator.negotiate(sender, receiver, size) shouldBe
                Negotiator.negotiate(sender, receiver, size)
        }
    }

    "truth table: fully capable + large file negotiates parallel-chunked" {
        val capable =
            Capabilities(
                appProtocol = WrapDriveProtocol.APP_PROTOCOL,
                parallelChunkedSend = true,
                parallelChunkedReceive = true,
                maxParallelConnections = 8,
                minChunkSize = 1024,
                maxChunkSize = 8L * 1024 * 1024,
                chunkProtocolVersions = listOf("wd-chunk/1"),
            )
        val plan = Negotiator.negotiate(capable, capable, 100L * 1024 * 1024)
        plan.mode shouldBe TransferMode.`parallel-chunked`
        plan.parallelism shouldBe 8
        plan.chunkProtocolVersion shouldBe "wd-chunk/1"

        // A small file falls back to single-stream.
        Negotiator.negotiate(capable, capable, 1000).mode shouldBe TransferMode.`single-stream`
    }
})
