# Project status

M0 and M1 are implemented and exercised locally for the synthetic checkout fixture. The complete loop runs on Linux x86-64 with a local Docker Engine. The workspace is an initialized Git repository on `main` with a local working tree, no commits and no configured remote. The hosted CI workflow is configured and awaits a repository run. License and publishing decisions are pending owner approval.

| Roadmap | Status | Local acceptance evidence |
| --- | --- | --- |
| R01 | Verified locally, owner decision open | A fresh source copy installed from the lockfile, built, type-checked and passed 12 tests. GitHub Actions workflow, ADRs and dependency provenance are present. Project license remains pending. |
| R02 | Verified locally | The fixture processed one checkout request and wrote two PostgreSQL rows in the bad variant and one in the fixed variant. Both showed the checkout confirmation. |
| R03 | Verified locally | Strict JSON Schemas and runtime limits are in place. Tests cover versions, fields, duplicate keys, event ordering and a real golden capsule. |
| R04 | Verified locally | ZIP inspection and export round-trip passed. Tests cover malformed data, path traversal, symbolic links, duplicate and case-variant names, ZIP64, size, CRC and SHA-256 mismatches. |
| R05 | Verified locally | The demo exercised `init`, `doctor` and `inspect`. Inspection succeeded with no Docker executable on `PATH`. Permission checks and review storage ran in tests. |
| R06 | Verified locally | The headless recorder observed five actions through a dedicated Playwright Chromium context. A real PTY run completed via `stop`, and a separate early stop cancelled without a draft. A real Chromium test refused an ambiguous selector. |
| R07 | Verified locally | Each run restored and checked the synthetic PostgreSQL fixture, matched one local shipping response and used a read-only row-count oracle. |
| R08 | Verified locally for allowlisted capture | Export refused before review. Regression tests planted fake secrets in fields for headers, URL, body, database, console, screenshot and cookies. The export policy refused all those fields and synthetic-only capture was exported. |
| R09 | Verified locally | Docker configuration and loopback-only egress were checked in every run. The demo forced a deadline and a worker exit. Both tests confirmed cleanup. |
| R10 | Verified locally | A single exported capsule reproduced the bad variant and verified the fix with the original oracle and five matched actions. Repeat runs passed 10/10 for each variant. Negative checks covered the still-failing variant, revision mismatch and selector divergence. |

The commands, observed results, host details and timings are in [checkout execution evidence](evidence/checkout.md). The [format](format/README.md), [security model](security/README.md) and [provenance](PROVENANCE.md) document the boundaries of this implementation.

## Open gates

R11–R32 remain planned. The current recorder handles the included guided or automatic headless checkout flow. Free-form headed capture, raw logs and screenshot review, and crash-draft recovery remain open. Compatibility has been verified on one host. Cross-machine testing, a larger corpus, release readiness, independent security review and the owner’s license decision remain open.
