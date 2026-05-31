/**
 * `@wrapdrive/node-peer` — a complete WrapDrive peer hosted in Node.
 *
 * Bundles discovery, the HTTP receive server (with the consent/PIN/token/
 * session security gate), and the sender into a single {@link Peer}. Shared by
 * the Electron desktop main process and the web-host bridge.
 */

export * from './identity.js';
export * from './discovery.js';
export * from './receive-server.js';
export * from './http-sender-transport.js';
export * from './peer.js';
