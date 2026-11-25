# Foundation review: the deterministic Marketing Agent (Nov 25 2026)

Scope: the agent as it runs with **no language model**. Nothing here was run against a real third-party business website: this session's network policy blocks public sites and the Preview host (a 403 from the egress proxy; not retried or bypassed), and no permissioned site list exists yet.

## 1. What ran on real systems (clicky-dev Supabase, local app server, real browser)
| What | Result |
|---|---|
| Real Supabase Auth sign-in for owner, member and admin test accounts; owner-only approvals; RLS isolation between members and outsiders | Passed in the browser |
| Plan screen, Business details, internal review page, hidden-in-Production mode, desktop and 390 px | `agent-screens.spec.ts`: 7/7 desktop, 2/2 iPhone (5 desktop-only skipped by design); axe clean |
| "Refresh the plan" building a rules-based plan end to end (key-gated database functions, plan slot, shape checks, owner approval) | Passed on real clicky-dev with a local server key (hash restored afterwards) |
| Owner flow: Home → free-uses-used-up state → a check that really fails (site unreachable) → plain-words failure on Home and Website check → open a recommendation → approve → dismiss → reopen → member cannot approve | `agent-customer-flow.spec.ts`: 5/5 desktop, 5/5 iPhone |
| Disabled test accounts cannot sign in | Real Auth returned `user_banned`, no token, for correct and wrong passwords |
| Preview variable `MARKETING_MODEL_PROVIDER` (obsolete) | Deleted (Preview only; Production rows byte-identical before and after) |

**Not run:** the deployed Preview (unreachable from here, behind Vercel login, and its variables are scoped to branch `claude/ecstatic-curie-9shvjf`, not the branch this work is on); any real reachable website; real email; Stripe flows; Safari/WebKit.

## 2. What works only in automated tests
- Extraction, labelling and ranking on **fixture sites with known truth** (`tests/unit/site-fixtures.test.ts`, 9 tests): a plumber with structured data, a thin one-pager, a claims-heavy site with a hidden instruction, an image-only site. These prove no invention, exact quotes, correct "unknown" handling and ignoring embedded instructions. They do not show how the agent does on sites it has not seen.
- Database rules: 184 tests on a throwaway Postgres (isolation, owner-only approval, key-gated functions, caps, plan slots, rules-plan acceptance).
- Model-checking rules (grounding, metering, deadlines) with test doubles. **No model inference and no model quality has been verified, and none is possible yet.**
- Totals this pass: lint clean, types clean, 231 unit, 184 database, build passes.

## 3. Defects found by this validation, and fixed
| Found by | Defect | Fix |
|---|---|---|
| Reading the report like a customer | Trust quotes glued navigation and headings onto the real sentence ("Drain cleaning Water heater repair About Contact … We are a family-owned company…") | Quotes now come from single page blocks and must be word for word in the kept page text; test added |
| Same | Plan said a thin homepage "supports your goal to get more calls" (an overclaim) | Goal links limited to direct ones (contact, local); test added |
| Browser walk | After dismissing or marking done a recommendation, the page still said "Mark it done when it's fixed" beside "Dismissed" | Closed state now shown first |
| Browser walk | A failed check looked like a fresh start on Home | Home states why, and that no free use was used |
| Browser walk | Business details could not be reached on a phone once everything was confirmed | Always linked from Home |
| Code sweep | Customer email said "AI prepared a draft"; admin page said "AI preparation" | Reworded (no AI claim; none is used) |
| Code sweep | Business details did not tell a website's own claim from a checked fact | Claims shown as "A claim on your website. We haven't checked that it's true" |
| Code sweep | Scanner user agent said "requested by the site owner" (not verified) | Now says an account holder requested it |

## 4. Accuracy and reliability limits that remain (known, not fixed)
- Trust statements come from fixed English patterns: they miss claims worded differently and can quote a sentence that only mentions a word (for example a warranty *exclusion*). The owner confirms or rejects every detail, so nothing is stored as confirmed, but expect false positives and misses on real sites.
- Services "inferred" from navigation links can be wrong (a link labelled like a service that is not one). Marked inferred with its basis.
- Structured data on a site can be stale or wrong; we report that the site says it, class verified-as-observed, not true.
- Only the homepage and up to 4 linked pages are read; text is capped (6,000 characters a page). JavaScript-rendered sites may appear nearly empty (reported as a thin page, which can be a false finding).
- Rules-based plan: effort is a fixed table, `depends_on` is always empty, goal links are two small rules; it cannot read the owner's free-text notes. It is ordering, not strategy.
- Speed data depends on Google's API availability (a key is optional).
- English only; US phone format assumed.

## 5. Security and data handling
- **Rules plan reuses the model-storage gate** (`MODEL_USAGE_KEY` and the `agent_functions_enabled` switch) because it is saved through the same function. Safe (Production switch is 0) but the naming is misleading; rename or give rules output its own function before any release.
- **No ownership check on scanned domains and robots.txt is not read.** A signed-in person can scan any public site, and quoted text (up to 300 characters) is stored in their account. Decide before launch: verify domain ownership (a DNS or file token) or restrict to what a business may legitimately review, and honour robots.txt.
- Test accounts have a known throwaway password committed in the test files; they are banned (verified), and the repository must stay private.
- Local-key testing required temporarily swapping the clicky-dev `model_usage` secret hash; it was restored and verified identical. Do this only on clicky-dev and restore it.
- Failure messages show only the hostname and plain words (checked in the browser for internals leaking: none).
- No secrets in logs, responses or the repo; the local key file was shredded.

## 6. What must be completed before launch
**Scope A (no model features):** apply Production migrations and variables (your approval); run 3–5 permissioned real sites (`pnpm sitecheck`) and fix what it finds; decide the domain-ownership and robots.txt policy; real email, Stripe webhook and checkout checks; attorney review of Privacy and Terms; real iPhone run; error monitoring decision.
**Scope B (model features):** everything in Track 3 and 4 of `AGENT_ROADMAP.md`, final independent review, attorney-approved wording for the self-hosted model, your release approval.
