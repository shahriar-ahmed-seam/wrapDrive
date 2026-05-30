/**
 * Protocol-wide constants for WrapDrive v1.
 *
 * These values are normative and mirror `protocol-spec/wrapdrive-protocol-v1.md`.
 * Both the TypeScript and Kotlin implementations must agree on them.
 */

/** LocalSend-compatible protocol version string. */
export const PROTOCOL_VERSION = '2.1';

/** WrapDrive application-protocol identifier advertised in {@link Capabilities}. */
export const APP_PROTOCOL = 'wrapdrive/1';

/** Current chunk wire-protocol version. */
export const CHUNK_PROTOCOL_VERSION = 'wd-chunk/1';

/** HTTP path namespace for all WrapDrive v1 endpoints. */
export const API_NAMESPACE = '/api/wrapdrive/v1';

/** Default TCP (HTTP) and UDP (multicast) port. */
export const DEFAULT_PORT = 53317;

/** IPv4 multicast group used for discovery announcements. */
export const MULTICAST_GROUP = '224.0.0.167';

/** Inclusive lower bound for a valid {@link DeviceInfo.port}. */
export const MIN_PORT = 1024;

/** Inclusive upper bound for a valid {@link DeviceInfo.port}. */
export const MAX_PORT = 65535;

/** Maximum length, in characters, of a {@link DeviceInfo.alias}. */
export const MAX_ALIAS_LENGTH = 64;
