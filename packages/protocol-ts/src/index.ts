/**
 * `@wrapdrive/protocol` — WrapDrive v1 wire-protocol data models, validation,
 * and canonical JSON serialization.
 *
 * This package is the TypeScript half of the protocol contract defined in
 * `protocol-spec/wrapdrive-protocol-v1.md`. The Kotlin port mirrors it, and a
 * shared test-vector suite keeps the two byte-compatible.
 */

export * from './constants.js';
export * from './models.js';
export * from './validation.js';
export * from './serialization.js';
