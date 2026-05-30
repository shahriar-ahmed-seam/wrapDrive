/**
 * Property 6 — Roundtrip serialization.
 *
 * For every protocol message, `parse(serialize(msg)) === msg`, including null
 * and absent-optional fields. Each property runs for at least 100 generated
 * inputs (Requirement 13.10).
 *
 * Validates: Requirements 8.1, 7.3, 7.5
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  parseCapabilities,
  parseChunkRef,
  parseDeviceInfo,
  parseFileMeta,
  parsePrepareUploadRequest,
  parsePrepareUploadResult,
  parseTransferPlan,
  parseTransferProgress,
  serializeCapabilities,
  serializeChunkRef,
  serializeDeviceInfo,
  serializeFileMeta,
  serializePrepareUploadRequest,
  serializePrepareUploadResult,
  serializeTransferPlan,
  serializeTransferProgress,
} from './serialization.js';
import {
  arbCapabilities,
  arbChunkRef,
  arbDeviceInfo,
  arbFileMeta,
  arbPrepareUploadRequest,
  arbPrepareUploadResult,
  arbTransferPlan,
  arbTransferProgress,
} from './testing/arbitraries.js';

const RUNS = { numRuns: 200 };

describe('serialization round-trips (Property 6)', () => {
  it('round-trips DeviceInfo', () => {
    fc.assert(
      fc.property(arbDeviceInfo, (info) => {
        expect(parseDeviceInfo(serializeDeviceInfo(info))).toEqual(info);
      }),
      RUNS,
    );
  });

  it('round-trips Capabilities', () => {
    fc.assert(
      fc.property(arbCapabilities, (caps) => {
        expect(parseCapabilities(serializeCapabilities(caps))).toEqual(caps);
      }),
      RUNS,
    );
  });

  it('round-trips TransferPlan', () => {
    fc.assert(
      fc.property(arbTransferPlan, (plan) => {
        expect(parseTransferPlan(serializeTransferPlan(plan))).toEqual(plan);
      }),
      RUNS,
    );
  });

  it('round-trips FileMeta', () => {
    fc.assert(
      fc.property(arbFileMeta, (file) => {
        expect(parseFileMeta(serializeFileMeta(file))).toEqual(file);
      }),
      RUNS,
    );
  });

  it('round-trips ChunkRef (with and without optional sha256)', () => {
    fc.assert(
      fc.property(arbChunkRef, (chunk) => {
        expect(parseChunkRef(serializeChunkRef(chunk))).toEqual(chunk);
      }),
      RUNS,
    );
  });

  it('round-trips PrepareUploadRequest (with and without optional pin)', () => {
    fc.assert(
      fc.property(arbPrepareUploadRequest, (req) => {
        expect(parsePrepareUploadRequest(serializePrepareUploadRequest(req))).toEqual(req);
      }),
      RUNS,
    );
  });

  it('round-trips PrepareUploadResult', () => {
    fc.assert(
      fc.property(arbPrepareUploadResult, (res) => {
        expect(parsePrepareUploadResult(serializePrepareUploadResult(res))).toEqual(res);
      }),
      RUNS,
    );
  });

  it('round-trips TransferProgress', () => {
    fc.assert(
      fc.property(arbTransferProgress, (progress) => {
        expect(parseTransferProgress(serializeTransferProgress(progress))).toEqual(progress);
      }),
      RUNS,
    );
  });
});

describe('canonical serialization is stable and key-sorted', () => {
  it('produces identical JSON regardless of record key insertion order', () => {
    const a = serializePrepareUploadResult({
      sessionId: 's1',
      files: { zeta: 't-z', alpha: 't-a', mu: 't-m' },
      acceptedPlan: {
        mode: 'single-stream',
        chunkSize: 10,
        parallelism: 1,
        chunkProtocolVersion: null,
      },
    });
    const b = serializePrepareUploadResult({
      sessionId: 's1',
      files: { alpha: 't-a', mu: 't-m', zeta: 't-z' },
      acceptedPlan: {
        mode: 'single-stream',
        chunkSize: 10,
        parallelism: 1,
        chunkProtocolVersion: null,
      },
    });
    expect(a).toBe(b);
    expect(a).toContain('"alpha"');
    // Keys must be emitted in sorted order: alpha, mu, zeta.
    expect(a.indexOf('alpha')).toBeLessThan(a.indexOf('mu'));
    expect(a.indexOf('mu')).toBeLessThan(a.indexOf('zeta'));
  });
});
