# Local end-to-end stack

**Update Nov 26:** `local-up.sh` builds and runs this stack (PostgREST release binary; GoTrue built from its Go module; no Docker, no Mailpit, auto-confirmed sign-ups) and `tests/e2e/campaigns.spec.ts` ran on it: 7/7 desktop and 7/7 iPhone. The text below is the original plan.


The full customer journey (Save this → email link → claim in another browser) needs Supabase Auth and the
Supabase REST API. Docker images could not be pulled in the build environment, so the plan is a small
local stand-in, used only for tests:

| Piece | What | Port |
|---|---|---|
| Postgres | local server, fresh database `sc_e2e`, every repo migration applied | 5432 |
| Supabase Auth (GoTrue `v2.182.1`, official release binary) | sign-up, magic links, sessions | 9999 |
| PostgREST (`v12.2.3`, official release binary) | the REST API the app calls | 3001 |
| Mailpit (`v1.27.10`, official release binary) | catches every email locally — nobody is emailed | 1025 / 8025 |
| `gateway.mjs` | mimics the Supabase URL layout (`/auth/v1`, `/rest/v1`) and serves the email templates | 54321 |

Tests read the sign-in link from Mailpit and open it in a **second, separate browser context** to prove the
cross-browser claim. There is no test-only code path in the app.

Running the stack means executing third-party release binaries downloaded from GitHub. That was blocked by the
build environment's permission policy, so it needs explicit approval. The alternative with the same coverage is a
**Supabase development branch** of the Clicky project (real Supabase Auth and API, separate database, billed
hourly by Supabase), which also validates the migration on real Supabase before production.

`templates/` holds the exact email templates recommended for production (see `docs/launch/INTEGRATIONS.md`).
