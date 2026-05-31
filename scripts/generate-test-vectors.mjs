#!/usr/bin/env node
/**
 * Generate protocol conformance test vectors.
 *
 * Emits one JSON fixture per canonical message into
 * `protocol-spec/test-vectors/`, each containing the message value and the
 * exact canonical JSON the serializer must produce. The TypeScript and Kotlin
 * conformance suites both consume these files to stay byte-compatible.
 *
 * Run after building protocol-ts:
 *   pnpm --filter @wrapdrive/protocol build
 *   node scripts/generate-test-vectors.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  serializeCapabilities,
  serializeChunkRef,
  serializeDeviceInfo,
  serializeFileMeta,
  serializePrepareUploadRequest,
  serializePrepareUploadResult,
  serializeTransferPlan,
  serializeTransferProgress,
} from '../packages/protocol-ts/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'protocol-spec', 'test-vectors');

/** Each entry: file name, type, description, message, and its serializer. */
const vectors = [
  {
    file: 'device-info.json',
    type: 'DeviceInfo',
    description: 'A typical mobile peer over HTTP.',
    message: {
      alias: 'Nice Orange',
      version: '2.1',
      deviceModel: 'Pixel 8',
      deviceType: 'mobile',
      fingerprint: 'f1a2b3c4d5e6',
      port: 53317,
      protocol: 'http',
      download: false,
    },
    serialize: serializeDeviceInfo,
  },
  {
    file: 'device-info-nulls.json',
    type: 'DeviceInfo',
    description: 'Optional fields explicitly null must round-trip.',
    message: {
      alias: 'Headless Server',
      version: '2.1',
      deviceModel: null,
      deviceType: null,
      fingerprint: 'aabbccddeeff',
      port: 53317,
      protocol: 'https',
      download: true,
    },
    serialize: serializeDeviceInfo,
  },
  {
    file: 'capabilities.json',
    type: 'Capabilities',
    description: 'A fully chunk-capable peer.',
    message: {
      appProtocol: 'wrapdrive/1',
      parallelChunkedSend: true,
      parallelChunkedReceive: true,
      maxParallelConnections: 8,
      minChunkSize: 1024,
      maxChunkSize: 8388608,
      chunkProtocolVersions: ['wd-chunk/1'],
    },
    serialize: serializeCapabilities,
  },
  {
    file: 'transfer-plan-parallel.json',
    type: 'TransferPlan',
    description: 'A negotiated parallel-chunked plan.',
    message: {
      mode: 'parallel-chunked',
      chunkSize: 4194304,
      parallelism: 6,
      chunkProtocolVersion: 'wd-chunk/1',
    },
    serialize: serializeTransferPlan,
  },
  {
    file: 'transfer-plan-single.json',
    type: 'TransferPlan',
    description: 'A single-stream fallback plan.',
    message: {
      mode: 'single-stream',
      chunkSize: 1048576,
      parallelism: 1,
      chunkProtocolVersion: null,
    },
    serialize: serializeTransferPlan,
  },
  {
    file: 'file-meta.json',
    type: 'FileMeta',
    description: 'File metadata with a whole-file hash.',
    message: {
      id: 'file-1',
      fileName: 'holiday.png',
      size: 10485760,
      fileType: 'image/png',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      preview: null,
    },
    serialize: serializeFileMeta,
  },
  {
    file: 'chunk-ref.json',
    type: 'ChunkRef',
    description: 'A chunk reference with an optional per-chunk hash.',
    message: {
      index: 2,
      offset: 8388608,
      length: 4194304,
      sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    },
    serialize: serializeChunkRef,
  },
  {
    file: 'prepare-upload-request.json',
    type: 'PrepareUploadRequest',
    description: 'A prepare-upload request with two files and a PIN.',
    message: {
      info: {
        alias: 'Nice Orange',
        version: '2.1',
        deviceModel: 'Pixel 8',
        deviceType: 'mobile',
        fingerprint: 'f1a2b3c4d5e6',
        port: 53317,
        protocol: 'http',
        download: false,
      },
      capabilities: {
        appProtocol: 'wrapdrive/1',
        parallelChunkedSend: true,
        parallelChunkedReceive: true,
        maxParallelConnections: 8,
        minChunkSize: 1024,
        maxChunkSize: 8388608,
        chunkProtocolVersions: ['wd-chunk/1'],
      },
      files: {
        'file-2': {
          id: 'file-2',
          fileName: 'notes.txt',
          size: 2048,
          fileType: 'text/plain',
          sha256: null,
          preview: null,
        },
        'file-1': {
          id: 'file-1',
          fileName: 'holiday.png',
          size: 10485760,
          fileType: 'image/png',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          preview: null,
        },
      },
      proposedPlan: {
        mode: 'parallel-chunked',
        chunkSize: 4194304,
        parallelism: 6,
        chunkProtocolVersion: 'wd-chunk/1',
      },
      pin: '482913',
    },
    serialize: serializePrepareUploadRequest,
  },
  {
    file: 'prepare-upload-result.json',
    type: 'PrepareUploadResult',
    description: 'A prepare-upload result with per-file tokens.',
    message: {
      sessionId: 'sess-7f3a',
      files: {
        'file-2': 'tok-bbb',
        'file-1': 'tok-aaa',
      },
      acceptedPlan: {
        mode: 'parallel-chunked',
        chunkSize: 4194304,
        parallelism: 6,
        chunkProtocolVersion: 'wd-chunk/1',
      },
    },
    serialize: serializePrepareUploadResult,
  },
  {
    file: 'transfer-progress.json',
    type: 'TransferProgress',
    description: 'A mid-transfer progress snapshot.',
    message: {
      sessionId: 'sess-7f3a',
      fileId: 'file-1',
      bytesTransferred: 6291456,
      totalBytes: 10485760,
      chunksCompleted: 3,
      totalChunks: 5,
      bytesPerSecond: 1258291,
      state: 'transferring',
    },
    serialize: serializeTransferProgress,
  },
];

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const v of vectors) {
    const canonicalJson = v.serialize(v.message);
    const vector = {
      type: v.type,
      description: v.description,
      message: v.message,
      canonicalJson,
    };
    const path = join(outDir, v.file);
    await writeFile(path, `${JSON.stringify(vector, null, 2)}\n`, 'utf8');
    process.stdout.write(`wrote ${v.file}\n`);
  }
  process.stdout.write(`Generated ${vectors.length} vectors in ${outDir}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exitCode = 1;
});
