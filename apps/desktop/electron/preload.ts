/**
 * Preload bridge.
 *
 * Exposes the typed {@link WrapDriveBridge} API on `window.wrapdrive` via
 * `contextBridge`, with context isolation on and Node integration off. The
 * renderer never gets direct access to `ipcRenderer` or Node — only these
 * vetted channels.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannels,
  type UiConsent,
  type UiPeer,
  type UiTransfer,
  type WindowAction,
  type WrapDriveBridge,
} from './ipc-contract.js';

const bridge: WrapDriveBridge = {
  onPeers(listener: (peers: UiPeer[]) => void) {
    const handler = (_e: unknown, peers: UiPeer[]) => listener(peers);
    ipcRenderer.on(IpcChannels.peers, handler);
    return () => ipcRenderer.removeListener(IpcChannels.peers, handler);
  },
  onTransfer(listener: (transfer: UiTransfer | null) => void) {
    const handler = (_e: unknown, transfer: UiTransfer | null) => listener(transfer);
    ipcRenderer.on(IpcChannels.transfer, handler);
    return () => ipcRenderer.removeListener(IpcChannels.transfer, handler);
  },
  onConsent(listener: (consent: UiConsent | null) => void) {
    const handler = (_e: unknown, consent: UiConsent | null) => listener(consent);
    ipcRenderer.on(IpcChannels.consent, handler);
    return () => ipcRenderer.removeListener(IpcChannels.consent, handler);
  },
  pickFiles: () => ipcRenderer.invoke(IpcChannels.pickFiles),
  sendFiles: (fingerprint: string, paths: string[]) =>
    ipcRenderer.invoke(IpcChannels.sendFiles, fingerprint, paths),
  resolveConsent: (id: string, accepted: boolean) =>
    ipcRenderer.send(IpcChannels.resolveConsent, id, accepted),
  windowAction: (action: WindowAction) => ipcRenderer.send(IpcChannels.windowAction, action),
  getSelfAlias: () => ipcRenderer.invoke(IpcChannels.getSelfAlias),
};

contextBridge.exposeInMainWorld('wrapdrive', bridge);
