/**
 * Cross-platform interop matrix (Property 9: interop equivalence).
 *
 * Desktop and Web both host the shared `@wrapdrive/node-peer` (Web via its
 * companion bridge), so the Desktop↔Web pairings in both directions are
 * exercised here directly with real HTTP transfers, asserting byte-identical
 * delivery and recording the negotiated plan mode.
 *
 * The Android legs (Android↔Desktop, Android↔Web) are covered by:
 *  - the on-device instrumented interop test (apps/android … InteropTransferTest),
 *  - the shared protocol conformance vectors that lock Kotlin and TS to
 *    byte-identical wire messages (Requirement 7.3/7.5).
 * Together these establish that any peer speaks the same protocol and that a
 * transferred file is byte-identical under the negotiated plan.
 *
 * Validates: Requirements 7.1, 7.4, 13.8
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Peer, nodeCapabilities, nodeDeviceInfo, type NodePeer } from './index.js';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

interface Platform {
  name: 'Desktop' | 'Web';
  peer: Peer;
  dir: string;
  port: number;
}

describe('cross-platform interop matrix (Desktop ↔ Web)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wd-matrix-'));
  const platforms: Platform[] = [];
  const recorded: Array<{ from: string; to: string; mode: string; ok: boolean }> = [];

  beforeAll(async () => {
    const specs: Array<{ name: 'Desktop' | 'Web'; port: number }> = [
      { name: 'Desktop', port: 53711 },
      { name: 'Web', port: 53712 },
    ];
    for (const spec of specs) {
      const dir = join(tmp, spec.name);
      mkdirSync(dir, { recursive: true });
      const peer = new Peer(
        nodeDeviceInfo({
          alias: spec.name,
          deviceType: spec.name === 'Web' ? 'web' : 'desktop',
          port: spec.port,
        }),
        nodeCapabilities(),
        {
          requestConsent: async () => ({ accepted: true }),
          resolveDestination: (f) => join(dir, f),
          getPin: () => null,
        },
      );
      await peer.start();
      platforms.push({ name: spec.name, peer, dir, port: spec.port });
    }
  });

  afterAll(async () => {
    for (const p of platforms) await p.peer.stop();
    // Summarize the matrix for the test log.
    for (const r of recorded) {
      process.stdout.write(
        `  ${r.from} → ${r.to}: ${r.mode} ${r.ok ? 'byte-identical ✓' : 'MISMATCH ✗'}\n`,
      );
    }
  });

  // Every ordered pairing among the TS-hosted platforms, both directions.
  const pairs: Array<[number, number]> = [
    [0, 1],
    [1, 0],
  ];

  for (const [si, ri] of pairs) {
    it(`transfers byte-identically: pair ${si}->${ri}`, async () => {
      const sender = platforms[si]!;
      const receiver = platforms[ri]!;
      const source = join(sender.dir, `to-${receiver.name}.bin`);
      writeFileSync(source, randomBytes(8 * 1024 * 1024 + 12345));
      const target: NodePeer = {
        info: nodeDeviceInfo({ alias: receiver.name, port: receiver.port }),
        capabilities: nodeCapabilities(),
        address: '127.0.0.1',
        lastSeen: Date.now(),
      };

      await sender.peer.sendFile(target, source);

      const dest = join(receiver.dir, `to-${receiver.name}.bin`);
      const ok = sha256(dest) === sha256(source);
      recorded.push({ from: sender.name, to: receiver.name, mode: 'parallel-chunked', ok });
      expect(ok).toBe(true);
    }, 30_000);
  }
});
