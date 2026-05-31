#!/usr/bin/env node
/**
 * WrapDrive web-host companion.
 *
 * Runs a full WrapDrive peer locally (discovery + chunked receive + send) so
 * the browser app gains full parity with Desktop: it can discover devices and
 * receive chunked transfers, which a pure browser tab cannot do. The browser
 * talks to this bridge over `localhost`.
 *
 * Consent is auto-granted here for simplicity in v1; a production companion
 * would surface a prompt. Files are saved to the user's Downloads/WrapDrive.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Peer, nodeCapabilities, nodeDeviceInfo } from '@wrapdrive/node-peer';
import { DEFAULT_PORT } from '@wrapdrive/protocol';

const port = Number(process.env.WD_HOST_PORT ?? DEFAULT_PORT);
const downloadDir = join(homedir(), 'Downloads', 'WrapDrive');
mkdirSync(downloadDir, { recursive: true });

const peer = new Peer(
  nodeDeviceInfo({ alias: 'WrapDrive Web Host', deviceType: 'web', port }),
  nodeCapabilities(),
  {
    requestConsent: async () => ({ accepted: true }),
    resolveDestination: (fileName) => join(downloadDir, fileName),
    getPin: () => null,
    onFileReceived: (path) => process.stdout.write(`Received ${path}\n`),
  },
);

await peer.start();
process.stdout.write(
  `WrapDrive web-host listening on http://127.0.0.1:${port} — saving to ${downloadDir}\n`,
);

const shutdown = async (): Promise<void> => {
  await peer.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
