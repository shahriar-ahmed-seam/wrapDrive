/**
 * WrapDrive v1 wire-protocol data models.
 *
 * Every model serializes to UTF-8 JSON. Field names that overlap with the
 * LocalSend v2.1 protocol keep LocalSend's spelling for interoperability; the
 * WrapDrive-specific extensions live under {@link Capabilities} and the
 * transfer models. This file is the TypeScript counterpart of section 4 of
 * `protocol-spec/wrapdrive-protocol-v1.md`.
 */

/** The category of a device, used to pick an icon and to inform negotiation. */
export type DeviceType = 'mobile' | 'desktop' | 'web' | 'headless' | 'server';

/** Transport scheme. v1 always uses `http`; `https` is reserved for later. */
export type Protocol = 'http' | 'https';

/** The mode a transfer session runs in once negotiation completes. */
export type TransferMode = 'parallel-chunked' | 'single-stream';

/** Lifecycle states reported through {@link TransferProgress}. */
export type TransferState =
  | 'negotiating'
  | 'transferring'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'cancelled';

/**
 * Identity broadcast by a device during discovery and registration.
 *
 * @see {@link validateDeviceInfo} for the validation rules.
 */
export interface DeviceInfo {
  /** Human-readable label, e.g. `"Nice Orange"`. Non-empty, <= 64 chars. */
  alias: string;
  /** Protocol version string; `"2.1"` for WrapDrive v1. */
  version: string;
  /** Device model name, or `null` when unknown. */
  deviceModel: string | null;
  /** Device category, or `null` when unspecified. */
  deviceType: DeviceType | null;
  /** Stable per-run identifier; also used to exclude self-discovery. */
  fingerprint: string;
  /** Port the HTTP server listens on; defaults to 53317. */
  port: number;
  /** Transport scheme; `"http"` in v1. */
  protocol: Protocol;
  /** Whether the reverse-download API is available on this device. */
  download: boolean;
}

/**
 * The WrapDrive capability advertisement that drives transfer negotiation.
 *
 * @see {@link validateCapabilities} for the validation rules.
 */
export interface Capabilities {
  /** Application-protocol identifier; `"wrapdrive/1"`. */
  appProtocol: string;
  /** Whether this device can send files as parallel chunks. */
  parallelChunkedSend: boolean;
  /** Whether this device can receive files as parallel chunks. */
  parallelChunkedReceive: boolean;
  /** Maximum concurrent connections this device will use; >= 1. */
  maxParallelConnections: number;
  /** Smallest acceptable chunk size in bytes; > 0. */
  minChunkSize: number;
  /** Largest acceptable chunk size in bytes; >= minChunkSize. */
  maxChunkSize: number;
  /** Chunk wire-protocol versions this device understands. */
  chunkProtocolVersions: string[];
}

/** The negotiated agreement that governs how a session moves bytes. */
export interface TransferPlan {
  /** Resolved transfer mode. */
  mode: TransferMode;
  /** Chunk size in bytes; equals the file size in single-stream mode. */
  chunkSize: number;
  /** Concurrent connection count; `1` in single-stream mode. */
  parallelism: number;
  /** Negotiated chunk-protocol version; `null` in single-stream mode. */
  chunkProtocolVersion: string | null;
}

/** Metadata describing a single file offered in a transfer. */
export interface FileMeta {
  /** Sender-assigned identifier, unique within a session. */
  id: string;
  /** Display file name; sanitized by the receiver before writing. */
  fileName: string;
  /** File size in bytes. */
  size: number;
  /** MIME type. */
  fileType: string;
  /** Whole-file SHA-256 hash, or `null` when not provided. */
  sha256: string | null;
  /** Optional preview/thumbnail payload, or `null`. */
  preview: string | null;
}

/** A contiguous byte range of a single file. */
export interface ChunkRef {
  /** Zero-based chunk index. */
  index: number;
  /** Byte offset of this chunk within the file. */
  offset: number;
  /** Chunk length in bytes; the final chunk may be smaller. */
  length: number;
  /** Optional per-chunk SHA-256 hash. */
  sha256?: string;
}

/** Body of `POST /prepare-upload`: metadata, capabilities, and proposed plan. */
export interface PrepareUploadRequest {
  /** The sender's identity. */
  info: DeviceInfo;
  /** The sender's capabilities, used for negotiation. */
  capabilities: Capabilities;
  /** The files offered, keyed by file id. */
  files: Record<string, FileMeta>;
  /** The plan the sender proposes; the receiver may negotiate it down. */
  proposedPlan: TransferPlan;
  /** PIN supplied when the receiver requires one; omitted otherwise. */
  pin?: string;
}

/** Successful `POST /prepare-upload` response. */
export interface PrepareUploadResult {
  /** Identifier for the accepted session. */
  sessionId: string;
  /** Per-file opaque upload tokens, keyed by file id. */
  files: Record<string, string>;
  /** The negotiated plan both peers will follow. */
  acceptedPlan: TransferPlan;
}

/** A progress snapshot emitted by the transfer engine for one file. */
export interface TransferProgress {
  /** The owning session id. */
  sessionId: string;
  /** The file this snapshot refers to. */
  fileId: string;
  /** Bytes transferred so far. */
  bytesTransferred: number;
  /** Total bytes to transfer for this file. */
  totalBytes: number;
  /** Chunks completed (parallel-chunked mode). */
  chunksCompleted: number;
  /** Total chunks planned (parallel-chunked mode). */
  totalChunks: number;
  /** Smoothed throughput estimate in bytes per second. */
  bytesPerSecond: number;
  /** Current lifecycle state. */
  state: TransferState;
}
