#!/usr/bin/env bash
# Verifies Modal authentication WITHOUT deploying or running anything billable, and without printing token values.
# Uses only `modal token info` (read-only). Reads MODAL_TOKEN_ID / MODAL_TOKEN_SECRET from the environment.
set -u
if [ -z "${MODAL_TOKEN_ID:-}" ] || [ -z "${MODAL_TOKEN_SECRET:-}" ]; then echo "MODAL_TOKEN_ID and/or MODAL_TOKEN_SECRET not set in this environment"; exit 2; fi
MODAL_BIN="${MODAL_BIN:-modal}"
out="$("$MODAL_BIN" token info 2>&1)"; rc=$?
# never echo token values even if the CLI prints them
printf '%s\n' "$out" | sed -E "s/${MODAL_TOKEN_ID//\//\\/}/<token-id>/g; s/${MODAL_TOKEN_SECRET//\//\\/}/<token-secret>/g; s/(as|ak)-[A-Za-z0-9]{10,}/<redacted>/g"
if [ $rc -eq 0 ]; then echo "RESULT: authenticated"; else echo "RESULT: authentication failed (exit $rc)"; fi
exit $rc
