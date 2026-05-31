/**
 * Protocol conformance against the shared test vectors.
 *
 * For every fixture in `protocol-spec/test-vectors/`, this asserts that the
 * TypeScript serializer emits exactly the vector's `canonicalJson` and that
 * parsing that JSON reproduces the canonical `message`. The Kotlin suite runs
 * the same vectors, so the two implementations stay byte-compatible.
 *
 * Validates: Requirements 7.3, 7.5, 8.2
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
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
} from './serialization.js';
import {
  serializeCapabilities,
  serializeChunkRef,
  serializeDeviceInfo,
  serializeFileMeta,
  serializePrepareUploadRequest,
  serializePrepareUploadResult,
  serializeTransferPlan,
  serializeTransferProgress,
} from './serialization.js';

interface Vector {
  type: string;
  description: string;
  message: unknown;
  canonicalJson: string;
}

const serializers: Record<string, (msg: never) => string> = {
  DeviceInfo: serializeDeviceInfo as (msg: never) => string,
  Capabilities: serializeCapabilities as (msg: never) => string,
  TransferPlan: serializeTransferPlan as (msg: never) => string,
  FileMeta: serializeFileMeta as (msg: never) => string,
  ChunkRef: serializeChunkRef as (msg: never) => string,
  PrepareUploadRequest: serializePrepareUploadRequest as (msg: never) => string,
  PrepareUploadResult: serializePrepareUploadResult as (msg: never) => string,
  TransferProgress: serializeTransferProgress as (msg: never) => string,
};

const parsers: Record<string, (json: string) => unknown> = {
  DeviceInfo: parseDeviceInfo,
  Capabilities: parseCapabilities,
  TransferPlan: parseTransferPlan,
  FileMeta: parseFileMeta,
  ChunkRef: parseChunkRef,
  PrepareUploadRequest: parsePrepareUploadRequest,
  PrepareUploadResult: parsePrepareUploadResult,
  TransferProgress: parseTransferProgress,
};

const vectorsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'protocol-spec',
  'test-vectors',
);

function loadVectors(): Array<{ file: string; vector: Vector }> {
  return readdirSync(vectorsDir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => ({
      file,
      vector: JSON.parse(readFileSync(join(vectorsDir, file), 'utf8')) as Vector,
    }));
}

describe('protocol conformance against shared test vectors', () => {
  const vectors = loadVectors();

  it('found vector fixtures', () => {
    expect(vectors.length).toBeGreaterThan(0);
  });

  for (const { file, vector } of vectors) {
    describe(`${file} (${vector.type})`, () => {
      it('serializes to the canonical JSON byte-for-byte', () => {
        const serialize = serializers[vector.type];
        expect(serialize, `no serializer for type ${vector.type}`).toBeDefined();
        expect(serialize(vector.message as never)).toBe(vector.canonicalJson);
      });

      it('parses the canonical JSON back to the message', () => {
        const parse = parsers[vector.type];
        expect(parse, `no parser for type ${vector.type}`).toBeDefined();
        expect(parse(vector.canonicalJson)).toEqual(vector.message);
      });
    });
  }
});
