/**
 * The typed IPC contract between the renderer and the main process.
 *
 * The preload bridge exposes exactly these channels via `contextBridge`, with
 * `contextIsolation` on and `nodeIntegration` off, so the renderer never
 * touches Node directly. Keeping the contract in one file lets both sides share
 * the types.
 */

/** A discovered peer as seen by the renderer. */
export interface UiPeer {
  fingerprint: string;
  alias: string;
  deviceType: string | null;
  address: string;
  port: number;
}

/** Live transfer progress pushed to the renderer. */
export interface UiTransfer {
  fileName: string;
  fraction: number;
  bytesPerSecond: number;
  state: string;
}

/** An incoming consent prompt pushed to the renderer. */
export interface UiConsent {
  id: string;
  fromAlias: string;
  fileSummary: string;
  pinRequired: boolean;
}

/** The window-control actions the custom title bar can request. */
export type WindowAction = 'minimize' | 'maximize' | 'close';

/** The API the preload bridge exposes on `window.wrapdrive`. */
export interface WrapDriveBridge {
  /** Subscribe to peer-list updates; returns an unsubscribe function. */
  onPeers(listener: (peers: UiPeer[]) => void): () => void;
  /** Subscribe to transfer-progress updates. */
  onTransfer(listener: (transfer: UiTransfer | null) => void): () => void;
  /** Subscribe to incoming consent prompts. */
  onConsent(listener: (consent: UiConsent | null) => void): () => void;
  /** Pick files via the native dialog; returns chosen paths. */
  pickFiles(): Promise<string[]>;
  /** Send previously picked files to a peer. */
  sendFiles(fingerprint: string, paths: string[]): Promise<void>;
  /** Resolve a pending consent prompt. */
  resolveConsent(id: string, accepted: boolean): void;
  /** Request a window control action. */
  windowAction(action: WindowAction): void;
  /** Get this device's display alias. */
  getSelfAlias(): Promise<string>;
}

/** IPC channel names, centralized to avoid string drift. */
export const IpcChannels = {
  peers: 'wd:peers',
  transfer: 'wd:transfer',
  consent: 'wd:consent',
  pickFiles: 'wd:pickFiles',
  sendFiles: 'wd:sendFiles',
  resolveConsent: 'wd:resolveConsent',
  windowAction: 'wd:windowAction',
  getSelfAlias: 'wd:getSelfAlias',
} as const;
