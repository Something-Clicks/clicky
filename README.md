# Something Clicks

Make the complicated click. A subscription platform that helps small business owners understand their marketing and see it get done: Connect → Analyze → Recommend → Execute → Measure.

Product, brand and UI direction: [`docs/handoff/`](docs/handoff/). The UI reference (`docs/handoff/PRODUCT_UI_REFERENCE.html`) is the design specification. Audit: [`docs/AUDIT.md`](docs/AUDIT.md). Phase reports: [`docs/phases/`](docs/phases/).

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Supabase (Postgres, Auth, RLS) · plain CSS ported from the UI reference · Vitest · pnpm.

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill in values; never commit this file
pnpm dev                     # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Develop, build, serve |
| `pnpm lint` / `pnpm typecheck` | ESLint, TypeScript |
| `pnpm test` | Unit tests |
| `pnpm test:db` | Applies every migration to a throwaway local Postgres and proves tenant isolation (needs Postgres; `PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres`). Refuses non-local hosts. |
| `pnpm icons` | Rebuilds every icon from `public/brand/clicky-source.png` (background removal and resizing only) |

## Brand

The approved Joyful Aha emoji (`public/brand/clicky-source.png`) is the visual identity; Clicky is its nickname. It is never redrawn. Warm yellow `#FFC928` is the character color; cobalt `#3977D5` is the interface color.

## Security model

- Every request runs as the signed-in user, so Row Level Security always applies. There is no service-role key in the web app for customer requests.
- Every table has RLS on; API roles start with no privileges and get back only what their policies need.
- Organization creation, admin access and audit logging go through `SECURITY DEFINER` functions that check the caller and write `activity_log`.
- `.env*` files are git-ignored; CI runs a secret scan.
