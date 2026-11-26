#!/usr/bin/env bash
# Local Supabase-compatible stack for browser tests: throwaway Postgres database `sc_e2e`, every repo migration, GoTrue
# (Supabase Auth, built from its open-source Go module), PostgREST (official release binary) and gateway.mjs on :54321.
# Nothing here touches clicky-dev, Production, Stripe or any paid service. Emails are not sent (auto-confirm).
# Usage: tests/e2e/stack/local-up.sh [workdir]   then see docs/launch/LAUNCH_CHECKLIST.md, "Compare and Campaigns".
set -euo pipefail
W="${1:-/tmp/sc-stack}"; mkdir -p "$W"; cd "$W"
JWT="local-test-jwt-secret-at-least-32-characters-long-xx"
export PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if [ ! -x postgrest ]; then
  curl -fsSL -o pgrst.tar.xz https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  tar xJf pgrst.tar.xz
fi
if [ ! -x gotrue ]; then
  export GOPATH="$W/gopath"
  V=github.com/supabase/auth@v1.11.1-0.20261125201355-0725a1d90cd9
  go mod download "$V"; cp -r "$GOPATH"/pkg/mod/github.com/supabase/auth@* auth-src; chmod -R u+w auth-src
  # the module zip omits the fork directory that go.mod points at; use upstream godotenv instead
  (cd auth-src && sed -i '/internal\/forks\/godotenv/d' go.mod && GOFLAGS=-mod=mod go build -o ../gotrue .)
fi

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists sc_e2e" -c "create database sc_e2e"
psql -v ON_ERROR_STOP=1 -q -d sc_e2e <<'SQL'
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator login password 'pgrst' noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin login password 'authpw' noinherit createrole; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
grant all on database sc_e2e to supabase_auth_admin;
grant usage, create on schema public to supabase_auth_admin;
SQL
AUTH_ENV=(GOTRUE_DB_DRIVER=postgres "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:authpw@localhost:5432/sc_e2e?search_path=auth" DB_NAMESPACE=auth
  GOTRUE_API_HOST=127.0.0.1 PORT=9999 GOTRUE_SITE_URL=http://localhost:3100 API_EXTERNAL_URL=http://localhost:54321/auth/v1 "GOTRUE_JWT_SECRET=$JWT"
  GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_MAILER_AUTOCONFIRM=true
  GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_DISABLE_SIGNUP=false "GOTRUE_URI_ALLOW_LIST=http://localhost:3100/**")
env "${AUTH_ENV[@]}" ./gotrue migrate > gotrue-migrate.log 2>&1
psql -q -d sc_e2e -c "grant usage on schema public to anon, authenticated, service_role; alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on functions to anon, authenticated, service_role; alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;"
for f in $(ls "$REPO"/supabase/migrations/*.sql | sort); do psql -v ON_ERROR_STOP=1 -q -d sc_e2e -f "$f" > migrate.log 2>&1 || { echo "migration failed: $f"; tail -5 migrate.log; exit 1; }; done
psql -q -d sc_e2e -c "update public.app_config set value='1' where key='agent_functions_enabled'"

node -e '
const c=require("crypto"),b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({role:"anon",iss:"supabase-local",iat:1700000000,exp:4102444800});
require("fs").writeFileSync("anon.key",h+"."+p+"."+c.createHmac("sha256",process.argv[1]).update(h+"."+p).digest("base64url"))' "$JWT"
pkill -f "$W/postgrest" 2>/dev/null || true; pkill -f "gotrue serve" 2>/dev/null || true; pkill -f "e2e/stack/gateway.mjs" 2>/dev/null || true; sleep 1
PGRST_DB_URI="postgres://authenticator:pgrst@localhost:5432/sc_e2e" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET=$JWT PGRST_SERVER_PORT=3001 PGRST_SERVER_HOST=127.0.0.1 nohup "$W/postgrest" > pgrst.log 2>&1 &
env "${AUTH_ENV[@]}" nohup ./gotrue serve > gotrue.log 2>&1 &
GATEWAY_PORT=54321 nohup node "$REPO/tests/e2e/stack/gateway.mjs" > gateway.log 2>&1 &
sleep 4
echo "Stack is up. Build the app with:"
echo "  NEXT_PUBLIC_SITE_URL=http://localhost:3100 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\$(cat $W/anon.key) pnpm build"
echo "Then: FEATURE_CAMPAIGNS=1 FEATURE_BUSINESS_PROFILE=1 NODE_USE_ENV_PROXY=1 pnpm exec next start -p 3100"
