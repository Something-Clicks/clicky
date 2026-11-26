#!/usr/bin/env bash
# Run the frozen SCORED set (test cases only) against the server started by serve.sh. Run from the repo root on the GPU box.
# Required: MODELCHECK_GPU_USD_PER_HOUR (the owner-approved hourly price) and MODELCHECK_GPU_CLASS.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; . "$here/models.sh" "${1:-}"
: "${MODELCHECK_GPU_USD_PER_HOUR:?set to the approved hourly price}"; : "${MODELCHECK_GPU_CLASS:?set to the GPU name}"
TOKEN_FILE="${TOKEN_FILE:-$HOME/.eval-token}"
pnpm modelfreeze   # refuses to run if the dataset or standards changed without a logged re-freeze
export SELF_HOSTED_MODEL_URL="http://127.0.0.1:8000" SELF_HOSTED_MODEL_TOKEN="$(cat "$TOKEN_FILE")" SELF_HOSTED_MODEL_ID="$MODEL_ID"
[ -n "$EXTRA_BODY" ] && export SELF_HOSTED_EXTRA_BODY="$EXTRA_BODY"
export MODELCHECK_SET=test MODELCHECK_LABEL="${MODELCHECK_LABEL:-round1}"
pnpm modelcheck      # writes eval-results/modelrun-*.json (raw outputs, timings, tokens)
echo "Next: MODELSCORE_BLIND=1 pnpm modelscore (blind sheet + key), then independent scoring. Then SHUT DOWN the GPU."
