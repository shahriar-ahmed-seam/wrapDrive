/**
 * Node-only entry point for the transfer engine.
 *
 * The {@link NodeFileAdapter} imports `node:fs`/`node:crypto`, so it lives
 * behind this separate export (`@wrapdrive/transfer-engine/node`) to keep the
 * main barrel browser-safe.
 */

export * from './node-file-adapter.js';
