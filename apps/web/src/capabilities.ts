/**
 * Runtime capability detection for the web app.
 *
 * A pure browser tab cannot host an HTTP server, so it cannot be a chunked
 * *receiver* and advertises `parallelChunkedReceive: false` — negotiation then
 * falls back to single-stream for anyone sending to it. Parallel chunked
 * *send* is always available in the browser (File.slice + concurrent fetch).
 * Full parity (chunked receive) is achieved only via the web-host bridge.
 */

import { APP_PROTOCOL, CHUNK_PROTOCOL_VERSION, type Capabilities } from '@wrapdrive/protocol';

/** Whether the Chromium File System Access API (positional writes) exists. */
export function hasFileSystemAccess(): boolean {
  return typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

/** The deployment mode the web app is running in. */
export type WebMode = 'host-bridge' | 'pure-browser';

/**
 * Build the capabilities the web app advertises.
 *
 * - With the web-host bridge present: full send + receive (delegated to Node).
 * - Pure browser: send-only chunking; receive falls back to single-stream.
 */
export function webCapabilities(mode: WebMode): Capabilities {
  const canReceiveChunked = mode === 'host-bridge';
  return {
    appProtocol: APP_PROTOCOL,
    parallelChunkedSend: true,
    parallelChunkedReceive: canReceiveChunked,
    maxParallelConnections: 6,
    minChunkSize: 256 * 1024,
    maxChunkSize: 8 * 1024 * 1024,
    chunkProtocolVersions: [CHUNK_PROTOCOL_VERSION],
  };
}

/** Probe whether a local web-host bridge is reachable. */
export async function detectHostBridge(bridgeUrl = 'http://127.0.0.1:53317'): Promise<boolean> {
  try {
    const res = await fetch(`${bridgeUrl}/api/wrapdrive/v1/info`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}
