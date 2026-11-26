# Capsule format 1.0.0

A `.repro` capsule is a single-disk ZIP with no archive comment, ZIP64 or encryption. Entries use Stored or Deflate compression and regular-file metadata. Only these exact names are supported.

| Path | Contents |
| --- | --- |
| `manifest.json` | [Manifest](manifest.schema.json) including provenance, capabilities, privacy and inventory |
| `scenario/events.ndjson` | One [event](event.schema.json) per LF-terminated line |
| `scenario/assertions.json` | [Oracle](assertions.schema.json) with both original failure and expected success |
| `fixtures/postgres.json` | [PostgreSQL fixture](postgres.schema.json) with the synthetic product |
| `fixtures/http.json` | [HTTP fixture](http.schema.json) for the synthetic GET and exact response |
| `report/capture-summary.json` | [Capture summary](capture-summary.schema.json) with action, HTTP and oracle observations |
| `attachments/sha256/<64 lowercase hex>` | Optional opaque bytes. The exporter emits only the mandatory files. The inspector validates attachment integrity and replay ignores the bytes. |

Archive input is capped at 8 MiB with 16 MiB expanded, 2 MiB per entry and 64 entries total. ZIP directory metadata, local header correspondence, CRC, manifest SHA-256 and actual expanded byte lengths are checked. Entries remain in memory and are never extracted. Known paths require exact ASCII spellings. Duplicate entries, case variants, traversal, absolute paths and symbolic-link entries are refused.

JSON is decoded as strict UTF-8. Member names must be unique, numbers finite, and nesting is capped at 24. The runtime schema refuses unknown properties and currently accepts only version 1.0.0. NDJSON allows 1,000 events and 4,096 bytes per record. Sequence numbers begin at one. Monotonic timestamps are in integer microseconds, with a maximum of one hour. The first event navigates to the fixture home page and the last event is the single failure marker. Replay uses semantic waits and the recorded action deadlines.

See the [integrity and compatibility ADR](../adr/002-portable-capsule.md) for the digest rules. Source schemas live in the TypeScript boundary and the JSON Schemas are generated with `npm run build && node config/generate-schemas.mjs`. Archive, JSON and event-sequence rules also apply at runtime.

## Execution outcomes

| Status | Exit | Meaning |
| --- | ---: | --- |
| `CAPTURED` | 0 | A completed recording with the original failure |
| `REPRODUCED` | 0 | Play observed the original failure with the positive assertion |
| `FIX_VERIFIED` | 0 | Verify observed exactly one order with the positive assertion |
| `NOT_REPRODUCED` | 3 | Play observed expected checkout behavior |
| `STILL_FAILING` | 4 | Verify still observed the original failure |
| `DIVERGED` | 5 | A UI action, page or required network observation diverged |
| `INCONCLUSIVE` | 6 | An observation or prerequisite was incomplete or the deadline elapsed |
| `BLOCKED` | 7 | Recipe compatibility or isolation preflight failed |
| `ERROR` | 8 | Command input, worker protocol or cleanup failed |
| `CANCELLED` | 130 | The operator cancelled the run |

The CLI attaches the capture and target source digests, the original oracle digest and file inventory to the [worker result](worker-result.schema.json). The host additionally reports cleanup as `ok`, `incomplete` or `not-needed`.
