/**
 * Device identity and capability construction for a Node-hosted peer.
 *
 * Desktop and the web-host bridge are fully chunk-capable for both send and
 * receive (Node provides positional writes), so they advertise the strongest
 * capabilities.
 */

import { randomBytes } from 'node:crypto';
import {
  APP_PROTOCOL,
  CHUNK_PROTOCOL_VERSION,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  type Capabilities,
  type DeviceInfo,
  type DeviceType,
} from '@wrapdrive/protocol';

/** Build full send+receive capabilities for a Node peer. */
export function nodeCapabilities(): Capabilities {
  return {
    appProtocol: APP_PROTOCOL,
    parallelChunkedSend: true,
    parallelChunkedReceive: true,
    maxParallelConnections: 8,
    minChunkSize: 64 * 1024,
    maxChunkSize: 16 * 1024 * 1024,
    chunkProtocolVersions: [CHUNK_PROTOCOL_VERSION],
  };
}

/** Build this peer's {@link DeviceInfo} with a random per-run fingerprint. */
export function nodeDeviceInfo(options: {
  alias: string;
  deviceType?: DeviceType;
  port?: number;
  deviceModel?: string | null;
}): DeviceInfo {
  return {
    alias: options.alias,
    version: PROTOCOL_VERSION,
    deviceModel: options.deviceModel ?? null,
    deviceType: options.deviceType ?? 'desktop',
    fingerprint: randomBytes(16).toString('hex'),
    port: options.port ?? DEFAULT_PORT,
    protocol: 'http',
    download: false,
  };
}
