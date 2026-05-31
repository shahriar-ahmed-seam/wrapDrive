import type { WrapDriveBridge } from '../electron/ipc-contract';

declare global {
  interface Window {
    /** The preload-exposed WrapDrive bridge. */
    wrapdrive: WrapDriveBridge;
  }
}

export {};
