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
pnpm test
```

Per-platform build and run instructions live in `docs/` and in each app's
README. The platforms are developed and verified in order: Android, then
Desktop, then Web.

## Security posture (v1)

WrapDrive v1 is designed for a trusted local network and mirrors LocalSend's
default posture:

- Transfers use plaintext HTTP confined to the local network.
- There is no end-to-end encryption in v1 (HTTPS with self-signed certificates
  is planned for a later version).
- Every incoming transfer requires explicit consent on the receiving device,
  and an optional PIN can be required before a transfer is accepted.

The web-host companion documentation and detailed posture notes are in
[`docs/`](docs/).

## Protocol

WrapDrive speaks a superset of the LocalSend v2.1 protocol so it can stay
compatible while adding capability negotiation and chunked transfer. The
authoritative definition is in
[`protocol-spec/wrapdrive-protocol-v1.md`](protocol-spec/wrapdrive-protocol-v1.md).

## License

[MIT](LICENSE)
