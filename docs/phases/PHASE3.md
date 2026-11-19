# Phase 3: Marketing intelligence — report

**Status:** complete for website + PageSpeed sources (November 19, 2026). Search Console and Google Business Profile wait on Google OAuth credentials (see below).

## What was built
- **Safe website fetcher** (`src/lib/server/safe-fetch.ts`): http/https on standard ports only, no credentials in URLs, blocked internal host names; every resolved address must be public and the socket connects to the validated address (no DNS re-binding window); redirects followed by hand (max 3) and re-validated; HTML only; 2 MB cap; 10 s budget. Built on `node:http` so it changes no global networking.
- **Site scan**: homepage plus up to 4 priority pages (contact, services, about, pricing, locations), same site only.
- **Checks** (`src/lib/server/checks.ts`): HTTPS, page title, meta description, main headline, tap-to-call phone, service area mentioned, mobile viewport, thin homepage, image descriptions, PageSpeed mobile performance. Each records evidence labeled *observed*, *measured* or *missing*; each finding cites its evidence. Priority reflects the owner's goal (e.g. tap-to-call is high impact when the goal is more calls).
- **PageSpeed Insights** (mobile). If it fails or is over quota, the gap is recorded as missing data, never a made-up score.
- **Claude wording** (`claude-opus-5-5`, structured outputs, server-side only). Claude rewrites wording only; it cannot add, drop or re-prioritize findings or change evidence. Output is checked against the findings and a guard against promises and invented figures. Any failure (no key, refusal, timeout, off-schema) falls back to template wording, so analysis never depends on AI.
- **Schema**: `data_connections`, `analyses`, `analysis_evidence`, `action_cards` (the PRODUCT_SPEC schema), `action_card_evidence`. Members read; writes only through audited functions. One analysis at a time per business, 10 per day, every card must cite evidence from its analysis, newer analyses replace untouched older cards.
- **Screens on real data**: Dashboard (counts, last analysis, next best move, empty states), Action Cards (to do / done / dismissed, impact filters), Action detail (why, recommended action, expected benefit marked as not guaranteed, every piece of evidence, mark done / dismiss / reopen), Analysis (run, auto-refresh while running, source coverage and freshness, all evidence), Connections, onboarding steps 2 and 3, Activity labels.

## Tests
| Suite | Result |
|---|---|
| Unit | 83/83 — SSRF (private/metadata/IPv6-mapped addresses, connect-time resolution, redirects to private, loops, non-HTML, size cap), scan extraction, checks, full pipeline with template wording, failure paths |
| Database | 42/42 — 15 new: isolation on all five tables, concurrency and daily limits, evidence-citation rule, state checks, audit log |
| Live (Supabase + browser) | Onboarding 1→2→3; real analysis of an unreachable site fails with a plain message via auto-refresh; pipeline output saved through the real API as the test user; dashboard, list, filters, detail, mark done, analysis coverage/evidence, activity, phone widths — 19/19 |

## Accepted risk
A signed-in member can call `complete_analysis` with hand-made results for their **own** business. It cannot affect any other tenant, and it is logged. Removing it would need a privileged worker key; not worth it at this stage.

## Waiting on you
- **Search Console & Business Profile**: a Google Cloud OAuth client (and, for Business Profile, Google's API access approval). The Connect buttons explain this until then.
- **PageSpeed API key** (free, Google Cloud): without it Google's shared quota is often exhausted.
- **Anthropic API key**: without it cards use the template wording (fully functional).
- **Supabase → Authentication → Passwords → Leaked password protection**: turn on.
