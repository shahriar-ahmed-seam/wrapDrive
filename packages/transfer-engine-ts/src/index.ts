/**
 * `@wrapdrive/transfer-engine` — platform-agnostic transfer core.
 *
 * Provides chunk planning, the platform file-adapter abstraction (with a Node
 * implementation), the receiver-side implicit reassembly, the bounded-
 * concurrency parallel send scheduler, and the single-stream fallback. Platform
 * apps supply a {@link FileAdapter} and a {@link SenderTransport}; the engine
 * supplies everything else.
 */

export * from './errors.js';
export * from './chunk-planner.js';
export * from './file-adapter.js';
export * from './node-file-adapter.js';
export * from './chunk-receiver.js';
export * from './transport.js';
export * from './retry.js';
export * from './parallel-sender.js';
export * from './single-stream.js';
