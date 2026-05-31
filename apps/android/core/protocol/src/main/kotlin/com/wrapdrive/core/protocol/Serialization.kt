package com.wrapdrive.core.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/**
 * Canonical JSON serialization for WrapDrive protocol messages (Kotlin port).
 *
 * Serializers emit fields in the canonical order and sort map keys ascending so
 * the output is byte-identical to the TypeScript `@wrapdrive/protocol`
 * serializer (locked by the shared test vectors). Parsing is lenient about key
 * order, as JSON objects are unordered on the wire.
 */
object ProtocolJson {
    private val lenient = Json { ignoreUnknownKeys = true; isLenient = false }

    // --- Serialization (canonical) -----------------------------------------

    fun serialize(info: DeviceInfo): String = JsonWriter().apply { writeDeviceInfo(info) }.toString()

    fun serialize(caps: Capabilities): String =
        JsonWriter().apply { writeCapabilities(caps) }.toString()

    fun serialize(plan: TransferPlan): String =
        JsonWriter().apply { writeTransferPlan(plan) }.toString()

    fun serialize(file: FileMeta): String = JsonWriter().apply { writeFileMeta(file) }.toString()

    fun serialize(chunk: ChunkRef): String = JsonWriter().apply { writeChunkRef(chunk) }.toString()

    fun serialize(req: PrepareUploadRequest): String =
        JsonWriter().apply { writePrepareUploadRequest(req) }.toString()

    fun serialize(res: PrepareUploadResult): String =
        JsonWriter().apply { writePrepareUploadResult(res) }.toString()

    fun serialize(progress: TransferProgress): String =
        JsonWriter().apply { writeTransferProgress(progress) }.toString()

    private fun JsonWriter.writeDeviceInfo(info: DeviceInfo): JsonWriter {
        beginObject()
        value("alias").colon().value(info.alias).comma()
        value("version").colon().value(info.version).comma()
        value("deviceModel").colon().valueOrNull(info.deviceModel).comma()
        value("deviceType").colon().valueOrNull(info.deviceType?.name).comma()
        value("fingerprint").colon().value(info.fingerprint).comma()
        value("port").colon().value(info.port).comma()
        value("protocol").colon().value(info.protocol.name).comma()
        value("download").colon().value(info.download)
        endObject()
        return this
    }

    private fun JsonWriter.writeCapabilities(caps: Capabilities): JsonWriter {
        beginObject()
        value("appProtocol").colon().value(caps.appProtocol).comma()
        value("parallelChunkedSend").colon().value(caps.parallelChunkedSend).comma()
        value("parallelChunkedReceive").colon().value(caps.parallelChunkedReceive).comma()
        value("maxParallelConnections").colon().value(caps.maxParallelConnections).comma()
        value("minChunkSize").colon().value(caps.minChunkSize).comma()
        value("maxChunkSize").colon().value(caps.maxChunkSize).comma()
        value("chunkProtocolVersions").colon()
        beginArray()
        caps.chunkProtocolVersions.forEachIndexed { i, v ->
            if (i > 0) comma()
            value(v)
        }
        endArray()
        endObject()
        return this
    }

    private fun JsonWriter.writeTransferPlan(plan: TransferPlan): JsonWriter {
        beginObject()
        value("mode").colon().value(plan.mode.name).comma()
        value("chunkSize").colon().value(plan.chunkSize).comma()
        value("parallelism").colon().value(plan.parallelism).comma()
        value("chunkProtocolVersion").colon().valueOrNull(plan.chunkProtocolVersion)
        endObject()
        return this
    }

    private fun JsonWriter.writeFileMeta(file: FileMeta): JsonWriter {
        beginObject()
        value("id").colon().value(file.id).comma()
        value("fileName").colon().value(file.fileName).comma()
        value("size").colon().value(file.size).comma()
        value("fileType").colon().value(file.fileType).comma()
        value("sha256").colon().valueOrNull(file.sha256).comma()
        value("preview").colon().valueOrNull(file.preview)
        endObject()
        return this
    }

    private fun JsonWriter.writeChunkRef(chunk: ChunkRef): JsonWriter {
        beginObject()
        value("index").colon().value(chunk.index).comma()
        value("offset").colon().value(chunk.offset).comma()
        value("length").colon().value(chunk.length)
        if (chunk.sha256 != null) {
            comma().value("sha256").colon().value(chunk.sha256)
        }
        endObject()
        return this
    }

    private fun JsonWriter.writeFileRecord(files: Map<String, FileMeta>): JsonWriter {
        beginObject()
        files.keys.sorted().forEachIndexed { i, key ->
            if (i > 0) comma()
            value(key).colon().writeFileMeta(files.getValue(key))
        }
        endObject()
        return this
    }

    private fun JsonWriter.writePrepareUploadRequest(req: PrepareUploadRequest): JsonWriter {
        beginObject()
        value("info").colon().writeDeviceInfo(req.info).comma()
        value("capabilities").colon().writeCapabilities(req.capabilities).comma()
        value("files").colon().writeFileRecord(req.files).comma()
        value("proposedPlan").colon().writeTransferPlan(req.proposedPlan)
        if (req.pin != null) {
            comma().value("pin").colon().value(req.pin)
        }
        endObject()
        return this
    }

    private fun JsonWriter.writePrepareUploadResult(res: PrepareUploadResult) {
        beginObject()
        value("sessionId").colon().value(res.sessionId).comma()
        value("files").colon()
        beginObject()
        res.files.keys.sorted().forEachIndexed { i, key ->
            if (i > 0) comma()
            value(key).colon().value(res.files.getValue(key))
        }
        endObject()
        comma()
        value("acceptedPlan").colon().writeTransferPlan(res.acceptedPlan)
        endObject()
    }

    private fun JsonWriter.writeTransferProgress(progress: TransferProgress) {
        beginObject()
        value("sessionId").colon().value(progress.sessionId).comma()
        value("fileId").colon().value(progress.fileId).comma()
        value("bytesTransferred").colon().value(progress.bytesTransferred).comma()
        value("totalBytes").colon().value(progress.totalBytes).comma()
        value("chunksCompleted").colon().value(progress.chunksCompleted).comma()
        value("totalChunks").colon().value(progress.totalChunks).comma()
        value("bytesPerSecond").colon().value(progress.bytesPerSecond).comma()
        value("state").colon().value(progress.state.name)
        endObject()
    }

    // --- Parsing -----------------------------------------------------------

    private fun JsonObject.str(key: String): String =
        this[key]?.jsonPrimitive?.contentOrNull ?: error("missing string field '$key'")

    private fun JsonObject.strOrNull(key: String): String? {
        val element = this[key] ?: return null
        val primitive = element as? JsonPrimitive ?: return null
        return primitive.contentOrNull
    }

    private fun JsonObject.long(key: String): Long =
        this[key]?.jsonPrimitive?.long ?: error("missing number field '$key'")

    private fun JsonObject.int(key: String): Int = long(key).toInt()

    private fun JsonObject.bool(key: String): Boolean =
        this[key]?.jsonPrimitive?.boolean ?: error("missing boolean field '$key'")

    private fun element(json: String): JsonObject = lenient.parseToJsonElement(json).jsonObject

    fun parseDeviceInfo(json: String): DeviceInfo = readDeviceInfo(element(json))

    private fun readDeviceInfo(o: JsonObject): DeviceInfo =
        DeviceInfo(
            alias = o.str("alias"),
            version = o.str("version"),
            deviceModel = o.strOrNull("deviceModel"),
            deviceType = o.strOrNull("deviceType")?.let { DeviceType.valueOf(it) },
            fingerprint = o.str("fingerprint"),
            port = o.int("port"),
            protocol = Protocol.valueOf(o.str("protocol")),
            download = o.bool("download"),
        )

    fun parseCapabilities(json: String): Capabilities = readCapabilities(element(json))

    private fun readCapabilities(o: JsonObject): Capabilities =
        Capabilities(
            appProtocol = o.str("appProtocol"),
            parallelChunkedSend = o.bool("parallelChunkedSend"),
            parallelChunkedReceive = o.bool("parallelChunkedReceive"),
            maxParallelConnections = o.int("maxParallelConnections"),
            minChunkSize = o.long("minChunkSize"),
            maxChunkSize = o.long("maxChunkSize"),
            chunkProtocolVersions =
                (o["chunkProtocolVersions"] as? kotlinx.serialization.json.JsonArray)
                    ?.map { it.jsonPrimitive.content } ?: emptyList(),
        )

    fun parseTransferPlan(json: String): TransferPlan = readTransferPlan(element(json))

    private fun readTransferPlan(o: JsonObject): TransferPlan =
        TransferPlan(
            mode = TransferMode.valueOf(o.str("mode")),
            chunkSize = o.long("chunkSize"),
            parallelism = o.int("parallelism"),
            chunkProtocolVersion = o.strOrNull("chunkProtocolVersion"),
        )

    fun parseFileMeta(json: String): FileMeta = readFileMeta(element(json))

    private fun readFileMeta(o: JsonObject): FileMeta =
        FileMeta(
            id = o.str("id"),
            fileName = o.str("fileName"),
            size = o.long("size"),
            fileType = o.str("fileType"),
            sha256 = o.strOrNull("sha256"),
            preview = o.strOrNull("preview"),
        )

    fun parseChunkRef(json: String): ChunkRef = readChunkRef(element(json))

    private fun readChunkRef(o: JsonObject): ChunkRef =
        ChunkRef(
            index = o.int("index"),
            offset = o.long("offset"),
            length = o.long("length"),
            sha256 = o.strOrNull("sha256"),
        )

    fun parsePrepareUploadRequest(json: String): PrepareUploadRequest {
        val o = element(json)
        val filesObj = o["files"]?.jsonObject ?: JsonObject(emptyMap())
        return PrepareUploadRequest(
            info = readDeviceInfo(o["info"]!!.jsonObject),
            capabilities = readCapabilities(o["capabilities"]!!.jsonObject),
            files = filesObj.mapValues { readFileMeta(it.value.jsonObject) },
            proposedPlan = readTransferPlan(o["proposedPlan"]!!.jsonObject),
            pin = o.strOrNull("pin"),
        )
    }

    fun parsePrepareUploadResult(json: String): PrepareUploadResult {
        val o = element(json)
        val filesObj = o["files"]?.jsonObject ?: JsonObject(emptyMap())
        return PrepareUploadResult(
            sessionId = o.str("sessionId"),
            files = filesObj.mapValues { (it.value as JsonElement).jsonPrimitive.content },
            acceptedPlan = readTransferPlan(o["acceptedPlan"]!!.jsonObject),
        )
    }

    fun parseTransferProgress(json: String): TransferProgress {
        val o = element(json)
        return TransferProgress(
            sessionId = o.str("sessionId"),
            fileId = o.str("fileId"),
            bytesTransferred = o.long("bytesTransferred"),
            totalBytes = o.long("totalBytes"),
            chunksCompleted = o.int("chunksCompleted"),
            totalChunks = o.int("totalChunks"),
            bytesPerSecond = o.long("bytesPerSecond"),
            state = TransferState.valueOf(o.str("state")),
        )
    }
}
