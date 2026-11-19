# Phase 4: AI preparation and controlled execution — report

**Status:** complete (November 19, 2026). Live AI calls switch on when `ANTHROPIC_API_KEY` is set on the server.

## What was built
- **Draft preparation** (`src/lib/server/drafts.ts`): `claude-opus-5-5`, one structured-output call per draft, **no tools**. Types: page title + meta description, homepage copy, Google Business Profile post, blog draft. Grounded only in the business profile, the card, its evidence and the owner's notes; website text and notes are treated as data. Missing facts become bracketed placeholders (e.g. `[your phone number]`), never inventions. Drafts that promise results or use unverified figures are rejected.
- **Controls in the database** (`20261119140000_ai_preparation.sql`):
  - `agent_runs` record draft type, permission (`draft_only`, the only value allowed), notes, model, output, token usage, error, who started it, timing.
  - One active run per card; no new run while a draft awaits review; 20 runs per business per day; stale runs time out.
  - `approvals`: only the **owner** can approve, reject or request changes (enforced in `decide_approval`, not just hidden in the UI). Decisions are final and logged.
  - Approving marks the card *approved*; rejecting or requesting changes returns it to *new* with the notes pre-filled for the next draft.
- **Approvals screen** per the reference: pending drafts with Approve / Copy text / Request changes / Reject; recent decisions; approved drafts can be copied or **downloaded** (`/app/approvals/[id]/download`, members only).
- **Action detail**: full draft lifecycle in the right-hand card (prepare with notes → preparing with auto-refresh → review → approved with copy/download → mark done). Clear message when AI drafting is not switched on.
- **No auto-publishing**: no publishing integration exists or is verified, so nothing is ever published for the customer. The UI says so.
- Dashboard "Approvals waiting" is real. Activity shows draft and approval events in plain language.
- **Admin → Agent runs**: last-day counts and recent runs with status, tokens and errors; no draft content; each view logged.

## Tests
| Suite | Result |
|---|---|
| Database | 56/56 — 14 new: draft-only permission, manual tasks refused, cross-tenant start/complete/approve refused and invisible, malformed drafts refused, owner-only approval, decided-once, changes-requested and failure paths return the card, daily cap, no direct writes, admin listing refused for non-admins |
| Unit | 87/87 — 4 new: draft generator sends no tools and treats notes as data; rejects promises, refusals, truncated and empty output; outline formatting |
| Live (Supabase + browser) | No-key message; draft saved through the real API; dashboard count; approvals preview; request-changes needs a note; owner approves; queue empties; download contains the draft; unknown and signed-out downloads refused; activity entries — all pass |

## Not built (needs access)
- **Review replies** need reviews from Google Business Profile (OAuth + Google approval).
- **Publishing** to a website or Google: only after a verified, customer-authorized integration exists.
