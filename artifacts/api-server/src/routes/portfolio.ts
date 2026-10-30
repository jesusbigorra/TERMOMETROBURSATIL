import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, pool, PORTFOLIO_DDL, portfolioPositionsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { fetchTicker, getRadarForTickers, isValidTicker } from "../lib/market-data";
import { fetchQuote } from "../lib/market-pulse";

// Portafolio personal: el usuario declara sus posiciones. No toca el radar,
// la watchlist ni las alertas. requireAuth va por ruta (no con router.use)
// para no exigir sesión a los routers que se montan después.
const router: IRouter = Router();
const MAX_POSITIONS = 40;

let schemaReady: Promise<void> | null = null;
function ensurePortfolioSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool.query(PORTFOLIO_DDL).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

// Validación manual: este paquete no declara zod como dependencia propia.
function parsePositionBody(body: unknown): { units: number; avgCost: number | null } | null {
  if (!body || typeof body !== "object") return null;
  const { units, avgCost } = body as { units?: unknown; avgCost?: unknown };
  if (typeof units !== "number" || !Number.isFinite(units) || units <= 0 || units > 1e9) return null;
  if (avgCost === null || avgCost === undefined) return { units, avgCost: null };
  if (typeof avgCost !== "number" || !Number.isFinite(avgCost) || avgCost < 0 || avgCost > 1e9) return null;
  return { units, avgCost };
}

router.get("/portfolio", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    await ensurePortfolioSchema();
    const rows = await db.select().from(portfolioPositionsTable).where(eq(portfolioPositionsTable.userId, req.userId!));
    if (!rows.length) {
      res.json({ positions: [], errors: [] });
      return;
    }
    // Precio, nombre, tipo y zona JB salen de la lectura que ya existe del radar.
    const radar = await getRadarForTickers(rows.map((row) => row.ticker)).catch(() => null);
    const byTicker = new Map((radar?.assets ?? []).map((asset) => [asset.ticker, asset]));
    // El cambio diario del radar se mide contra el cierre de hace un año (rango 1y de Yahoo),
    // así que aquí el precio y el cambio de hoy salen de la cotización de 5 días, que compara
    // con el cierre de la sesión anterior.
    const quotes = new Map((await Promise.all(rows.map((row) => fetchQuote(row.ticker)))).flatMap((quote) => (quote ? [[quote.ticker, quote] as const] : [])));
    const positions = rows
      .map((row) => {
        const asset = byTicker.get(row.ticker);
        const quote = quotes.get(row.ticker);
        return {
          ticker: row.ticker,
          units: row.units,
          avgCost: row.avgCost,
          name: asset?.name ?? row.ticker,
          type: asset?.type ?? null,
          price: quote?.price ?? asset?.price ?? null,
          change: quote?.change ?? null,
          signal: asset && asset.level !== null ? asset.signal : null,
          level: asset?.level ?? null,
        };
      })
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
    res.json({ positions, errors: radar?.errors ?? [] });
  } catch (error) {
    req.log.warn({ err: error }, "Portfolio unavailable");
    res.status(503).json({ error: "No pudimos leer tu portafolio ahora. Inténtalo de nuevo." });
  }
});

router.put("/portfolio/:ticker", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const ticker = isValidTicker(String(req.params.ticker ?? ""));
  const body = parsePositionBody(req.body);
  if (!ticker || !body) {
    res.status(400).json({ error: "Indica un ticker válido y una cantidad de unidades mayor que cero." });
    return;
  }
  try {
    await ensurePortfolioSchema();
    const existing = await db.select().from(portfolioPositionsTable).where(eq(portfolioPositionsTable.userId, req.userId!));
    const current = existing.find((row) => row.ticker === ticker);
    if (!current) {
      if (existing.length >= MAX_POSITIONS) {
        res.status(400).json({ error: `Tu portafolio admite hasta ${MAX_POSITIONS} posiciones. Quita una antes de añadir otra.` });
        return;
      }
      try {
        await fetchTicker(ticker);
      } catch (error) {
        res.status(400).json({ error: `${ticker} no está disponible: ${error instanceof Error ? error.message : "histórico no disponible"}.` });
        return;
      }
    }
    const { units, avgCost } = body;
    if (current) {
      await db
        .update(portfolioPositionsTable)
        .set({ units, avgCost })
        .where(and(eq(portfolioPositionsTable.userId, req.userId!), eq(portfolioPositionsTable.ticker, ticker)));
    } else {
      await db.insert(portfolioPositionsTable).values({ id: randomUUID(), userId: req.userId!, ticker, units, avgCost });
    }
    res.status(current ? 200 : 201).json({ ticker, units, avgCost });
  } catch (error) {
    req.log.warn({ err: error, ticker }, "Portfolio save failed");
    res.status(503).json({ error: "No pudimos guardar la posición. Inténtalo de nuevo." });
  }
});

router.delete("/portfolio/:ticker", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const ticker = isValidTicker(String(req.params.ticker ?? ""));
  if (!ticker) {
    res.status(400).json({ error: "Ticker no válido." });
    return;
  }
  try {
    await ensurePortfolioSchema();
    await db.delete(portfolioPositionsTable).where(and(eq(portfolioPositionsTable.userId, req.userId!), eq(portfolioPositionsTable.ticker, ticker)));
    res.sendStatus(204);
  } catch (error) {
    req.log.warn({ err: error, ticker }, "Portfolio delete failed");
    res.status(503).json({ error: "No pudimos quitar la posición. Inténtalo de nuevo." });
  }
});

export default router;
