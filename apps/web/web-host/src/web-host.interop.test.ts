/**
 * Web interop tests.
 *
 * 23.1: two web-host bridge instances on two ports transfer an 8+ MiB file
 *       parallel-chunked, byte-identical (matching sha256).
 * 23.2: a pure-browser receiver (parallelChunkedReceive=false) negotiates
 *       `single-stream`, proving the documented browser fallback.
 *
 * Validates: Requirements 13.6, 13.7, 12.1
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Peer, nodeCapabilities, nodeDeviceInfo, type NodePeer } from '@wrapdrive/node-peer';
import {
  APP_PROTOCOL,
  CHUNK_PROTOCOL_VERSION,
  negotiate,
  type Capabilities,
} from '@wrapdrive/protocol';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Pure-browser capabilities: can send chunked, cannot receive chunked. */
function pureBrowserCapabilities(): Capabilities {
  return {
    appProtocol: APP_PROTOCOL,
    parallelChunkedSend: true,
    parallelChunkedReceive: false,
    maxParallelConnections: 6,
    minChunkSize: 256 * 1024,
    maxChunkSize: 8 * 1024 * 1024,
    chunkProtocolVersions: [CHUNK_PROTOCOL_VERSION],
  };
}

describe('web-host bridge — two-port interop', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wd-web-'));
  const senderDir = join(tmp, 'sender');
  const receiverDir = join(tmp, 'receiver');
  let sender: Peer;
  let receiver: Peer;
  const receiverPort = 53611;
  const senderPort = 53612;

  beforeAll(async () => {
    mkdirSync(senderDir, { recursive: true });
    mkdirSync(receiverDir, { recursive: true });
    receiver = new Peer(
      nodeDeviceInfo({ alias: 'Web Host A', deviceType: 'web', port: receiverPort }),
      nodeCapabilities(),
      {
        requestConsent: async () => ({ accepted: true }),
        resolveDestination: (f) => join(receiverDir, f),
        getPin: () => null,
      },
    );
    sender = new Peer(
      nodeDeviceInfo({ alias: 'Web Host B', deviceType: 'web', port: senderPort }),
      nodeCapabilities(),
      {
        requestConsent: async () => ({ accepted: true }),
        resolveDestination: (f) => join(senderDir, f),
        getPin: () => null,
      },
    );
    await receiver.start();
    await sender.start();
  });

  afterAll(async () => {
    await sender.stop();
    await receiver.stop();
  });

  it('transfers a 9 MiB file byte-identically between two web-host ports', async () => {
    const source = join(senderDir, 'web.bin');
    writeFileSync(source, randomBytes(9 * 1024 * 1024));
    const target: NodePeer = {
      info: nodeDeviceInfo({ alias: 'Web Host A', port: receiverPort }),
      capabilities: nodeCapabilities(),
      address: '127.0.0.1',
      lastSeen: Date.now(),
    };
    await sender.sendFile(target, source);
    expect(sha256(join(receiverDir, 'web.bin'))).toBe(sha256(source));
  }, 30_000);
});

describe('pure-browser receiver — single-stream fallback (23.2)', () => {
  it('negotiates single-stream when the receiver cannot chunk', () => {
    const sender = nodeCapabilities(); // a capable Node/desktop sender
    const browser = pureBrowserCapabilities();
    const plan = negotiate(sender, browser, 20 * 1024 * 1024);
    expect(plan.mode).toBe('single-stream');
  });

  it('still allows a pure browser to SEND chunked to a capable receiver', () => {
    const browser = pureBrowserCapabilities();
    const host = nodeCapabilities();
    const plan = negotiate(browser, host, 20 * 1024 * 1024);
    expect(plan.mode).toBe('parallel-chunked');
  });
});
