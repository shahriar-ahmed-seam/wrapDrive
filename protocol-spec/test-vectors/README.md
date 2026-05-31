# Protocol conformance test vectors

These JSON files are the canonical, language-neutral fixtures that lock the
TypeScript (`@wrapdrive/protocol`) and Kotlin (Android `core:protocol`)
implementations to byte-identical serialization.

Each vector file has the shape:

```jsonc
{
  "type": "DeviceInfo",       // the protocol message type
  "description": "…",         // what this vector exercises
  "message": { … },           // the canonical message value
  "canonicalJson": "…"        // the exact UTF-8 JSON the serializer must emit
}
```

Both implementations run a conformance suite that, for every vector, asserts:

1. `serialize(message)` produces exactly `canonicalJson` (byte-for-byte), and
2. `parse(canonicalJson)` reproduces `message`.

Canonical JSON uses a fixed key order per message type and sorts map/record
keys ascending, with no insignificant whitespace. Do not hand-edit
`canonicalJson`; regenerate it from the serializer if the schema changes.
