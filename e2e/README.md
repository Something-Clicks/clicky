# End-to-end suite

Browser tests for the customer journeys, run against the app on **this machine** with a local sign-in and API stack and a
throwaway database. They never use real customer accounts, clicky-dev, Production or Stripe. No model is used.

| Command | What it does |
|---|---|
| `pnpm test:e2e:local` | Everything in one go: starts the local stack, builds, starts two servers, runs the suite |
| `pnpm test:e2e` | Runs the suite against servers you already started (see `e2e/run-local.sh` for the exact environment) |
| `pnpm test:e2e:ui` | Same, in Playwright's UI mode |
| `pnpm test:e2e:report` | Opens the last HTML report |
| `pnpm e2e` | The older public-site tests in `tests/e2e` (no database needed) |

Layout: `e2e/setup` (creates the throwaway owner and runs the first website check), `e2e/fixtures` (sign-up and login helpers, the
local-database guard), `e2e/specs` (01 homepage, 02 signup and login, 03 website analysis, 04 recommendations, 05 action board,
06 compare, 07 campaigns and owner approval, 08 mobile, 09 analytics consent). Specs run in order and share the owner account.

Browsers: Chromium (desktop and iPhone-sized) always. Firefox and WebKit are added with `PW_FIREFOX=1` / `PW_WEBKIT=1` once
`pnpm exec playwright install firefox webkit` has worked (it needs network access to Playwright's download host).

The tests read real public websites (`E2E_SITE`, default nodejs.org, as the business; `E2E_COMPARE`, default pypi.org and
huggingface.co). They are not small businesses, so this proves the screens and plumbing on real pages, not marketing quality.
