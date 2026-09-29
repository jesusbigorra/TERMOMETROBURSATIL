# JB Monorepo: Inventario y Caja + Termómetro Bursátil

Monorepo pnpm with two web apps that share one Express backend and one Postgres database.
Migrated from Replit to Vercel in September 2026. The owner is Jesús Bigorra; talk to him in Spanish.

## Apps and live URLs

| App | Folder | Vercel project | URL |
|---|---|---|---|
| Inventario y Caja (NUMINI SHOP) | `artifacts/inventario-caja` | `inventario-caja` | https://inventario-caja-nu.vercel.app |
| JB Termómetro Bursátil | `artifacts/jb-termometro-bursatil-live` | `jb-termometro-bursatil` | https://jb-termometro-bursatil.vercel.app |
| Shared API (Express 5) | `artifacts/api-server` | `jb-api-server` | https://jb-api-server.vercel.app |

Vercel team: `ruta-venezuela` (`team_DTda3gCn8Yb2MFIESXtii341`).

## Workflow

- `main` is the source of truth. Push to `main` and redeploy the affected Vercel project(s).
- `legacy-python` keeps the old Python/Streamlit version of the termómetro. Do not merge it back.
- All three Vercel projects build from this same repo, each with its own Root Directory.

## How deploys work

**Install (all projects):** `cd ../.. && npx -y pnpm@10.18.3 install --no-frozen-lockfile --prod=false`
- pnpm 10 because the lockfile came from Replit.
- `--no-frozen-lockfile` because the workspace `overrides` are not recorded in `pnpm-lock.yaml`.
- `--prod=false` because Vercel sets NODE_ENV=production and would skip esbuild and vite.

**API:** `node ./build-vercel.mjs` bundles `src/vercel-entry.ts` with esbuild into a
Build Output API function (`.vercel/output/functions/api.func`). Every request routes to it.
Workspace packages (`@workspace/db`, `@workspace/api-zod`) export raw TypeScript, which is
why the API is bundled instead of using Vercel's per-file compilation.

**Frontends:** `PORT=3000 BASE_PATH=/ NODE_ENV=production npx -y pnpm@10.18.3 run build`, output
`dist/public`. `vite.config.ts` requires PORT and BASE_PATH. Each frontend's `vercel.json`
rewrites `/api/*` to the API domain and everything else to `index.html`.

## Environment variables

- API (`jb-api-server`): `DATABASE_URL` (Neon, via the Vercel integration), `CLERK_SECRET_KEY`,
  `CLERK_PUBLISHABLE_KEY`, `NODE_ENV=production`, Vercel Blob store (`BLOB_STORE_ID`).
- Frontends: `VITE_CLERK_PUBLISHABLE_KEY`.
- Clerk still uses test keys (`pk_test_...`).
- `INVENTORY_ALLOWED_EMAILS` (API): comma-separated emails allowed to use the inventory and cash
  register. Enforced by `middlewares/requireInventoryUser.ts` on `/inventory`, `/sales` and
  `/storage/uploads`. The termómetro stays open to any signed-in user (email or Google).

## Data notes

- The 3 sales of 2026-09-08 (V-93817440, V-94567025, V-94643806) were missing from the Replit
  backup and were imported by hand on 2026-09-29. Payment method recorded as "Sin especificar".

## Termómetro: per-asset analysis (Sept 2026)

- `GET /api/market/analysis/:ticker` (`lib/asset-analysis.ts`): 5y daily history with adjusted
  close, period returns (1M…5A) with CAGR vs SPY, risk windows (volatility, max drawdown, beta,
  Sharpe with ^IRX as risk-free), dividends. CDN-cached 15 min.
- Stock fundamentals come from SEC EDGAR company facts (`lib/sec-fundamentals.ts`), TTM = last
  fiscal year + current YTD − prior YTD. Yahoo quoteSummary needs a cookie+crumb that Yahoo blocks
  from Vercel IPs (429); `lib/yahoo-session.ts` backs off 30 min after a failure.
- ETF expense ratio / holdings: no free server-side source yet; the Value tab links to Yahoo.
- Frontend: `components/asset-insights.tsx` (period selector, returns table, DCA / Riesgo / Valor
  tabs, DCA simulator with XIRR vs lump sum).

## Telegram alerts (Sept 2026)

- Bot: @Termobursatilbot. Env (API): `TELEGRAM_BOT_TOKEN` (sensitive), `TELEGRAM_BOT_USERNAME`.
  The webhook secret is derived from the token (`lib/telegram.ts`), so rotating the token only
  needs the env var updated plus a redeploy; the webhook re-registers itself on the next call.
- Tables `telegram_links` and `app_state` are created at runtime (`TELEGRAM_DDL`), no drizzle push needed.
- Routes (`routes/telegram.ts`, mounted before watchlist/alerts): `/telegram/status|link|settings|test`
  (signed in), `/telegram/webhook` (Telegram only), `/cron/alerts` (public, throttled to 1 run per 4 min,
  only weekdays 13:15-21:30 UTC unless `?anytime=1`).
- Scheduler: `.github/workflows/telegram-alerts.yml` calls `/api/cron/alerts` every 15 min.
  GitHub pauses scheduled workflows after 60 days without repo activity.
- Alert logic (`lib/alert-scheduler.ts`): compares each watchlist item's `last_signal` with the current
  JB signal; linking resets `last_signal` so old changes are not sent. WhatsApp was removed.

## Known gaps after leaving Replit

- Product image uploads: `src/lib/objectStorage.ts` and `src/routes/storage.ts` call the Replit
  sidecar (`127.0.0.1:1106`). Needs rewiring to Vercel Blob.
- XLSX purchase import (`routes/inventory-upload.ts`) resolves `exceljs` by path inside a worker,
  which may fail inside the bundle. Test before relying on it.

## Useful commands

- `pnpm --filter @workspace/api-server run dev`: API locally (needs PORT and DATABASE_URL)
- `pnpm run typecheck`: typecheck everything
- `pnpm --filter @workspace/api-spec run codegen`: regenerate API hooks and Zod schemas from `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push`: push the Drizzle schema (careful: production DB)
- `database/jb-numini-postgresql.dump`: Replit database backup from September 2026
