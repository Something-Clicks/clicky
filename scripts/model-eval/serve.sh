#!/usr/bin/env bash
# Start ONE candidate on THIS machine, bound to localhost only. Run on the rented GPU box, never in Production.
# Needs: vllm installed (see checklist), huggingface.co reachable. Prints no secret.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; . "$here/models.sh" "${1:-}"
umask 077
TOKEN_FILE="${TOKEN_FILE:-$HOME/.eval-token}"
[ -s "$TOKEN_FILE" ] || head -c 24 /dev/urandom | base64 | tr -d '/+=\n' > "$TOKEN_FILE"
echo "model: $MODEL_REPO @ $MODEL_REV  (served name: $MODEL_ID)"
exec vllm serve "$MODEL_REPO" --revision "$MODEL_REV" --served-model-name "$MODEL_ID" \
  --host 127.0.0.1 --port 8000 --api-key "$(cat "$TOKEN_FILE")" $SERVE_ARGS
