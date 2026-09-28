import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { AddWatchlistItemBody, AddWatchlistItemResponse, GetWatchlistRadarResponse, GetWatchlistResponse, RemoveWatchlistItemParams } from "@workspace/api-zod";
import { db, watchlistItemsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { fetchTicker, isValidTicker, getRadarForTickers } from "../lib/market-data";

const router: IRouter = Router();
const MAX_WATCHLIST_ITEMS = 30;
router.use(requireAuth);

router.get("/watchlist", async (req: AuthenticatedRequest, res): Promise<void> => {
  const rows = await db.select().from(watchlistItemsTable).where(eq(watchlistItemsTable.userId, req.userId!));
  res.json(GetWatchlistResponse.parse(rows.map((row) => ({ ticker: row.ticker, createdAt: row.createdAt.toISOString() }))));
});

router.get("/watchlist/radar", async (req: AuthenticatedRequest, res): Promise<void> => {
  const rows = await db.select().from(watchlistItemsTable).where(eq(watchlistItemsTable.userId, req.userId!));
  const radar = await getRadarForTickers(rows.map((row) => row.ticker));
  res.json(GetWatchlistRadarResponse.parse(radar));
});

router.post("/watchlist", async (req: AuthenticatedRequest, res): Promise<void> => {
  const parsed = AddWatchlistItemBody.safeParse(req.body);
  const ticker = parsed.success ? isValidTicker(parsed.data.ticker) : null;
  if (!ticker) {
    res.status(400).json({ error: "Indica un ticker válido de hasta 12 caracteres." });
    return;
  }
  const [existing] = await db.select().from(watchlistItemsTable).where(and(eq(watchlistItemsTable.userId, req.userId!), eq(watchlistItemsTable.ticker, ticker)));
  if (existing) {
    res.json(AddWatchlistItemResponse.parse({ ticker: existing.ticker, createdAt: existing.createdAt.toISOString() }));
    return;
  }
  const userItems = await db.select({ ticker: watchlistItemsTable.ticker }).from(watchlistItemsTable).where(eq(watchlistItemsTable.userId, req.userId!));
  if (userItems.length >= MAX_WATCHLIST_ITEMS) {
    res.status(400).json({ error: `Tu radar personal admite hasta ${MAX_WATCHLIST_ITEMS} activos. Quita uno antes de añadir otro.` });
    return;
  }
  try {
    await fetchTicker(ticker);
  } catch (error) {
    res.status(400).json({ error: `${ticker} no está disponible para el cálculo JB: ${error instanceof Error ? error.message : "histórico no disponible"}.` });
    return;
  }
  const [item] = await db.insert(watchlistItemsTable).values({ id: randomUUID(), userId: req.userId!, ticker }).returning();
  res.status(201).json(AddWatchlistItemResponse.parse({ ticker: item.ticker, createdAt: item.createdAt.toISOString() }));
});

router.delete("/watchlist/:ticker", async (req: AuthenticatedRequest, res): Promise<void> => {
  const parsed = RemoveWatchlistItemParams.safeParse(req.params);
  const ticker = parsed.success ? isValidTicker(parsed.data.ticker) : null;
  if (!ticker) {
    res.status(400).json({ error: "Ticker no válido." });
    return;
  }
  await db.delete(watchlistItemsTable).where(and(eq(watchlistItemsTable.userId, req.userId!), eq(watchlistItemsTable.ticker, ticker)));
  res.sendStatus(204);
});

export default router;