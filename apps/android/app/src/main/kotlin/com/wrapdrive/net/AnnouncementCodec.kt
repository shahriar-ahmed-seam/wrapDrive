package com.wrapdrive.net

import com.wrapdrive.core.protocol.Capabilities
import com.wrapdrive.core.protocol.DeviceInfo
import com.wrapdrive.core.protocol.ProtocolJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** A decoded multicast announcement. */
data class Announcement(
    val info: DeviceInfo,
    val capabilities: Capabilities,
    val announce: Boolean,
)

/**
 * Encodes/decodes the multicast announcement payload: the device info fields
 * plus a nested `capabilities` object and an `announce` flag. Reuses the
 * conformance-locked protocol serializers for the nested objects.
 */
object AnnouncementCodec {
    private val json = Json { ignoreUnknownKeys = true }

    fun encode(info: DeviceInfo, capabilities: Capabilities, announce: Boolean = true): String {
        val infoObj = json.parseToJsonElement(ProtocolJson.serialize(info)).jsonObject
        val capsObj = json.parseToJsonElement(ProtocolJson.serialize(capabilities)).jsonObject
        val merged = buildJsonObject {
            infoObj.forEach { (k, v) -> put(k, v) }
            put("capabilities", capsObj)
            put("announce", announce)
        }
        return merged.toString()
    }

    fun decode(payload: String): Announcement {
        val obj: JsonObject = json.parseToJsonElement(payload).jsonObject
        val info = ProtocolJson.parseDeviceInfo(obj.toString())
        val capsElement = obj["capabilities"]?.jsonObject ?: error("missing capabilities")
        val capabilities = ProtocolJson.parseCapabilities(capsElement.toString())
        val announce =
            (obj["announce"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toBoolean() ?: true
        return Announcement(info, capabilities, announce)
    }
}
