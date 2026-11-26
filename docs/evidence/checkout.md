# Checkout execution evidence

Verified locally on 2026-11-26 using Linux x86-64, Docker Engine 29.9.2, 16 logical CPU threads on an AMD Ryzen 7 7435HS and 15 GiB of host RAM. The runner used Node.js 26.13.0, Chromium 159.0.8154.6 (revision 1255), and PostgreSQL 16.15. Container budget was two CPUs, 1 GiB of memory, 256 processes and 384 MiB of writable tmpfs.

```bash
npm ci --ignore-scripts
npm run lint
npm test
node config/generate-schemas.mjs --check
npm audit --audit-level=moderate
image=$(bash examples/checkout/prepare.sh)
REPRO_VERBOSE=1 npm run demo -- "$image"
python tests/guided-qa.py /tmp/repro-demo.Tkyfr5Rq/bad
```

The isolated demo used approved image ID `sha256:391ba5a564b8e01299d7122b2b2e65ffc86fd249f0be9bdeb3ab19a4ce33adef`. The bad and fixed app content digests were `2d99b87aec452bcb0f1c88b758a4fd7c8595c582b20a0816017ffc2ec735e7b6` and `9e357bff8f4f8d103da73068302e51e5e29f493d90384c98d335da2e8d92a44c`. Both replay reports used oracle SHA-256 `89f1bdffcfe023fc083c732834a514754af358dbbea9e9dda6739084674172e9`.

Selected fields from the three CLI reports:

```jsonl
{"status":"CAPTURED","actions":5,"actual":{"orders":2,"checkout_complete":true,"matched_http":1,"unmatched_http":0,"checkout_requests":1,"page_errors":0},"network":"loopback-only","cleanup":"ok","duration_ms":1832}
{"status":"REPRODUCED","actions":5,"actual":{"orders":2,"checkout_complete":true,"matched_http":1,"unmatched_http":0,"checkout_requests":1,"page_errors":0},"network":"loopback-only","cleanup":"ok","duration_ms":1337}
{"status":"FIX_VERIFIED","actions":5,"actual":{"orders":1,"checkout_complete":true,"matched_http":1,"unmatched_http":0,"checkout_requests":1,"page_errors":0},"network":"loopback-only","cleanup":"ok","duration_ms":1465}
```

The integration and guided checks printed:

```text
Verified capture, offline inspection, replay and fix assertions.
Negative checks: STILL_FAILING (4), BLOCKED revision mismatch (7), DIVERGED at action 2 (5).
Timeout and forced worker termination both cleaned up their owned containers.
Guided stop returned CAPTURED with confirmed cleanup.
Guided stop returned CANCELLED with confirmed cleanup.
Ambiguous selector was refused by the real Chromium action executor.
```

The first export attempt returned exit 8 before review approval. After approval, the exported capsule opened with Docker absent from `PATH`. That artifact is the [golden capsule](../../fixtures/capsules/checkout.repro). There were zero running or stopped REPRO workload containers after verification.

## Repeat runs

One capsule, sequential runs, prebuilt image. Each invocation created a fresh container and verified the database fixture before execution. Command wall time includes Docker startup and cleanup. Image provisioning and dependency downloads are outside these measurements. Runs used one machine.

| Command | Expected result | Observed | Runner median | CLI wall median | CLI wall range |
| --- | --- | ---: | ---: | ---: | ---: |
| Play against bad | `REPRODUCED` | 10/10 | 1,318 ms | 2,718.5 ms | 2,388–2,958 ms |
| Verify against fixed | `FIX_VERIFIED` | 10/10 | 1,333 ms | 2,680 ms | 2,542–3,222 ms |

The twenty calls took 54,576 ms in total. Each run matched five actions, showed the checkout confirmation, recorded the required order count, and confirmed cleanup. [Per-run measurements](checkout-repeat.ndjson)
