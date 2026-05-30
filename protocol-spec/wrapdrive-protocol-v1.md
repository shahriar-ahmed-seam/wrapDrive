# WrapDrive Protocol v1

This document is the authoritative specification of the WrapDrive wire protocol.
Every platform implementation (the shared TypeScript packages and the Kotlin
Android port) MUST conform to this document. Where an implementation and this
document disagree, this document wins, and the disagreement is a bug in the
implementation.

WrapDrive is a superset of the
[LocalSend v2.1 protocol](https://github.com/localsend/protocol). It reuses
LocalSend's multicast announcement, two-way HTTP registration, and
metadata-first upload flow, and extends them with a capability-negotiation
handshake and a parallel chunked-transfer mode. Field names that overlap with
LocalSend keep LocalSend's spelling so the two ecosystems stay compatible.

- **Protocol version string:** `2.1`
- **Application protocol string:** `wrapdrive/1`
- **HTTP namespace:** `/api/wrapdrive/v1`
- **Default port:** `53317` (TCP for HTTP, UDP for multicast)
- **Multicast group:** `224.0.0.167`
- **Transport (v1):** plaintext HTTP on the local network
- **Encoding:** UTF-8 JSON for all request and response bodies

---

## 1. Terminology

- **Peer** — a WrapDrive device discovered on the same local network, uniquely
  identified by its `fingerprint`.
- **Sender** — the device that initiates a transfer and uploads file data.
- **Receiver** — the device that hosts the HTTP server, consents to a transfer,
  and writes file data to disk.
- **Session** — one negotiated transfer of one or more files from a single
  sender to a single receiver, identified by a `sessionId`.
- **Chunk** — a contiguous byte range of a single file, identified by a
  zero-based `index` with a byte `offset` and a `length`.

The key words MUST, MUST NOT, SHALL, SHOULD, and MAY are to be interpreted as
described in RFC 2119.

---

## 2. Discovery

Discovery makes peers aware of each other without manual configuration. It has
three mechanisms, tried in order of preference: multicast announcement, HTTP
registration (two-way and as a subnet-scan fallback), and manual entry by IP.

### 2.1 Multicast announcement

A device announces itself by sending a UDP datagram to the multicast group
`224.0.0.167` on port `53317`. The datagram body is a JSON `Announcement`:

```jsonc
{
  "alias": "Nice Orange",
  "version": "2.1",
  "deviceModel": "Pixel 8",
  "deviceType": "mobile",
  "fingerprint": "f1a2b3c4...",
  "port": 53317,
  "protocol": "http",
  "download": false,
  "announce": true,
  "capabilities": {
    /* Capabilities object, see §4.2 */
  },
}
```

- On startup a device MUST send an announcement with `announce: true`.
- While running, a device MUST re-announce at intervals not exceeding **5
  seconds** so that peers can refresh their time-to-live timers.
- When a device receives an announcement whose `fingerprint` differs from its
  own, it SHOULD reply by registering with the announcer over HTTP (§2.2). A
  device MUST ignore an announcement whose `fingerprint` equals its own
  (self-discovery exclusion).
- A device SHOULD send a final announcement with `announce: false` when shutting
  down to let peers prune it promptly.

### 2.2 HTTP registration

Registration is the two-way exchange of `DeviceInfo` + `Capabilities`. It lets a
peer that received a multicast announcement hand back its own details, and it
serves as the discovery mechanism when multicast is unavailable.

```
POST /api/wrapdrive/v1/register
Content-Type: application/json

{ ...DeviceInfo, "capabilities": { ...Capabilities } }
```

Response `200 OK`:

```
{ ...DeviceInfo, "capabilities": { ...Capabilities } }
```

- A receiver of `register` MUST respond with its own `DeviceInfo` and
  `Capabilities`.
- If a `register` request does not receive a successful response within **5
  seconds**, the caller SHOULD retry up to a maximum of **3 attempts** before
  abandoning that address, leaving its peer list unchanged for that address.

### 2.3 Subnet-scan fallback

If no multicast announcement has been received from any other device within
**10 seconds** after discovery starts, a device SHOULD attempt discovery by
sending a `register` request (§2.2) to each host address on the local subnet.

### 2.4 Manual entry

When a user supplies a peer IP address manually, the device MUST attempt
discovery by sending a `register` request to that address.

### 2.5 Peer lifetime

- A peer is considered alive while announcements or successful register
  exchanges continue to arrive from it.
- If nothing has been received from a peer for more than **30 seconds**
  (the time-to-live window), the device MUST remove it from the peer list.
- The device MUST emit a peers-changed event whenever a peer is added, updated,
  or removed.

---

## 3. HTTP Endpoints

All endpoints live under `/api/wrapdrive/v1`. All request and response bodies
are UTF-8 JSON unless they carry raw file bytes.

| Method | Path                | Purpose                                            |
| ------ | ------------------- | -------------------------------------------------- |
| POST   | `/register`         | Two-way discovery exchange (§2.2)                  |
| GET    | `/info`             | Return this device's `DeviceInfo` (debug/health)   |
| POST   | `/prepare-upload`   | Submit metadata, obtain consent, negotiate a plan  |
| POST   | `/upload`           | Upload a full file body (single-stream mode)       |
| POST   | `/upload-chunk`     | Upload one chunk (parallel-chunked mode)           |
| POST   | `/finalize`         | Optionally trigger explicit verification/commit    |
| POST   | `/cancel`           | Cancel an in-progress session                      |
| POST   | `/prepare-download` | Reverse-download metadata (receiving into browser) |
| GET    | `/download`         | Reverse-download a file body                       |

### 3.1 `POST /prepare-upload`

Begins a session. The sender submits its identity, capabilities, the file
metadata, and the transfer plan it proposes. The receiver runs its consent gate
and negotiates the final plan.

Request:

```jsonc
{
  "info": {
    /* DeviceInfo, §4.1 */
  },
  "capabilities": {
    /* Capabilities, §4.2 */
  },
  "files": {
    "<fileId>": {
      /* FileMeta, §4.4 */
    },
  },
  "proposedPlan": {
    /* TransferPlan, §4.3 */
  },
  "pin": "123456", // optional; present only when the receiver requires a PIN
}
```

Response `200 OK`:

```jsonc
{
  "sessionId": "f2c0...",
  "files": {
    "<fileId>": "<opaque-token>",
  },
  "acceptedPlan": {
    /* TransferPlan, §4.3 — the negotiated result */
  },
}
```

Error responses:

| Status | Meaning                                                                 |
| ------ | ----------------------------------------------------------------------- |
| 401    | A PIN is required and was missing or incorrect.                         |
| 403    | The user declined, or the consent prompt timed out (60 s).              |
| 409    | A session is already active; this device accepts one session at a time. |
| 429    | Too many failed PIN attempts (5); locked out for 60 s.                  |

The receiver MUST NOT write any file bytes before the user accepts. The
`acceptedPlan` is computed by the capability negotiator (§5) from the sender's
and receiver's capabilities and the total file size.

### 3.2 `POST /upload-chunk`

Uploads one chunk in parallel-chunked mode. All identifying fields travel as
query parameters; the body is the raw chunk bytes.

```
POST /api/wrapdrive/v1/upload-chunk
  ?sessionId=<id>
  &fileId=<id>
  &token=<opaque-token>
  &chunkIndex=<n>
  &offset=<byteOffset>
  &length=<byteLength>
Content-Type: application/octet-stream

<raw chunk bytes>
```

- The receiver MUST validate the `token` and that the request originates from the
  pinned sender IP; otherwise it MUST respond `403`.
- The receiver MUST validate `offset >= 0`, `offset + length <= file.size`, and
  that the received body length equals `length`; otherwise it MUST reject the
  chunk without writing.
- The receiver writes the bytes at `offset` in the pre-allocated destination
  (§6). A duplicate chunk MUST be idempotent.
- Success is `200 OK` with an empty body.

### 3.3 `POST /upload`

Uploads a full file body in single-stream mode.

```
POST /api/wrapdrive/v1/upload
  ?sessionId=<id>
  &fileId=<id>
  &token=<opaque-token>
Content-Type: application/octet-stream

<raw full file bytes>
```

The receiver streams the body to disk, then verifies and commits (§7). Token and
sender-IP rules are identical to §3.2.

### 3.4 `POST /finalize`

Optional. Lets the sender explicitly request verification/commit of a file.

```
POST /api/wrapdrive/v1/finalize?sessionId=<id>&fileId=<id>
```

Response `200 OK`:

```jsonc
{ "verified": true }
```

### 3.5 `POST /cancel`

Cancels a session. The receiver MUST discard any partially written data and
release the session lock.

```
POST /api/wrapdrive/v1/cancel?sessionId=<id>
```

### 3.6 Reverse download (`prepare-download`, `download`)

These endpoints let a device that cannot host a server (a pure browser tab)
receive files. The hosting peer exposes the file; the browser pulls it.

```
POST /api/wrapdrive/v1/prepare-download   -> { sessionId, files, ... }
GET  /api/wrapdrive/v1/download?sessionId=<id>&fileId=<id>&token=<token>
```

Reverse download is always single-stream (§7).

---

## 4. Data Models

All models serialize to UTF-8 JSON. Field names that overlap with LocalSend v2.1
use LocalSend's names. Optional fields that are absent serialize as `null`
(they MUST round-trip: a `null` parses back to "absent/none").

### 4.1 DeviceInfo

```typescript
interface DeviceInfo {
  alias: string; // human label, e.g. "Nice Orange"
  version: string; // protocol version, "2.1"
  deviceModel: string | null;
  deviceType: 'mobile' | 'desktop' | 'web' | 'headless' | 'server' | null;
  fingerprint: string; // random per run (HTTP) or cert SHA-256 (HTTPS)
  port: number; // default 53317
  protocol: 'http' | 'https'; // "http" in v1
  download: boolean; // reverse-download API available
}
```

**Validation rules**

- `alias` MUST be non-empty and at most **64** characters.
- `port` MUST be within the inclusive range **1024–65535**.
- `fingerprint` MUST be non-empty.
- `protocol` MUST be `http` or `https`.
- A peer whose `fingerprint` equals the local device's is ignored (§2.1).

### 4.2 Capabilities

The WrapDrive extension that drives negotiation.

```typescript
interface Capabilities {
  appProtocol: string; // "wrapdrive/1"
  parallelChunkedSend: boolean;
  parallelChunkedReceive: boolean;
  maxParallelConnections: number; // >= 1
  minChunkSize: number; // bytes, > 0
  maxChunkSize: number; // bytes, >= minChunkSize
  chunkProtocolVersions: string[]; // e.g. ["wd-chunk/1"]
}
```

**Validation rules**

- `minChunkSize` MUST be greater than `0`.
- `minChunkSize` MUST be less than or equal to `maxChunkSize`.
- `maxParallelConnections` MUST be greater than or equal to `1`.
- If `parallelChunkedReceive` is `true`, the runtime MUST be able to perform
  positional writes (§6). A runtime that cannot MUST advertise
  `parallelChunkedReceive: false`.

### 4.3 TransferPlan

The negotiated result that governs how a session moves bytes.

```typescript
interface TransferPlan {
  mode: 'parallel-chunked' | 'single-stream';
  chunkSize: number; // bytes; equals file size in single-stream
  parallelism: number; // concurrent connections; 1 in single-stream
  chunkProtocolVersion: string | null; // null in single-stream
}
```

### 4.4 FileMeta

```typescript
interface FileMeta {
  id: string;
  fileName: string;
  size: number; // bytes
  fileType: string; // MIME type
  sha256: string | null; // whole-file hash; nullable
  preview: string | null; // optional thumbnail/preview
}
```

### 4.5 ChunkRef

```typescript
interface ChunkRef {
  index: number; // 0-based
  offset: number; // byte offset in the file
  length: number; // bytes; the last chunk may be smaller
  sha256?: string; // optional per-chunk hash
}
```

### 4.6 Session models

```typescript
interface PrepareUploadRequest {
  info: DeviceInfo;
  capabilities: Capabilities;
  files: Record<string, FileMeta>;
  proposedPlan: TransferPlan;
  pin?: string;
}

interface PrepareUploadResult {
  sessionId: string;
  files: Record<string, string>; // fileId -> opaque token
  acceptedPlan: TransferPlan;
}

interface TransferProgress {
  sessionId: string;
  fileId: string;
  bytesTransferred: number;
  totalBytes: number;
  chunksCompleted: number;
  totalChunks: number;
  bytesPerSecond: number;
  state: 'negotiating' | 'transferring' | 'verifying' | 'done' | 'failed' | 'cancelled';
}
```

---

## 5. Capability Negotiation

Negotiation is a pure function of both peers' capabilities and the file size. It
is the single point that guarantees parallel chunking is used only when both
sides genuinely support it; otherwise both sides agree to single-stream.

```
negotiate(sender: Capabilities, receiver: Capabilities, fileSize: number): TransferPlan
```

The result is `parallel-chunked` **if and only if all** of the following hold:

1. `sender.parallelChunkedSend` is `true`, and
2. `receiver.parallelChunkedReceive` is `true`, and
3. the intersection of `sender.chunkProtocolVersions` and
   `receiver.chunkProtocolVersions` is non-empty, and
4. the chunk-size ranges overlap:
   `max(sender.minChunkSize, receiver.minChunkSize)
<= min(sender.maxChunkSize, receiver.maxChunkSize)`, and
5. `fileSize` is strictly greater than the negotiated `chunkSize`.

Otherwise the result is `single-stream`.

**Parallel-chunked plan fields**

- `chunkSize` — the **default chunk size is 4 MiB** (`4 * 1024 * 1024`), clamped
  to the overlapping range `[max(min), min(max)]`. If transferring at that chunk
  size would produce more than **10,000 chunks**, `chunkSize` is raised to the
  smallest value within the range that keeps the chunk count at or below 10,000,
  capped at the range maximum.
- `parallelism` — `min(sender.maxParallelConnections,
receiver.maxParallelConnections)`, with a floor of `1`.
- `chunkProtocolVersion` — a version present in both peers' lists (the highest
  common version).

**Single-stream plan fields**

- `chunkSize` equals `fileSize`, `parallelism` equals `1`,
  `chunkProtocolVersion` equals `null`.

**Properties** (verified by property-based tests):

- Deterministic: identical inputs always yield identical plans.
- Idempotent: re-negotiating with an already-chosen plan's capabilities never
  strengthens the plan.
- Pure: no I/O, no external state mutation.

---

## 6. Parallel Chunked Transfer

This mode mirrors a download manager: a file is split into chunks that are sent
concurrently and written straight to their final byte positions, so reassembly
is implicit.

### 6.1 Chunk planning

```
planChunks(fileSize, chunkSize): ChunkRef[]
```

- The chunks tile `[0, fileSize)` exactly: their lengths sum to `fileSize`, with
  no gaps and no overlaps.
- Indices are zero-based and contiguous; `offset[i]` equals the sum of all
  preceding lengths.
- Every chunk except the last has `length == chunkSize`; the last chunk's length
  is in `(0, chunkSize]`.
- `fileSize == 0` yields an empty list.

### 6.2 Sending (parallel scheduler)

- A bounded worker pool issues at most `parallelism` concurrent `/upload-chunk`
  requests at any instant.
- Each chunk's bytes are read as a byte range from the source file; the engine
  never loads a whole file into memory. Peak memory is bounded by
  `parallelism * chunkSize`.
- **Retry:** a request that times out (no response within **30 seconds**) or
  returns HTTP **500–599** is retried with exponential backoff starting at
  **500 ms**, doubling each attempt, capped at **16 s**, for up to **5** retry
  attempts. Other workers continue during a retry.
- **Non-retriable:** a request that returns HTTP **400–499** stops retrying
  immediately; the scheduler cancels the session and marks it failed.
- **Exhaustion:** if a chunk fails on all 5 retry attempts, the scheduler sends
  `/cancel` and marks the session failed; the receiver commits no file.

### 6.3 Receiving (implicit reassembly)

- On accepting a parallel-chunked session, the receiver pre-allocates the
  destination (a temporary `.part` file) to the full declared size before
  writing any chunk. If pre-allocation fails, the session fails and no bytes are
  written.
- Each chunk is validated (§3.2) and written at its `offset`. Writes are
  positional and idempotent, so concurrent writes to disjoint ranges need no
  global lock and any arrival order yields a byte-identical result.
- When every chunk index has been recorded, the receiver verifies the whole-file
  hash (§7) and commits (§7).

---

## 7. Single-Stream Transfer and Integrity

- In single-stream mode the sender transmits one full-file body over a single
  HTTP connection via `/upload` (or the receiver pulls it via `/download` in
  reverse mode), without chunking.
- The receiver streams the body to a temporary file.
- **Integrity gate:** when `FileMeta.sha256` is provided, the receiver computes
  the SHA-256 of the received file and commits to the final path **only if** the
  computed hash equals the provided hash. On mismatch it discards the file,
  leaves nothing at the final path, and marks the session failed.
- When no `sha256` is provided, the receiver commits once the received byte count
  equals the declared file size.
- If the connection terminates before the full size is received, the receiver
  discards the partial file and marks the session failed.
- **Commit** renames the temporary file to its final path. The final `fileName`
  MUST be sanitized to strip path separators and prevent directory traversal
  before writing.

The integrity gate is identical for parallel-chunked and single-stream modes:
a file reaches its final path only after passing verification.

---

## 8. Security Posture (v1)

WrapDrive v1 targets a trusted local network and mirrors LocalSend's default
posture.

- **Transport:** plaintext HTTP confined to the LAN. The `protocol` field is
  `http` in v1; the `https` value is reserved for a future version. No
  end-to-end encryption in v1.
- **Consent:** every inbound session requires explicit user acceptance via
  `/prepare-upload` before any bytes are written. A consent prompt that is not
  answered within **60 seconds** is treated as a decline (`403`).
- **PIN:** an optional PIN gates `/prepare-upload` (`401` on missing/incorrect).
  After **5** failed attempts from an IP the server responds `429` for a **60 s**
  lockout, after which the attempt counter resets.
- **Token + IP pinning:** `/prepare-upload` issues a per-file opaque token; every
  `/upload` and `/upload-chunk` MUST present a valid token and originate from the
  pinned sender IP, or the server responds `403`.
- **Single active session:** the server accepts one session at a time and
  responds `409` to a competing `prepare-upload`. A session with no chunk/upload
  activity for **60 seconds** is terminated and its lock released.
- **Path safety:** received file names are sanitized before writing.
- **Fingerprint:** random per run over HTTP, which also prevents self-discovery.

---

## 9. Conformance

Implementations MUST agree byte-for-byte on serialization. The repository's
`protocol-spec/test-vectors/` directory holds canonical serialized messages;
both the TypeScript and the Kotlin implementations run a conformance suite that
asserts they serialize to byte-identical UTF-8 JSON and parse each vector back to
the canonical value. Any divergence is a conformance failure.
