# Design conformance: approved reference vs the running app (Nov 26 2026)

**Approved design source in this repository:** `docs/handoff/PRODUCT_UI_REFERENCE.html` (all 15 reference screens) with `DESIGN_SYSTEM.md` and `CLICKY_BRAND.md`. No other design file, mockup or published design exists in the repository or in this account. The app already carried the owner's "launch redesign" of that reference (mobile first, cream surface, 3D Clicky on the homepage, Click Blue rules in `CLAUDE.md`). This pass checked every screen against the reference and closed the gaps listed below.

Screenshots of the running app (local stack, 1280px and 390px): `desktop/`, `mobile/`. Reference beside the app: `compare/`.

## Visual redesign work (this pass)
| Screen | Gap against the reference | Change |
|---|---|---|
| Every signed-in page | No small uppercase blue eyebrow above the heading | Eyebrow added (Your workspace, Your priorities, Marketing analysis, A clear record, Plan and payments, Your account, ...) and restyled to the reference (12px, 800 weight, wide tracking, uppercase) |
| Home (dashboard) | Reference opens with three at-a-glance tiles | Three tiles: recommendations to review, waiting for your approval, last website check (real counts) |
| Compare (new screen) | Plain table, default look | Reference table style: quiet uppercase column heads, readable row heads, Yes/No in text and weight, not color alone |
| Campaigns (new screen) | Titles were underlined text links | Reference card rows: yellow left rule while waiting, mint once approved, title, line, status chip, progress |
| History | New events showed raw names ("campaign proposed") | Plain-language labels |
| Campaign pages | "1 tasks done" | Singular and plural |

## Kept on purpose (not changed to match the reference)
- **Warm cream surface and 3D/flat Clicky:** the launch redesign and `CLAUDE.md` brand rules. The reference's cool grey `#f7f9fc` page is a one-line token (`--cream`) if the owner prefers it.
- **Button blue `#2A5DAE` with pill shape:** `CLAUDE.md` allows white text only on `#2A5DAE`; the reference's `#3977D5` button with white text does not meet contrast (WCAG 2.2 AA).
- **Homepage headline and public page copy:** owner copy (`src/config/site.ts`), not the reference's sample text. The reference's "Product experience / page" breadcrumb and developer sidebar are reference tooling, not product UI.
- **Sample content and "AI" wording in the reference:** not used (no AI claims until the Privacy Policy says so).

## Functional and accessibility changes (not visual redesign)
Compare and Campaigns reachable from Home and the sidebar; evidence shown on each fix task; "Ready to do" label instead of a second "To do"; one website per line parsing; Clarity via the official package after consent (separate commit). Accessibility: tables keep real header cells, status never relies on color alone, 44px touch targets checked by `e2e/specs/08-mobile.spec.ts`. The axe suite (`tests/e2e/public.spec.ts`) was not re-run on the new screens in this pass.
