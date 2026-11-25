# Evaluation log

One section per round. Fill from the read-only SQL in `EVALUATION.md`. Never paste secrets or customer-private data; use the test businesses only.

## Round template
- Date, branch/commit, adapter and model (`anthropic-dev`, `claude-sonnet-5-5`), sites (name only), who ran it.
- Per site: pass/fail per line of the quality standard, with the specific items that failed (quote the item, the site text it contradicts or lacks).
- Failures grouped by cause → the change made (file, test added).
- Cost and time per business.
- Verdict: round met every line? Consecutive clean rounds so far: N.

## Rounds
None yet. No real-model run has happened (no `ANTHROPIC_API_KEY` on Preview as of Nov 25).
