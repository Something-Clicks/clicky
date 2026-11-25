# Real-model evaluation of the Marketing Agent (Preview)

Purpose: find out whether the agent's business understanding, findings, drafts and plans are accurate and useful on real small-business websites, then improve what is weak and test again. Nothing here runs in Production.

**Status (Nov 25): NOT RUN.** There is no Anthropic key on Preview and this sandbox cannot reach public websites, so no real-model result exists yet. Everything below is the procedure and what will be checked.

## 1. One-time setup (you; Claude never sees the secret)
Vercel → `something-clicks` → Settings → Environment Variables → Add, **Preview only, branch `claude/ecstatic-curie-9shvjf`**:
- `ANTHROPIC_API_KEY` (mark Sensitive; set a monthly spend limit in the Anthropic console first).
Already set on that branch by Claude (values never shown): `MARKETING_MODEL_PROVIDER=anthropic-dev`, `MODEL_USAGE_KEY`, `FEATURE_BUSINESS_PROFILE`, `FEATURE_MODEL_FINDINGS`, `FEATURE_DRAFTS`, `FEATURE_STRATEGY`. clicky-dev has `agent_functions_enabled` = 1 and `agent_review_enabled` = 1.
Also still missing for a full signed-in Preview (unrelated to the model): `STRIPE_SECRET_KEY` (test), `SUPABASE_SECRET_KEY`.
Then redeploy the branch (push or Redeploy). The Preview is behind Vercel login (Deployment Protection stays on).

## 2. Choose 3–5 real small-business sites
Use businesses you own or have permission to test (the agent reads only public pages, but these results will be inspected). Aim for variety: (a) a local service business with a phone number and clear services, (b) a thin one-page site, (c) a multi-page site with pricing and testimonials, (d) a site with strong claims ("best", "guaranteed", awards), (e) a site that is mostly images or has little text.

## 3. Run (about 15 minutes per site)
With a normal test account (sign up on the Preview; or `pat-d@e2e.test`-style accounts after re-enabling them in clicky-dev):
1. Create the business with its real website, run **Check my website**.
2. **Business details**: look at what was proposed; confirm one, correct one, reject one.
3. **To do**: open a few model-written findings; for a headline or page-title finding, **prepare a draft**, edit it (new version), approve a version.
4. **Your plan**: prepare it, then **revise** once with a note such as "we can't take weekend jobs"; approve or reject.
Note any screen that is confusing, slow or wrong. Tell Claude when done (the business names are enough).

## 4. What Claude does with it
Claude reads the stored output from clicky-dev (read-only SQL, or `/admin/agent-review` when signed in as a platform admin) and compares it with the live site fetched separately. Per item:
- **Understanding:** is each proposed detail true on the site? Is each quote really on the page? Which "inferred" items are wrong or overreach? What is missing that the site plainly says (services, area, phone, hours, prices, reasons to trust)? Are "unknown"s honest?
- **Findings:** is the problem real and visible on the page? Is the evidence the right passage? Is it important or cosmetic? Did the fixed checks already cover it (duplicates)? Any generic advice, promises, invented figures?
- **Drafts:** would the owner use it as is? Does it invent services, places, claims or numbers? Does it sound like the business? Does it keep the owner's notes?
- **Plan:** are priorities in a sensible order for this business's goal? Does each "why now" name something about this business? Are next steps specific? Are questions worth asking? Anything the owner would find presumptuous?
- **Automatic screening:** the scores and flags on `/admin/agent-review` (evidence, supported claims, specific, actionable) as a cross-check, never as the verdict.
- **Cost and speed:** tokens and dollars per business (`admin_model_usage`), time per step, any refusals or invalid outputs.

## 5. Read-only SQL Claude uses (clicky-dev)
```sql
-- recent runs for the businesses under test
select o.name, w.kind, w.status, w.provider, w.model, w.usage, w.steps, w.started_at
from public.marketing_workflows w join public.organizations o on o.id = w.organization_id order by w.started_at desc limit 20;
-- what it learned
select o.name, f.category, f.field, f.value, f.evidence_class, f.basis, f.evidence, f.status
from public.business_facts f join public.organizations o on o.id = f.organization_id order by o.name, f.category, f.field;
-- findings with their quoted evidence
select o.name, c.origin, c.title, c.explanation, c.why_it_matters, c.recommended_action, c.evidence_class, c.evidence_basis,
       (select jsonb_agg(e.excerpt) from public.action_card_evidence ace join public.analysis_evidence e on e.id = ace.evidence_id where ace.action_card_id = c.id) as quotes
from public.action_cards c join public.organizations o on o.id = c.organization_id order by o.name, c.origin, c.impact_priority;
-- plans and spend
select o.name, p.status, p.plan from public.marketing_plans p join public.organizations o on o.id = p.organization_id order by p.created_at desc;
select o.name, u.capability, u.outcome, u.input_tokens, u.output_tokens, u.cost_micro from public.model_usage u join public.organizations o on o.id = u.organization_id order by u.created_at desc;
```

## 6. Improve and repeat
Each weak result becomes one of: a prompt change (`modules/*.ts` SYSTEM text), a grounding rule (`grounding.ts`), a quality-screening rule (`src/lib/agent-quality.ts`), or "needs a data source we do not have" (recorded as a limit). Every change gets a unit test with the real failure as the example, then the same sites are run again and compared. Stop expanding capabilities until two consecutive rounds show no inaccurate assumptions and no unsupported claims in the sample.

## 7. Release criteria (all must hold; releasing is your decision and a code change)
- Two clean rounds on at least 3 varied real sites: no invented facts, no promises, evidence on every finding, plans that name business specifics.
- Owner-review flows used end to end by a person on a phone and a laptop.
- Server-held key on the four model-storing functions (see `MARKETING_AGENT.md`, "Server-only functions") and an admission limit on plan and draft requests.
- Privacy Policy and Terms approved by an attorney with the model-provider data-processing disclosure.
- Production migrations 20261126–20261201 applied with your approval, `agent_functions_enabled` still 0 until release.
