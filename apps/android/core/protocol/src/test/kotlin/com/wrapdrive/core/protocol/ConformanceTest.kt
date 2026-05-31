package com.wrapdrive.core.protocol

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Cross-language conformance against the shared test vectors in
 * `protocol-spec/test-vectors/`.
 *
 * For every fixture this asserts the Kotlin serializer emits exactly the
 * vector's `canonicalJson` and that parsing that JSON reproduces the canonical
 * message. The TypeScript suite runs the same vectors, so the two
 * implementations stay byte-compatible.
 *
 * Validates: Requirements 7.3, 7.5, 8.2
 */
class ConformanceTest : StringSpec({
    val vectorsDir = locateVectorsDir()
    val json = Json { ignoreUnknownKeys = true }

    val files = vectorsDir.listFiles { f -> f.extension == "json" }?.sortedBy { it.name } ?: emptyList()

    "test vectors are present" {
        files.isNotEmpty() shouldBe true
    }

    files.forEach { file ->
        val vector = json.parseToJsonElement(file.readText()).jsonObject
        val type = vector["type"]!!.jsonPrimitive.content
        val canonical = vector["canonicalJson"]!!.jsonPrimitive.content
        val message = vector["message"]!!.jsonObject

        "${file.name}: serializes message to canonical JSON" {
            reserializeByType(type, message.toString()) shouldBe canonical
        }

        "${file.name}: parses canonical JSON and re-serializes identically" {
            reserializeByType(type, canonical) shouldBe canonical
        }
    }
})

/** Parse JSON of the given type into its model, then serialize canonically. */
private fun reserializeByType(type: String, jsonText: String): String =
    when (type) {
        "DeviceInfo" -> ProtocolJson.serialize(ProtocolJson.parseDeviceInfo(jsonText))
        "Capabilities" -> ProtocolJson.serialize(ProtocolJson.parseCapabilities(jsonText))
        "TransferPlan" -> ProtocolJson.serialize(ProtocolJson.parseTransferPlan(jsonText))
        "FileMeta" -> ProtocolJson.serialize(ProtocolJson.parseFileMeta(jsonText))
        "ChunkRef" -> ProtocolJson.serialize(ProtocolJson.parseChunkRef(jsonText))
        "PrepareUploadRequest" ->
            ProtocolJson.serialize(ProtocolJson.parsePrepareUploadRequest(jsonText))
        "PrepareUploadResult" ->
            ProtocolJson.serialize(ProtocolJson.parsePrepareUploadResult(jsonText))
        "TransferProgress" -> ProtocolJson.serialize(ProtocolJson.parseTransferProgress(jsonText))
        else -> error("unknown vector type $type")
    }

/** Walk up from the working directory to find protocol-spec/test-vectors. */
private fun locateVectorsDir(): File {
    val start = System.getProperty("user.dir") ?: "."
    var dir: File? = File(start)
    while (dir != null) {
        val candidate = File(dir, "protocol-spec/test-vectors")
        if (candidate.isDirectory) return candidate
        dir = dir.parentFile
    }
    error("could not locate protocol-spec/test-vectors from ${System.getProperty("user.dir")}")
}
