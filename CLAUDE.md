# JB Monorepo: Inventario y Caja + Termómetro Bursátil

Monorepo pnpm with two web apps that share one Express backend and one Postgres database.
Migrated from Replit to Vercel in September 2026. The owner is Jesús Bigorra; talk to him in Spanish.

## Apps and live URLs

| App | Folder | Vercel project | URL |
|---|---|---|---|
| Inventario y Caja (NUMINI SHOP) | `artifacts/inventario-caja` | `inventario-caja` | https://inventario-caja-nu.vercel.app |
| JB Termómetro Bursátil | `artifacts/jb-termometro-bursatil-live` | `jb-termometro-bursatil` | https://termobursatil.com |
| Shared API (Express 5) | `artifacts/api-server` | `jb-api-server` | https://api.termobursatil.com |

Domain `termobursatil.com` (termómetro only; the cash register is a separate project and must not use it) bought by Jesús in Vercel (Sept 2026, auto-renew on). `www` redirects to
the apex. The old `*.vercel.app` URLs still work; frontends proxy `/api` to `jb-api-server.vercel.app`
and the Telegram webhook stays on that host. `TERMOMETRO_APP_URL` (API env) sets the bot's links.

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
  weekdays 9:15-16:45 New York unless `?anytime=1`).
- Scheduler: `.github/workflows/telegram-alerts.yml` calls `/api/cron/alerts` every 15 min.
  GitHub pauses scheduled workflows after 60 days without repo activity.
- Alert logic (`lib/alert-scheduler.ts`), anti-noise rules agreed with Jesús:
  instant message only when an asset ENTERS "Interesante"; a new signal must hold on 2 consecutive
  checks; hysteresis (leave Interesante only if RSI > 42 or < 28, leave Descartado only if RSI < 62);
  max 1 instant per asset per day and 3 per user per day; every other confirmed change goes to one
  digest after 16:15 New York. `watchlist_items.last_signal` is the confirmed signal,
  `pending_signal/pending_count` track confirmation. Prefs: `opportunity_alerts` = instant,
  `signal_changes` = daily digest. Bot commands: /radar /resumen /prueba /silenciar /activar /desconectar.
  Linking resets `last_signal` so old changes are not sent. WhatsApp was removed.

## Admin panel and analytics (Sept 2026)

- `termobursatil.com/admin` (`components/admin-page.tsx`) calls `GET /api/admin/overview` (`routes/admin.ts`).
  Access: verified Clerk email in `ADMIN_EMAILS` (API env, default `jesus201@gmail.com`); the frontend
  only hides the link. Data: Clerk user list (up to 500 newest) crossed with watchlist, Telegram links,
  top tickers and alert counts from Neon. CSV export in the browser.
- Vercel Web Analytics script is in `index.html`; it only records once Analytics is enabled in the
  project dashboard.

## Evidence (Sept 2026) — read before changing claims

- Long backtest (8 assets: SPY, QQQ, DIA, IWM, EFA, KO, JNJ, MSFT; daily data from `/api/market/history/:ticker`,
  213 rolling 10-year windows, $200/month, dividends reinvested, idle cash 3%): buying in JB discount zones
  (Interesante or Nivel ≥ 60) gives practically the same result as plain monthly DCA (median diff ≈ 0,
  wins 43–56% of windows). 12-month returns after Interesante ≈ any day. The 5-year VOO edge was period-specific.
- Product rule agreed with Jesús: the app never claims the signal beats DCA or the market. Its value is buying
  with a discount and calm. Page `/metodologia` (`components/methodology-page.tsx`) holds the numbers; update it
  if the backtest is rerun.
- DCA simulator (`asset-insights.tsx`): buys on the first zone day of each month, else last trading day; shows
  zone purchases and the day-1 DCA baseline; the lump-sum comparison was removed on purpose. 1 and 3 years only
  (zones need one year of warm-up inside the 5-year history).

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
