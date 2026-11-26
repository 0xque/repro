#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

npm run build >&2
bad=$(cd examples/checkout/src && sha256sum app.ts bad.ts | sha256sum | cut -d ' ' -f 1)
fixed=$(cd examples/checkout/src && sha256sum app.ts fixed.ts | sha256sum | cut -d ' ' -f 1)
contract=$( { sha256sum package-lock.json tsconfig.json examples/checkout/Dockerfile;
  find packages -type f -name '*.ts' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum; } | sha256sum | cut -d ' ' -f 1)
image_id=$(mktemp)
trap 'rm -f -- "$image_id"' EXIT
env -u DOCKER_CONTEXT docker --host unix:///var/run/docker.sock build --platform linux/amd64 --file examples/checkout/Dockerfile \
  --build-arg BAD_REVISION="$bad" --build-arg FIXED_REVISION="$fixed" --build-arg RECIPE_REVISION="$contract" --iidfile "$image_id" . >&2
digest=$(cat "$image_id")
env -u DOCKER_CONTEXT docker --host unix:///var/run/docker.sock image inspect "$digest" --format '{{.Id}}'
