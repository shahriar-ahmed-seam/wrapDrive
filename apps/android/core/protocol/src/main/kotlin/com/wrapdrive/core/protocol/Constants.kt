package com.wrapdrive.core.protocol

/**
 * Protocol-wide constants for WrapDrive v1.
 *
 * Mirrors `protocol-spec/wrapdrive-protocol-v1.md` and the TypeScript
 * `@wrapdrive/protocol` constants. Both implementations must agree on these.
 */
object WrapDriveProtocol {
    /** LocalSend-compatible protocol version string. */
    const val PROTOCOL_VERSION: String = "2.1"

    /** WrapDrive application-protocol identifier advertised in capabilities. */
    const val APP_PROTOCOL: String = "wrapdrive/1"

    /** Current chunk wire-protocol version. */
    const val CHUNK_PROTOCOL_VERSION: String = "wd-chunk/1"

    /** HTTP path namespace for all WrapDrive v1 endpoints. */
    const val API_NAMESPACE: String = "/api/wrapdrive/v1"

    /** Default TCP (HTTP) and UDP (multicast) port. */
    const val DEFAULT_PORT: Int = 53317

    /** IPv4 multicast group used for discovery announcements. */
    const val MULTICAST_GROUP: String = "224.0.0.167"

    /** Inclusive lower bound for a valid device port. */
    const val MIN_PORT: Int = 1024

    /** Inclusive upper bound for a valid device port. */
    const val MAX_PORT: Int = 65535

    /** Maximum length, in characters, of a device alias. */
    const val MAX_ALIAS_LENGTH: Int = 64
}
