# REPRO

**Every bug should be a file.**

REPRO captures a reproducible checkout failure in a dedicated Chromium instance and exports a reviewed `.repro` capsule. Replay restores synthetic PostgreSQL state, routes a fake shipping quote, and runs the recorded scenario. The capsule can also be opened for inspection without starting Docker.

## Run the demo

Use Linux x86-64 with a local Docker Engine at `/var/run/docker.sock`, Node.js `26.13.0`, and npm `12.2.1`. Allow network access during tool and image preparation. The Playwright and PostgreSQL image needs several gigabytes of disk space. The subsequent capture and replay containers run offline.

```bash
npm ci --ignore-scripts
npm run lint
npm test
REPRO_VERBOSE=1 npm run demo
```

The demo prints the local path to the capsule and evidence. A successful `play` reports `REPRODUCED` with two orders. A successful `verify` reports `FIX_VERIFIED` with one order. Both require “Checkout complete,” one checkout submission, and one matched shipping quote. The demo also checks the export review barrier, divergence, the original bug under `verify`, isolation, and cleanup.

## Run each command

From the repository root after installing dependencies:

```bash
image=$(bash examples/checkout/prepare.sh)
work=$(mktemp -d)
mkdir "$work/bad" "$work/fixed"
repro() { node dist/packages/cli/src/index.js "$@"; }

repro doctor --json
repro init --project "$work/bad" --image "$image" --variant bad --approve
repro init --project "$work/fixed" --image "$image" --variant fixed --approve
repro record --project "$work/bad" --url http://127.0.0.1:3000 --profile checkout-demo --approve
```

Copy the returned session UUID into `session`. Review prints the retained bytes and excluded capture surfaces. Pass `--approve` after checking them.

```bash
repro review --project "$work/bad" --session "$session"
repro review --project "$work/bad" --session "$session" --approve
repro export --project "$work/bad" --session "$session" --out "$work/checkout.repro"
repro inspect "$work/checkout.repro" --summary --json
repro play "$work/checkout.repro" --project "$work/bad" --offline --approve --json
repro verify "$work/checkout.repro" --project "$work/fixed" --offline --approve --json
```

Use `inspect --summary` to check the capsule without printing its manifest, event details, or oracle. It reports schema version, event count (including the final marker), and declared entry count and uncompressed bytes (excluding the manifest). The same validation runs as with regular `inspect`. A successful check confirms the format and contents are internally consistent; it does not authenticate the sender or run the recording. Omit `--summary` for full inspection.

Add `--guided` to `record` to advance each action in the headless browser from the terminal. When it prompts to mark the failure, press Enter or run `repro stop --project "$work/bad"` from a second terminal using the same CLI. A stop before that prompt cancels the capture. If multiple guided sessions are active, pass `--session ID`. The default capture profile runs the same steps automatically.

Private drafts default to 24-hour retention. Set `REPRO_RETENTION_HOURS` between 1 and 168 to change it. Record purges expired drafts in the chosen project, and `repro purge --project DIR` runs the same purge on demand. Add `--session ID` to purge a specific draft immediately. Capsules and evidence you export remain where you saved them.

## Supported scope

The only supported target is the included checkout fixture. It supports the main frame, test-ID selectors, one shipping fixture and a fixed order-count oracle. The local operator approves the image and project recipe before use. The qualified replay environments, known gaps, and measured results are in [project status](docs/STATUS.md). See the [capsule specification](docs/format/README.md) and [security model](docs/security/README.md) for the file and execution boundaries.

The repository is a private, unpublished implementation. The project license decision is pending owner approval.
