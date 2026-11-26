#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
umask 077

if [[ $# -gt 1 ]]; then
  echo 'Usage: npm run demo -- [prepared-image-id]' >&2
  exit 2
fi
image=${1:-}
if [[ -z "$image" ]]; then image=$(bash examples/checkout/prepare.sh); fi
work=$(mktemp -d "${TMPDIR:-/tmp}/repro-demo.XXXXXXXX")
mkdir "$work/bad" "$work/fixed"
node_bin=$(command -v node)
cli="$PWD/dist/packages/cli/src/index.js"
repro() { "$node_bin" "$cli" "$@" --json; }
json_get() { "$node_bin" -p "JSON.parse(require('node:fs').readFileSync(0,'utf8')).$1"; }

repro doctor | tee "$work/doctor.json"
repro init --project "$work/bad" --image "$image" --variant bad --approve
repro init --project "$work/fixed" --image "$image" --variant fixed --approve
repro record --project "$work/bad" --url http://127.0.0.1:3000 --profile checkout-demo --approve | tee "$work/record.json"
session=$(json_get session < "$work/record.json")
capsule="$work/checkout.repro"
if repro export --project "$work/bad" --session "$session" --out "$capsule" 2>"$work/rejected-export.json"; then
  echo 'Export unexpectedly allowed before review' >&2
  exit 1
fi
test ! -e "$capsule"
repro review --project "$work/bad" --session "$session" > "$work/review.json"
repro review --project "$work/bad" --session "$session" --approve > "$work/approved-review.json"
repro export --project "$work/bad" --session "$session" --out "$capsule"
PATH=/nonexistent "$node_bin" "$cli" inspect "$capsule" --json > "$work/inspect.json"
repro play "$capsule" --project "$work/bad" --offline --approve | tee "$work/play.json"
repro verify "$capsule" --project "$work/fixed" --offline --approve | tee "$work/verify.json"
"$node_bin" dist/tests/demo-checks.js "$work"
printf 'Capsule and evidence saved locally in %s\n' "$work"
