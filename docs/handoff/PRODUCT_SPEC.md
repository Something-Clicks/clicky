# Product Specification

## Product principles
1. Make the next step obvious.
2. Explain marketing in ordinary language.
3. Show evidence behind every recommendation.
4. Let the owner stay in control.
5. Make progress visible.
6. Never invent data, integrations, or results.

## Main product loop
Connect → Analyze → Recommend → Execute → Measure.

## Action Card schema
- id, organization_id, analysis_id
- title / issue
- plain-language explanation
- why_it_matters
- recommended_action
- expected_benefit (non-guaranteed)
- impact_priority
- confidence
- evidence references and source URLs/records
- ai_capable boolean and execution_type
- approval_required boolean
- status: new, approved, in_progress, done, failed
- created_at, updated_at, completed_at
- result_summary and failure_reason

## AI execution
AI may analyze permitted data and prepare drafts. Approval gates must be explicit and enforced server-side. A draft can be copied/downloaded. Auto-publishing is allowed only after a verified integration is implemented, tested, connected, and authorized. Record agent runs, inputs, outputs, permissions, approvals, and results. Avoid storing unnecessary personal data.

## Data connections
Each connection must record provider, organization, authorization status, granted scopes, connected account identity where appropriate, token storage reference (never raw token in client), last sync, sync status, and revocation/disconnect state. Use least privilege. Do not imply a source is connected until authorization succeeds.

## Analysis evidence
Store the source, observation, timestamp, URL or provider record reference, and relevant excerpt/measurement. Clearly label missing, stale, estimated, and observed data. Every recommendation must trace to evidence.

## Billing
Prices are configured once in a typed server-side catalog. Stripe Checkout in test mode first. Verify webhook signatures, use idempotency, and provision entitlements only after a verified webhook confirms payment. Do not trust browser redirects as proof of payment.

## Security
- Supabase is the sole system of record.
- RLS on every customer-owned table.
- Server-side authorization for privileged actions.
- Secrets server-side only.
- Validate URLs and defend website fetching against SSRF, redirects to private IPs, oversized responses, and unsafe content.
- Rate limit public endpoints.
- Audit approvals, agent execution, connections, billing, and admin actions.
- Use private storage and signed URLs for files.
