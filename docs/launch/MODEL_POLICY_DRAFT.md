# Privacy Policy and Terms: proposed wording (DRAFT for the owner and the attorney)

Nothing here has been applied. The live pages (`src/app/(public)/privacy/page.tsx`, `.../terms/page.tsx`) are unchanged. This is wording to approve,
edit or reject. It is not legal advice, and an attorney should review it before it goes live. Written Nov 28 2026.

## A. Needed even for the model-free release (new screens in Production, no model)
The live pages are drafts: they still contain `[privacy contact email]`, `[mailing address]`, `[decide a retention period]` for feedback and
usage counts, `[Confirm.]` for hosting logs, and an `[Attorney: …]` note. Fill these before launch.

The model-free release also adds things the current text does not name. Suggested additions to **What we collect** / **How we check a website**:

> **Business details you review.** We save details we read from your website (for example your phone number, services and area), who they came
> from and when. They stay "to check" until you confirm or correct them. You can change or remove any of them.
>
> **Websites you ask us to compare.** If you name other websites, our servers read their public homepage the same way we read yours and keep what
> they visibly show (for example whether a phone number is shown) so you can compare. We only read pages that are publicly available.
>
> **Figures and keywords you add.** If you add results (such as calls or visits) or a keyword list, we store them with the period and source you give.
> We never make these up or fill them in for you.
>
> **Plans, campaigns and approvals.** We keep the plans and task lists we prepare for you, your edits, who approved what and when, and a record of
> work you mark done. Nothing is published or sent for you.

## B. Replacing the "How recommendations are produced" section (only when the model is switched on)
Current text says: *"We do not currently use an artificial-intelligence service to analyze your website or to write for you, and we do not send
your website content to one."* That sentence becomes false the moment a model runs. Proposed replacement:

> **How recommendations and drafts are produced.** Some recommendations come from fixed checks. Some of our analysis and writing is done by an
> artificial-intelligence service. When that happens we send it the text we read from your website pages, the business details you have confirmed or
> we have suggested, your notes, and (if you added them) the names of competitor websites and your keyword list. We do **not** send your password,
> payment details or anything from other customers. The service we use is **Groq** (Groq, Inc.). [Attorney: confirm the exact entity, location and
> whether Groq keeps or trains on what we send. See section D.]
>
> The service's answers are suggestions. We check them before we show them (for example, we drop statements that quote text not on your page, invent
> figures, or promise results), but they can still be wrong or generic. Read every draft before you use it. You decide what happens next; we never
> change your website or send anything on your behalf.

**Service providers table: add a row**

> | Groq | Reads the text described above to prepare analysis and drafts. [Retention and training terms: confirm.] |

**If competitor discovery is switched on (it is off in Production today), add:**

> | OpenStreetMap, DuckDuckGo | When you ask us to find similar businesses we send only your service area and a short description of what you do. We never send your business name, email or any customer information. |

**Retention (suggested, decide the periods):** model inputs are not stored by us beyond the draft or analysis they produced; the record of each model
call keeps only counts of tokens used (no website text). [Decide whether to keep the written outputs as long as the account lives.]

## C. Terms of Service additions
Section 6 now reads: *"Recommendations come from fixed checks of the public pages we read. They are suggestions, not professional advice…"* Proposed:

> Recommendations come from fixed checks of the public pages we read and, where we say so, from an artificial-intelligence service. They are
> suggestions, not professional advice, and can be incomplete, generic or wrong. Drafts we prepare are starting points: **you** are responsible
> for reviewing, editing and deciding whether to use them, and for any change you make to your website or any message you send. You confirm you
> own or are authorized to manage any website you ask us to check, and you will only name other websites that are publicly available.

Keep section 7 (no guarantees) as is. Consider adding: *"We may limit how much of the service you can use in a day, and some features may be
temporarily unavailable."* (the free allowance can run out; the app already says when work can continue).

## D. Open questions for the owner before real customer data reaches a model
1. **Groq's free-tier data terms: not verified.** Does Groq retain prompts, for how long, and does it train on them? Is a data-processing agreement
   available on the free tier? If it trains on free-tier inputs, customer site text should not go there.
2. **Entity and location** of the provider for the "service providers" table.
3. **Limits:** the free tier is about 200,000 tokens a day, with 60,000 a day per business, so a handful of businesses a day. Beyond that people see
   "can continue around HH:MM UTC".
4. **Site copy:** the repo rule is no "AI" in public metadata or marketing copy until AI features are live and the Privacy Policy says so. Turning the
   model on is the moment to update `src/config/seo.ts` and the homepage wording as well.
5. **Staging:** turn the model on for a few testers first (a code change in `provider.ts`/`features.ts` to allow a model in Production behind a
   switch), then everyone. The model is refused in Production today, whatever the variables say.
