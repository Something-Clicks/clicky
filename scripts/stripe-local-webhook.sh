#!/usr/bin/env bash
# Local Stripe webhook forwarding for Something Clicks.
# TEST MODE ONLY. clicky-dev ONLY. Runs on YOUR computer. Never touches Vercel or production.
#
#   NEXT_PUBLIC_SUPABASE_URL=https://ofstvbgaoznipsiqbjjp.supabase.co ./scripts/stripe-local-webhook.sh
#
# Guards (any failure stops the script before anything is forwarded):
#   1. No live Stripe key in this shell (STRIPE_API_KEY / STRIPE_SECRET_KEY) and no STRIPE_ALLOW_LIVE.
#   2. No extra flags (no --live, no --api-key): this script only forwards TEST events.
#   3. NEXT_PUBLIC_SUPABASE_URL must be clicky-dev, never production.
#   4. The logged-in Stripe CLI account must answer livemode=false.
# Steps and checks: docs/launch/INTEGRATIONS.md, "Webhook testing: local Stripe CLI".
set -euo pipefail

PORT="${PORT:-3100}"
DEV_REF="ofstvbgaoznipsiqbjjp"
PROD_REF="ysmwnxvyjougetdlpnba"
EVENTS="checkout.session.completed,checkout.session.async_payment_succeeded,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed,invoice.paid,invoice.payment_failed"

die() { echo "REFUSING: $*" >&2; exit 1; }

command -v stripe >/dev/null 2>&1 || die "the Stripe CLI is not installed (https://docs.stripe.com/stripe-cli)."

# 1. No live keys.
for name in STRIPE_API_KEY STRIPE_SECRET_KEY; do
  value="${!name:-}"
  case "$value" in
    sk_live_* | rk_live_*) die "$name holds a LIVE key. Unset it and use test mode." ;;
  esac
done
[ -z "${STRIPE_ALLOW_LIVE:-}" ] || die "STRIPE_ALLOW_LIVE is set in this shell. Unset it."

# 2. No extra flags.
for arg in "$@"; do
  die "extra argument '$arg' is not allowed (this script is test-mode only; no --live, no --api-key)."
done

# 3. The app must be pointed at clicky-dev.
url="${NEXT_PUBLIC_SUPABASE_URL:-}"
[ -n "$url" ] || die "NEXT_PUBLIC_SUPABASE_URL is not set in this shell (it must be the clicky-dev URL)."
case "$url" in
  *"$PROD_REF"*) die "NEXT_PUBLIC_SUPABASE_URL points at PRODUCTION Supabase." ;;
  *"$DEV_REF"*) ;;
  *) die "NEXT_PUBLIC_SUPABASE_URL must be the clicky-dev project ($DEV_REF)." ;;
esac

# 4. The CLI must be logged in to a TEST-mode account.
if ! balance="$(stripe balance retrieve 2>&1)"; then
  die "the Stripe CLI is not logged in (or failed). Run: stripe login"
fi
echo "$balance" | grep -Eq '"livemode": *false' || die "the Stripe CLI did not answer livemode=false. Do not continue."

# Not fatal: remind if the local app is not up yet.
if ! curl -s -o /dev/null -m 3 "http://localhost:${PORT}/robots.txt"; then
  echo "note: nothing is answering on http://localhost:${PORT} yet. Start the app first (see the docs)." >&2
fi

echo "OK: test mode, clicky-dev. Forwarding to http://localhost:${PORT}/api/webhooks/stripe"
echo "Copy the signing secret from the banner below into STRIPE_WEBHOOK_SECRET for the LOCAL app only."
exec stripe listen --events "$EVENTS" --forward-to "localhost:${PORT}/api/webhooks/stripe"
