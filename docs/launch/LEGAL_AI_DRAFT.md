# Privacy Policy and Terms: AI wording for attorney review

**Status: DRAFT text for an attorney. Not published.** The live Privacy Policy (`src/app/(public)/privacy/page.tsx`) currently says, truthfully, that Something Clicks does not use an AI service and sends no website content to one. That stays accurate while the Marketing Agent's model features are off (they are always off in Production). **The moment any model feature is released to customers, this text (as approved by the attorney) must replace those sections in the same release.** Launch rule: no AI claim on any public page and no model call in Production until then.

Facts the attorney needs (all verified in the code; nothing here is aspirational):
- **What is sent to the provider.** Text of the business's public web pages (title, description, headings, up to about 6,000 characters of homepage text and 3,000 of each other page, up to 5 pages), the business name and service area the owner entered, business details the owner confirmed or the agent proposed, the text of an open recommendation and its quoted evidence, and notes the owner types to revise a plan or draft. **Not sent:** email addresses, passwords, payment data, other businesses' data, Stripe ids.
- **SUPERSEDED (Nov 25 2026): this draft described Anthropic, which is no longer used and will not be.** No language model runs today. If Something Clicks later runs an open-weight model on infrastructure it controls (`docs/agents/OWN_MODEL_PLAN.md`), the wording below must be rewritten: there is then no third-party AI provider, but the GPU hosting company is a processor and must be named, and any use of customer content to improve a model needs its own consent terms. Attorney review required. Until then the live Privacy Policy ("no AI service") stays true. The rules-based plan is fixed software, not an AI service.
- **What the model produces.** Proposed business details, website findings with quotes, draft website text (page titles, descriptions, homepage copy) and a proposed marketing plan. All of it is checked by Something Clicks before it is stored (quotes must appear on the page, figures must come from the material, promises are removed). **Nothing is published or sent anywhere on the customer's behalf.** The owner reviews, edits, approves or rejects every draft and plan.
- **Records kept.** Each model call is logged for cost control: business, capability, model name, token counts, cost, outcome and the person who started it. The text sent to and returned by the model is not stored as a log; the useful results (details, findings, plans, drafts) are stored in the customer's account like any other result.
- **Spend limits and fairness.** Per-business and per-person daily and monthly limits apply; customers see a plain "usage limit reached" message.
- **Deletion.** Results are deleted with the business account. [Attorney/owner: confirm the provider's retention of API inputs and whether a deletion request must be passed on.]

## Proposed replacement: "How recommendations are produced"
> Recommendations start with fixed checks we run on the pages we read (for example: is there a page title, a description, a tap-to-call phone link, a mobile setting). We also use an artificial-intelligence service, [Anthropic], to help us understand your business from your public website and the details you give us, to suggest improvements, to write drafts (such as page titles, descriptions and website text) and to propose a marketing plan. To do this we send it text from your website's public pages, your business name and service area, the details about your business that are saved in your account, and any notes you type to ask for changes. We do not send it your password, payment details or email address. [Under our agreement with the provider, it does not use this information to train its models. — Attorney/owner: confirm against the provider's terms before keeping this sentence.]
> Everything the service suggests is a suggestion for you to review. We check it against your website before we show it to you, but it can still be wrong or incomplete. Nothing is published, posted or sent for you; you decide what to use. We never change your website.

## Proposed row for "Service providers"
> **[Anthropic]** — Reads text from your website's public pages and the business details in your account to suggest improvements, write drafts and propose a marketing plan. Receives no passwords, payment details or email addresses.

## Proposed additions to the Terms
- **AI-assisted suggestions.** Recommendations, drafts and plans are generated with the help of automated systems and are provided for your review; they may be inaccurate or incomplete and are not professional, legal or financial advice. You are responsible for what you decide to use or publish, including checking claims against your business's facts and applicable advertising law.
- **No guarantees of results.** We do not promise rankings, traffic, leads, sales or any other outcome from following a suggestion.
- **Your content and our checks.** You confirm you own or are authorized to manage each website you ask us to check. We read only public pages.
- **Usage limits.** We may limit how much you can use model-assisted features per day and per month to keep the service available and affordable.
- **Third-party provider.** Parts of the service depend on a third-party AI provider; availability and behaviour can change, and we may replace the provider (we will update our Privacy Policy first).

## Open questions for the attorney
1. Is naming the provider in the policy required or advisable? (Plan: name it; update when it changes.)
2. Do the website owners we read pages from need any notice or opt-out, given we only read public pages for the business that asked us to? (Robots.txt handling: see `docs/AUDIT.md` if the owner wants it applied.)
3. Retention and deletion wording; whether a data-processing addendum with the provider is needed for customers in the EU/UK/California.
4. Whether the "AI" word may appear in marketing copy (the owner's rule today: not until the features are live and the policy says so; `src/config/seo.ts`).
