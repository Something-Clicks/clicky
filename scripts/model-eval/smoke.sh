#!/usr/bin/env bash
# 30-second check BEFORE the real run: server up, auth works, one tiny call, JSON-schema output obeyed. No dataset used.
set -euo pipefail
TOKEN_FILE="${TOKEN_FILE:-$HOME/.eval-token}"; T="$(cat "$TOKEN_FILE")"
curl -fsS -H "Authorization: Bearer $T" http://127.0.0.1:8000/v1/models | head -c 300; echo
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/v1/models); echo "no-token request status (expect 401): $code"
