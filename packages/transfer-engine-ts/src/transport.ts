/**
 * Sender-side transport abstraction.
 *
 * The parallel scheduler and single-stream sender talk to a receiver through
 * this interface rather than a concrete HTTP client, so the scheduling and
 * retry logic can be unit- and property-tested against an in-memory fake. The
 * real implementations (Node `http`, browser `fetch`, OkHttp on Android) live
 * in their respective platform layers.
 */

/** Identifies the session/file/token a chunk or upload belongs to. */
export interface UploadTarget {
  /** The negotiated session id. */
  sessionId: string;
  /** The file being uploaded. */
  fileId: string;
  /** The opaque per-file token issued at prepare-upload. */
  token: string;
}

/** Result of a transport request, mirroring the meaningful HTTP outcomes. */
export interface TransportResponse {
  /** HTTP-style status code (200 success; 4xx non-retriable; 5xx retriable). */
  status: number;
}

/** One chunk upload request. */
export interface ChunkUpload extends UploadTarget {
  /** Zero-based chunk index. */
  chunkIndex: number;
  /** Absolute byte offset of the chunk. */
  offset: number;
  /** Chunk length in bytes. */
  length: number;
  /** The chunk body. */
  data: Uint8Array;
}

/** Abstraction over the sender's network calls. */
export interface SenderTransport {
  /** POST one chunk (`/upload-chunk`). Rejects on a network/timeout error. */
  uploadChunk(upload: ChunkUpload): Promise<TransportResponse>;
  /** POST a full file body (`/upload`) for single-stream mode. */
  uploadStream(target: UploadTarget, body: AsyncIterable<Uint8Array>): Promise<TransportResponse>;
  /** POST `/cancel` for a session. Best-effort; errors are swallowed by callers. */
  cancel(sessionId: string): Promise<void>;
}
