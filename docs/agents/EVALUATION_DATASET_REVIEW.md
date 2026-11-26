# Scored-case review (Nov 26 2026)
All 10 scored cases (T1-T10) were read against their pages and ground truth by an automatic audit (`evals/model/audit-patterns.ts`, pinned by `tests/unit/eval-pattern-audit.test.ts`). The frozen dataset was NOT changed.

## Findings
- 15 answer-key patterns would wrongly flag correct, harmless wording (for example `best` in "best wishes", `cater`, `ship`, `only`, `eco`, `candid`, `sale`). They would punish a good model. Fixes are in `review/proposed-dataset-fixes.patch` (applies cleanly; changes only `cases/test-a.ts`, `cases/test-b.ts`, the audit test, the freeze log and the generated freeze doc).
- A product defect surfaced while building packets: page text from minified HTML ran words together. Fixed in `src/lib/server/site-scan.ts` with tests. This changes what every model sees, so it is better fixed before the first run.
- Scoring fairness fixes made before any model ran: tolerant keyword matching (`$`, `,`, ranges, "to"), people can confirm or overturn automatic recall and invented-fact flags, extra note plans no longer count toward workflow time or cost.

## Needs your approval
1. Apply `proposed-dataset-fixes.patch` (re-freeze, new hash `cd59922f…`) or keep the current hash and accept the 15 known false-flag risks (they are caught as "review" flags that a person resolves, but fail-class ones can fail a case automatically).
2. The scoring-method fixes above.
3. The T1 scorer rule listed in `MODEL_EVALUATION_PLAN.md` change log.

## Ready for independent review
Three packets with exact source pages and answer keys: `review/CASE_REVIEW_T1.md`, `CASE_REVIEW_T3.md`, `CASE_REVIEW_T7.md`. Each asks the reviewer a short list of questions (is the key true to the page; is anything missing; would a good answer be unfairly flagged). The reviewer should not have seen any model output. Regenerate with `pnpm modelreview`.
