package com.wrapdrive.core.protocol

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.long
import io.kotest.property.arbitrary.orNull
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll

/**
 * Property 6 — Roundtrip serialization (Kotlin): `parse(serialize(msg)) == msg`
 * for every model, including null optionals.
 *
 * Validates: Requirements 8.1, 7.3, 7.5
 */
class SerializationTest : StringSpec({
    val arbDeviceInfo: Arb<DeviceInfo> =
        Arb.bind(
            Arb.string(1, 32),
            Arb.string(1, 8),
            Arb.string(0, 16).orNull(),
            Arb.enum<DeviceType>().orNull(),
            Arb.string(1, 24),
            Arb.int(1024, 65535),
            Arb.enum<Protocol>(),
            Arb.boolean(),
        ) { alias, version, model, type, fp, port, proto, download ->
            DeviceInfo(alias, version, model, type, fp, port, proto, download)
        }

    val arbFileMeta: Arb<FileMeta> =
        Arb.bind(
            Arb.string(1, 16),
            Arb.string(1, 32),
            Arb.long(0L, Long.MAX_VALUE / 2),
            Arb.string(1, 24),
            Arb.string(64, 64).orNull(),
            Arb.string(0, 16).orNull(),
        ) { id, name, size, type, sha, preview -> FileMeta(id, name, size, type, sha, preview) }

    "DeviceInfo round-trips" {
        checkAll(arbDeviceInfo) { info ->
            ProtocolJson.parseDeviceInfo(ProtocolJson.serialize(info)) shouldBe info
        }
    }

    "FileMeta round-trips" {
        checkAll(arbFileMeta) { file ->
            ProtocolJson.parseFileMeta(ProtocolJson.serialize(file)) shouldBe file
        }
    }

    "TransferPlan round-trips" {
        checkAll(
            Arb.enum<TransferMode>(),
            Arb.long(0L, Long.MAX_VALUE / 2),
            Arb.int(1, 16),
            Arb.string(1, 12).orNull(),
        ) { mode, chunkSize, parallelism, version ->
            val plan = TransferPlan(mode, chunkSize, parallelism, version)
            ProtocolJson.parseTransferPlan(ProtocolJson.serialize(plan)) shouldBe plan
        }
    }
})
