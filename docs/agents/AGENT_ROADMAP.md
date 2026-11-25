# Agent roadmap (rewritten Nov 25 2026 after the independence decision)

No external AI provider, ever (Anthropic, OpenAI, Gemini or any hosted AI API). Something Clicks owns the agent; any language model is an open-weight model we host ourselves (`OWN_MODEL_PLAN.md`). Status of what exists: `MARKETING_AGENT.md`. What is verified and what is not: `FOUNDATION_REVIEW.md`.

The customer sees one flow and never manages an agent: **Website Intelligence → Business understanding → Strategy → Work prepared → Owner approval → Results**.

Four tracks, in the order we build them. Each later track depends on the earlier ones being real, not on the later ones being finished.

## Track 1. Deterministic marketing intelligence we can build and own (now; needs no model, no GPU, no new spend)
Software that reads evidence and applies rules we can inspect, test and explain. Every output carries its source, an evidence class and a confidence.

| Item | Status |
|---|---|
| Safe website scan, SEO and conversion checks, speed measurement, ranking, Action Cards, evidence classes | Built, tested; real sites **not yet** |
| Structured business profile from the site's own data (schema.org, contact links, services from navigation) and quoted claims; site claims labelled "not checked" | Built, tested on fixtures; real sites **not yet** |
| Rules-based plan (impact, goal, evidence, effort) | Built, tested |
| Outcome tracking: verified fixed / still found, before-after speed | Built |
| Richer extraction: opening hours, social profiles, reviews page, calls to action, contact form, sitemap and page inventory, name/address/phone consistency across pages | Next |
| Local presence checks (service-area pages, address and phone on every page, map link) | Next |
| Performance history and trends across checks; "what changed since last time" | Next |
| Owner-supplied research import (competitor list, keyword exports) with provenance, never scraped data presented as fact | After a data decision |
| Content *inventory* (what pages exist, what is missing for each service) | Next |
**Gate to call Track 1 done:** run on 3–5 permissioned real sites (`pnpm sitecheck`), every line checked by a person, defects fixed, rerun clean. Needs a machine with internet and the owner's site list.

## Track 2. Our own agent orchestration and reasoning workflows (now, in parallel; mostly software)
The "reasoning" that does not need a language model: planning, prioritisation, dependency handling, memory, evaluation, quality control.
- **Built:** orchestrator and workflow records, capability registry, grounding and quality screening, per-business limits, deadlines, approval stages.
- **Next:** dependency rules between actions (title before description, speed before mobile polish) so plans have real `depends_on`; goal-weighted ranking with the owner's confirmed details; workflow memory (what was proposed, accepted, rejected and why, used to stop repeating rejected advice); background job queue and status screen (also required before any slow model); an evaluation harness for plans and extractions with frozen expected results.
- **Not claimed as AI:** none of this is described to customers as AI. The Privacy Policy stays true ("no AI service") until a model is actually used.

## Track 3. Self-hosted open-weight model evaluation (needs your approval for any spend)
Starts only after Tracks 1 and 2 show where language ability is truly needed (understanding a site's positioning, writing drafts in a business's voice).
1. Self-hosted adapter against an OpenAI-compatible endpoint **we host** (not OpenAI), with auth, health check and a protocol test against a local stub.
2. Candidate shortlist by licence and fit; run on **our** evaluation set (20–30 permissioned sites) under the written quality standard (`EVALUATION.md`).
3. Measure quality, invented facts, latency, tokens, real cost; pick one or conclude none qualifies (the deterministic product then ships without model features).
**Needs your approval:** rented GPU budget, candidate rules. Nothing is bought or started until then.

## Track 4. Fine-tuning and eventual proprietary model (long term; not started)
- Adapt a chosen open-weight base on owner-approved examples (confirmed details, approved edits). **Needs explicit customer consent terms first;** no customer data is used for training under the current terms.
- Product wording: "adapted from <base model>"; "our own model" only for weights we trained from scratch.
- Decision gate after adaptation results: continued pre-training, distillation or from-scratch, each with a data, cost and benefit case. Default: keep adapting open-weight bases.

## Never allowed
Inventing business facts; presenting a site's claim as verified; auto-publishing; sending consequential messages without approval; changing billing; accessing other customers' data; bypassing RLS; unlimited model calls; canned text presented as reasoning; any hosted AI API.
