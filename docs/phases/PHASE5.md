# Phase 5: Measurement, activity and retention — report

**Status:** complete (November 19, 2026). Emails and the weekly worker switch on with their server settings (below).

## What was built
- **Verified outcomes.** Each new analysis re-checks every action marked done or approved. *Verified fixed* only when the same check no longer fires **and** the source it depends on was observed or measured this time; *Still found* when it fires again; nothing is claimed when the source was missing. Changes are logged. For PageSpeed actions the before/after mobile scores are shown, both from Google PageSpeed Insights with the same test.
- **Stale data.** Analyses older than 30 days are flagged on the dashboard and Analysis page, with a one-click refresh.
- **Notifications.** Per-person preferences in Settings (draft ready — owners only; analysis complete). Sent through Resend when configured; every attempt is logged as sent, skipped or failed. A notification problem never breaks the work it reports on.
- **Weekly re-analysis.** "Check my website again every week" (owner setting, on by default). `GET /api/cron/weekly-analysis`, scheduled daily by Vercel Cron (`vercel.json`), re-analyzes up to 3 businesses per call whose last analysis is over 7 days old, then notifies. Requires `CRON_SECRET` (constant-time check) and `SUPABASE_SECRET_KEY`; the database lets the service role call only the worker and analysis functions it needs.
- **Activity** shows outcomes in plain language.

## Tests
| Suite | Result |
|---|---|
| Database | 67/67 — 11 new: verification rules (fixed / still found / silent when unchecked), worker functions refused to customers and anonymous, worker runs end to end and is logged as scheduled, opt-in respected, recurring setting owner-only, preferences private, recipients respect opt-outs and roles, notification log isolation |
| Unit | 93/93 — 6 new: email skipped/sent/failed paths, HTML escaping, logging each attempt, never throws, cron endpoint refuses missing/wrong/short secrets |
| Live (Supabase + browser) | Follow-up analysis through the real API marked the fixed issue *Verified fixed* and the unchanged ones *Still found*; done list and detail show it; preferences and weekly setting persist; activity shows outcomes; phone width OK |

## Needs your settings to switch on
- `RESEND_API_KEY`, `EMAIL_FROM` (verified domain), optional `EMAIL_REPLY_TO`.
- `SUPABASE_SECRET_KEY` and `CRON_SECRET` for the weekly worker (Vercel Cron passes the secret automatically).
