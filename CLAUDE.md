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

## Known gaps after leaving Replit

- Product image uploads: `src/lib/objectStorage.ts` and `src/routes/storage.ts` call the Replit
  sidecar (`127.0.0.1:1106`). Needs rewiring to Vercel Blob.
- WhatsApp alerts: `src/lib/alert-scheduler.ts` uses `@replit/connectors-sdk`, and the 5-minute
  scheduler in `src/index.ts` does not run on serverless. Needs a new provider plus a Vercel Cron.
- XLSX purchase import (`routes/inventory-upload.ts`) resolves `exceljs` by path inside a worker,
  which may fail inside the bundle. Test before relying on it.

## Useful commands

- `pnpm --filter @workspace/api-server run dev`: API locally (needs PORT and DATABASE_URL)
- `pnpm run typecheck`: typecheck everything
- `pnpm --filter @workspace/api-spec run codegen`: regenerate API hooks and Zod schemas from `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push`: push the Drizzle schema (careful: production DB)
- `database/jb-numini-postgresql.dump`: Replit database backup from September 2026
