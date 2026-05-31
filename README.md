# WrapDrive

Fast, private file sharing for devices on the same network. No internet, no
accounts, no cloud. WrapDrive discovers nearby devices automatically and sends
files directly between them — across Android, desktop, and the web.

Its headline feature is **parallel chunked transfer**: large files are split
into pieces and sent over several connections at once (the way a download
manager such as IDM works), then written straight to their final positions on
the receiver. When a device can't do that, the two sides negotiate a safe
single-stream fallback automatically, so a transfer never fails just because one
peer is more limited.

## Platforms

| Platform | Stack                                      | Parallel chunked transfer                                |
| -------- | ------------------------------------------ | -------------------------------------------------------- |
| Android  | Kotlin, Jetpack Compose, Material 3        | Send and receive                                         |
| Desktop  | Electron, React, TypeScript (frameless UI) | Send and receive                                         |
| Web      | React PWA, TypeScript                      | Send always; receive via the optional web-host companion |

## Repository layout

```text
protocol-spec/   Single source of truth for the wire protocol + test vectors
packages/        Shared TypeScript: protocol, transfer engine, design tokens
apps/android/    Native Android app (Kotlin / Compose)
apps/desktop/    Electron desktop app (frameless, React)
apps/web/        Web PWA + optional Node web-host companion
docs/            Project documentation
scripts/         Build, release, and codegen scripts
```

## Getting started

Requirements: Node.js >= 20 and pnpm >= 9.

```bash
pnpm install
pnpm build
pnpm test
```

This builds and tests the shared TypeScript packages (protocol, transfer engine,
design tokens) and runs the property-based and interop test suites.

### Run the desktop app

```bash
pnpm --filter @wrapdrive/desktop dev
```

### Run the web app

```bash
pnpm --filter @wrapdrive/web dev
```

To run two web instances side by side (for local testing):

```bash
WD_WEB_PORT=5173 pnpm --filter @wrapdrive/web dev
WD_WEB_PORT=5174 pnpm --filter @wrapdrive/web dev
```

### Web-host companion (optional, for full parity)

A browser tab cannot host a server, so on its own the web app can send files
(in parallel when the receiver supports it) but cannot receive chunked
transfers. Running the small Node companion gives the web app full parity —
device discovery and chunked receive — by hosting a WrapDrive peer locally that
the browser talks to over `localhost`:

```bash
pnpm --filter @wrapdrive/web-host build
pnpm --filter @wrapdrive/web-host start
```

Received files are saved to `~/Downloads/WrapDrive`.

### Build the Android app

```bash
cd apps/android
./gradlew assembleDebug
```

The APK is written to `apps/android/app/build/outputs/apk/debug/`.

## Security posture (v1)

WrapDrive v1 is designed for a trusted local network and mirrors LocalSend's
default posture:

- Transfers use plaintext HTTP confined to the local network.
- There is no end-to-end encryption in v1 (HTTPS with self-signed certificates
  is planned for a later version).
- Every incoming transfer requires explicit consent on the receiving device,
  and an optional PIN can be required before a transfer is accepted.
- Each session issues per-file opaque tokens and pins the sender's IP; only one
  transfer session is active at a time.
- Received files are verified against a whole-file SHA-256 before they are
  committed, and file names are sanitized to prevent path traversal.

The HTTP server binds to the LAN interface on port 53317 and is intentionally
reachable by same-network devices; it is gated by consent and an optional PIN
rather than network-level authentication.

## Protocol

WrapDrive speaks a superset of the LocalSend v2.1 protocol so it can stay
compatible while adding capability negotiation and chunked transfer. The
authoritative definition is in
[`protocol-spec/wrapdrive-protocol-v1.md`](protocol-spec/wrapdrive-protocol-v1.md).

## License

[MIT](LICENSE)
