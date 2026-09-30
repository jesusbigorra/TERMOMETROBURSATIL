import { Router, type IRouter } from "express";
import {
  GetMarketActivityResponse,
  GetEmergingMarketIdeasResponse,
  GetMarketRadarResponse,
  SearchMarketInstrumentsResponse,
} from "@workspace/api-zod";
import { getMarketRadar } from "../lib/market-data";
import { searchMarketInstruments } from "../lib/market-data";
import { getEmergingMarketIdeas } from "../lib/emerging-market-ideas";
import { getAssetAnalysis, getLongHistory } from "../lib/asset-analysis";
import { isValidTicker } from "../lib/market-data";

const router: IRouter = Router();

router.get("/market/radar", async (req, res): Promise<void> => {
  try {
    const payload = await getMarketRadar();
    const data = GetMarketRadarResponse.parse(payload);
    req.log.info({ count: data.assets.length, cached: data.cached, errors: data.errors.length }, "Live market radar served");
    res.json(data);
  } catch (error) {
    req.log.error({ err: error }, "Unable to fetch market radar");
    res.status(503).json({ error: "No pudimos obtener datos de mercado en este momento." });
  }
});

router.get("/market/emerging-ideas", async (req, res): Promise<void> => {
  const refresh = req.query.refresh === "true";
  try {
    const payload = await getEmergingMarketIdeas(refresh);
    const data = GetEmergingMarketIdeasResponse.parse(payload);
    req.log.info({ count: data.ideas.length, cached: data.cached, stale: data.stale, errors: data.errors.length }, "Emerging-market ETF ideas served");
    res.json(data);
  } catch (error) {
    req.log.error({ err: error }, "Unable to fetch emerging-market ETF ideas");
    res.status(503).json({ error: "No pudimos obtener ideas de ETF emergentes en este momento." });
  }
});

router.get("/market/search", async (req, res): Promise<void> => {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  if (query.trim().length < 2) {
    res.json([]);
    return;
  }
  if (query.length > 40) {
    res.status(400).json({ error: "La búsqueda admite hasta 40 caracteres." });
    return;
  }
  try {
    res.json(SearchMarketInstrumentsResponse.parse(await searchMarketInstruments(query)));
  } catch (error) {
    req.log.warn({ err: error }, "Market instrument search unavailable");
    res.status(503).json({ error: "No pudimos buscar instrumentos ahora. Inténtalo de nuevo." });
  }
});

router.get("/market/analysis/:ticker", async (req, res): Promise<void> => {
  const ticker = isValidTicker(String(req.params.ticker ?? ""));
  if (!ticker) {
    res.status(400).json({ error: "Ticker no válido." });
    return;
  }
  try {
    const analysis = await getAssetAnalysis(ticker);
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    res.json(analysis);
  } catch (error) {
    req.log.warn({ err: error, ticker }, "Asset analysis unavailable");
    res.status(503).json({ error: "No pudimos analizar este activo ahora. Inténtalo de nuevo." });
  }
});

router.get("/market/history/:ticker", async (req, res): Promise<void> => {
  const ticker = isValidTicker(String(req.params.ticker ?? ""));
  if (!ticker) {
    res.status(400).json({ error: "Ticker no válido." });
    return;
  }
  try {
    const history = await getLongHistory(ticker);
    res.setHeader("Cache-Control", "public, s-maxage=43200, stale-while-revalidate=86400");
    res.json(history);
  } catch (error) {
    req.log.warn({ err: error, ticker }, "Long history unavailable");
    res.status(503).json({ error: "No pudimos traer la historia de este activo." });
  }
});

router.get("/market/activity", (_req, res) => {
  const data = GetMarketActivityResponse.parse([
    { id: "live-1", ticker: "JB", title: "Radar conectado a Yahoo Finance", detail: "Las señales usan RSI Wilder y SMA 20/50/100/200.", kind: "info", time: new Date().toISOString() },
  ]);
  res.json(data);
});

export default router;