/**
 * Electron main process.
 *
 * Creates the frameless premium window and hosts the WrapDrive Node peer
 * (discovery + receive server + sender) from `@wrapdrive/node-peer`. The peer
 * runs entirely here, in the main process; the renderer talks to it only
 * through the typed, context-isolated preload bridge.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import {
  Peer,
  nodeCapabilities,
  nodeDeviceInfo,
  type ConsentDecision,
  type ConsentRequest,
  type NodePeer,
} from '@wrapdrive/node-peer';
import { IpcChannels, type UiConsent, type UiPeer } from './ipc-contract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let peer: Peer | null = null;
let latestPeers: NodePeer[] = [];

const selfInfo = nodeDeviceInfo({ alias: `WrapDrive Desktop`, deviceType: 'desktop' });
const capabilities = nodeCapabilities();

const downloadDir = join(homedir(), 'Downloads', 'WrapDrive');
mkdirSync(downloadDir, { recursive: true });

/** Pending consent prompts awaiting a renderer decision. */
const pendingConsents = new Map<string, (decision: ConsentDecision) => void>();

// Never let an unexpected error tear down the whole app; log and continue.
process.on('uncaughtException', (err) => {
  console.error('[wrapdrive] uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[wrapdrive] unhandled rejection:', reason);
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0E1117',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }
}

function toUiPeers(peers: NodePeer[]): UiPeer[] {
  return peers.map((p) => ({
    fingerprint: p.info.fingerprint,
    alias: p.info.alias,
    deviceType: p.info.deviceType,
    address: p.address,
    port: p.info.port,
  }));
}

async function startPeer(): Promise<void> {
  peer = new Peer(selfInfo, capabilities, {
    requestConsent: (req: ConsentRequest) => askRendererConsent(req),
    resolveDestination: (fileName) => join(downloadDir, fileName),
    getPin: () => null,
    onPeers: (peers) => {
      latestPeers = peers;
      mainWindow?.webContents.send(IpcChannels.peers, toUiPeers(peers));
    },
    onProgress: (fileName, fraction, bytesPerSecond) => {
      mainWindow?.webContents.send(IpcChannels.transfer, {
        fileName,
        fraction,
        bytesPerSecond,
        state: fraction >= 1 ? 'done' : 'transferring',
      });
      if (fraction >= 1) {
        setTimeout(() => mainWindow?.webContents.send(IpcChannels.transfer, null), 1500);
      }
    },
    onFileReceived: () => {
      // Receiver-side completion is surfaced via a transient notification.
    },
  });
  await peer.start();
}

function askRendererConsent(req: ConsentRequest): Promise<ConsentDecision> {
  return new Promise((resolve) => {
    const id = randomUUID();
    pendingConsents.set(id, resolve);
    const consent: UiConsent = {
      id,
      fromAlias: req.from.alias,
      fileSummary: req.files.map((f) => `${f.fileName} (${humanSize(f.size)})`).join(', '),
      pinRequired: req.pinRequired,
    };
    mainWindow?.webContents.send(IpcChannels.consent, consent);
  });
}

function humanSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.getSelfAlias, () => selfInfo.alias);

  ipcMain.handle(IpcChannels.pickFiles, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(IpcChannels.sendFiles, async (_e, fingerprint: string, paths: string[]) => {
    const target = latestPeers.find((p) => p.info.fingerprint === fingerprint);
    if (!target || !peer) return;
    for (const path of paths) {
      try {
        await peer.sendFile(target, path);
      } catch (err) {
        // Never let a send failure crash the main process; report to the UI.
        mainWindow?.webContents.send(IpcChannels.transfer, {
          fileName: path,
          fraction: 0,
          bytesPerSecond: 0,
          state: `failed: ${(err as Error).message ?? 'error'}`,
        });
        setTimeout(() => mainWindow?.webContents.send(IpcChannels.transfer, null), 2500);
      }
    }
  });

  ipcMain.on(IpcChannels.resolveConsent, (_e, id: string, accepted: boolean) => {
    const resolve = pendingConsents.get(id);
    if (resolve) {
      pendingConsents.delete(id);
      resolve({ accepted });
      mainWindow?.webContents.send(IpcChannels.consent, null);
    }
  });

  ipcMain.on(IpcChannels.windowAction, (_e, action: string) => {
    if (!mainWindow) return;
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize')
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === 'close') mainWindow.close();
  });
}

app.whenReady().then(async () => {
  registerIpc();
  createWindow();
  await startPeer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void peer?.stop();
  if (process.platform !== 'darwin') app.quit();
});
