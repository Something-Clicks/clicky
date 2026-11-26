#!/usr/bin/env bash
# One command: local stack (throwaway database, local sign-in + API), build, two servers (normal and "Production" mode), run the
# organized suite, stop the servers. Touches nothing outside this machine except reading the public websites the tests use.
# Usage: pnpm test:e2e:local [playwright args, e.g. --project=e2e-chromium]
set -euo pipefail
cd "$(dirname "$0")/.."
W="${E2E_STACK_DIR:-/tmp/sc-stack}"
CLARITY_TEST_ID="${E2E_CLARITY_ID:-e2e-clarity-id}"
GA_TEST_ID="${E2E_GA_ID:-G-E2ETEST000}"

service postgresql start >/dev/null 2>&1 || true
tests/e2e/stack/local-up.sh "$W"

export NEXT_PUBLIC_SITE_URL=http://localhost:3100 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(cat "$W/anon.key")"
# Placeholder analytics ids (not real accounts): the tag requests are intercepted by the tests and never leave this machine.
export CLARITY_ID="$CLARITY_TEST_ID" NEXT_PUBLIC_GA_MEASUREMENT_ID="$GA_TEST_ID"
pnpm build
pkill -f "next start -p 3100" 2>/dev/null || true; pkill -f "next start -p 3101" 2>/dev/null || true
FEATURE_CAMPAIGNS=1 FEATURE_BUSINESS_PROFILE=1 FEATURE_STRATEGY=1 NODE_USE_ENV_PROXY=1 nohup pnpm exec next start -p 3100 > "$W/next.log" 2>&1 &
VERCEL_ENV=production FEATURE_CAMPAIGNS=1 FEATURE_BUSINESS_PROFILE=1 FEATURE_STRATEGY=1 NODE_USE_ENV_PROXY=1 nohup pnpm exec next start -p 3101 > "$W/next-prod.log" 2>&1 &
trap 'pkill -f "next start -p 3100" 2>/dev/null || true; pkill -f "next start -p 3101" 2>/dev/null || true' EXIT
sleep 6
E2E_SUITE=1 E2E_PORT=3100 E2E_PROD_BASE=http://localhost:3101 E2E_CLARITY_ID="$CLARITY_TEST_ID" E2E_GA_ID="$GA_TEST_ID" \
  pnpm exec playwright test --trace off "$@"
