/**
 * Tests for the capability negotiator.
 *
 * Property 3 — Negotiation safety: a `parallel-chunked` result implies the
 * sender can send chunked, the receiver can receive chunked, and a common chunk
 * protocol exists.
 *
 * Property 4 — Negotiation determinism and idempotence: identical inputs give
 * identical plans; re-negotiating with an already-chosen plan's capabilities
 * never strengthens the plan; the function has no side effects.
 *
 * Plus a unit-level truth table over (send, receive, protocolOverlap,
 * sizeRange) and the single-stream field assignments.
 *
 * Validates: Requirements 2.2, 2.3, 2.5, 2.6, 2.7, 2.8, 5.4, 11.1, 11.2
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { APP_PROTOCOL } from './constants.js';
import type { Capabilities } from './models.js';
import { DEFAULT_CHUNK_SIZE, MAX_CHUNK_COUNT, negotiate } from './negotiation.js';
import { arbValidCapabilities } from './testing/arbitraries.js';

const RUNS = { numRuns: 300 };

/** A fully chunk-capable peer used as a fixed baseline in unit tests. */
const capable: Capabilities = {
  appProtocol: APP_PROTOCOL,
  parallelChunkedSend: true,
  parallelChunkedReceive: true,
  maxParallelConnections: 8,
  minChunkSize: 1024,
  maxChunkSize: 8 * 1024 * 1024,
  chunkProtocolVersions: ['wd-chunk/1'],
};

const arbFileSize = fc.nat({ max: Number.MAX_SAFE_INTEGER });

function hasCommonVersion(a: Capabilities, b: Capabilities): boolean {
  const set = new Set(b.chunkProtocolVersions);
  return a.chunkProtocolVersions.some((v) => set.has(v));
}

describe('negotiate — Property 3: negotiation safety', () => {
  it('parallel-chunked implies both sides capable and a common protocol', () => {
    fc.assert(
      fc.property(
        arbValidCapabilities,
        arbValidCapabilities,
        arbFileSize,
        (sender, receiver, size) => {
          const plan = negotiate(sender, receiver, size);
          if (plan.mode === 'parallel-chunked') {
            expect(sender.parallelChunkedSend).toBe(true);
            expect(receiver.parallelChunkedReceive).toBe(true);
            expect(hasCommonVersion(sender, receiver)).toBe(true);
            expect(plan.chunkProtocolVersion).not.toBeNull();
          }
        },
      ),
      RUNS,
    );
  });

  it('falls back to single-stream whenever either capability is missing', () => {
    fc.assert(
      fc.property(
        arbValidCapabilities,
        arbValidCapabilities,
        arbFileSize,
        (sender, receiver, size) => {
          const incapable =
            !sender.parallelChunkedSend ||
            !receiver.parallelChunkedReceive ||
            !hasCommonVersion(sender, receiver);
          if (incapable) {
            expect(negotiate(sender, receiver, size).mode).toBe('single-stream');
          }
        },
      ),
      RUNS,
    );
  });
});

describe('negotiate — Property 4: determinism and idempotence', () => {
  it('is deterministic for identical inputs', () => {
    fc.assert(
      fc.property(
        arbValidCapabilities,
        arbValidCapabilities,
        arbFileSize,
        (sender, receiver, size) => {
          expect(negotiate(sender, receiver, size)).toEqual(negotiate(sender, receiver, size));
        },
      ),
      RUNS,
    );
  });

  it('does not mutate its inputs (no side effects)', () => {
    fc.assert(
      fc.property(
        arbValidCapabilities,
        arbValidCapabilities,
        arbFileSize,
        (sender, receiver, size) => {
          const senderCopy = structuredClone(sender);
          const receiverCopy = structuredClone(receiver);
          negotiate(sender, receiver, size);
          expect(sender).toEqual(senderCopy);
          expect(receiver).toEqual(receiverCopy);
        },
      ),
      RUNS,
    );
  });

  it('never strengthens when re-negotiating with the chosen plan as a constraint', () => {
    fc.assert(
      fc.property(
        arbValidCapabilities,
        arbValidCapabilities,
        arbFileSize,
        (sender, receiver, size) => {
          const plan = negotiate(sender, receiver, size);
          // Build capabilities that reflect the already-chosen plan and re-run.
          const constrained: Capabilities = {
            ...sender,
            maxParallelConnections: plan.parallelism,
            minChunkSize: Math.min(sender.minChunkSize, plan.chunkSize || sender.minChunkSize),
            maxChunkSize: plan.mode === 'parallel-chunked' ? plan.chunkSize : sender.maxChunkSize,
          };
          const replan = negotiate(constrained, receiver, size);
          if (plan.mode === 'single-stream') {
            expect(replan.mode).toBe('single-stream');
          }
          if (plan.mode === 'parallel-chunked' && replan.mode === 'parallel-chunked') {
            expect(replan.chunkSize).toBeLessThanOrEqual(plan.chunkSize);
            expect(replan.parallelism).toBeLessThanOrEqual(plan.parallelism);
          }
        },
      ),
      RUNS,
    );
  });
});

describe('negotiate — truth table and field assignment', () => {
  const bigFile = 100 * 1024 * 1024; // 100 MiB, larger than the default chunk

  it('chooses parallel-chunked when both capable, protocols overlap, and file is large', () => {
    const plan = negotiate(capable, capable, bigFile);
    expect(plan.mode).toBe('parallel-chunked');
    expect(plan.parallelism).toBe(8);
    expect(plan.chunkProtocolVersion).toBe('wd-chunk/1');
    expect(plan.chunkSize).toBeGreaterThanOrEqual(capable.minChunkSize);
    expect(plan.chunkSize).toBeLessThanOrEqual(capable.maxChunkSize);
  });

  it('falls back when sender cannot send chunked', () => {
    const plan = negotiate({ ...capable, parallelChunkedSend: false }, capable, bigFile);
    expect(plan.mode).toBe('single-stream');
  });

  it('falls back when receiver cannot receive chunked', () => {
    const plan = negotiate(capable, { ...capable, parallelChunkedReceive: false }, bigFile);
    expect(plan.mode).toBe('single-stream');
  });

  it('falls back when there is no common chunk protocol version', () => {
    const plan = negotiate(capable, { ...capable, chunkProtocolVersions: ['wd-chunk/2'] }, bigFile);
    expect(plan.mode).toBe('single-stream');
  });

  it('falls back when chunk-size ranges do not overlap', () => {
    const lowOnly: Capabilities = { ...capable, minChunkSize: 1024, maxChunkSize: 2048 };
    const highOnly: Capabilities = { ...capable, minChunkSize: 4096, maxChunkSize: 8192 };
    expect(negotiate(lowOnly, highOnly, bigFile).mode).toBe('single-stream');
  });

  it('falls back when the file fits within a single chunk', () => {
    const plan = negotiate(capable, capable, 1000);
    expect(plan.mode).toBe('single-stream');
  });

  it('assigns single-stream fields: chunkSize=fileSize, parallelism=1, version=null', () => {
    const plan = negotiate({ ...capable, parallelChunkedSend: false }, capable, 5000);
    expect(plan).toEqual({
      mode: 'single-stream',
      chunkSize: 5000,
      parallelism: 1,
      chunkProtocolVersion: null,
    });
  });

  it('clamps the default chunk size into the overlapping range', () => {
    const small: Capabilities = { ...capable, minChunkSize: 1024, maxChunkSize: 64 * 1024 };
    const plan = negotiate(small, small, bigFile);
    expect(plan.mode).toBe('parallel-chunked');
    expect(plan.chunkSize).toBe(64 * 1024); // default 4 MiB clamped down to the 64 KiB max
  });

  it('raises chunk size to cap the chunk count at 10,000', () => {
    // A huge file with the default chunk size would exceed the chunk-count cap.
    const hugeFile = DEFAULT_CHUNK_SIZE * (MAX_CHUNK_COUNT + 5000);
    const wideRange: Capabilities = {
      ...capable,
      minChunkSize: 1024,
      maxChunkSize: Number.MAX_SAFE_INTEGER,
    };
    const plan = negotiate(wideRange, wideRange, hugeFile);
    expect(plan.mode).toBe('parallel-chunked');
    const chunkCount = Math.ceil(hugeFile / plan.chunkSize);
    expect(chunkCount).toBeLessThanOrEqual(MAX_CHUNK_COUNT);
    expect(plan.chunkSize).toBeGreaterThan(DEFAULT_CHUNK_SIZE);
  });
});
