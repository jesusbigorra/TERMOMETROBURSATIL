import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger";

export type RadarAsset = {
  ticker: string;
  name: string;
  type: string;
  price: number;
  quoteUpdatedAt: string | null;
  change: number | null;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  pointsSma: number | null;
  pointsRsi: number | null;
  level: number | null;
  signal: string;
  position: string;
  trend: string;
  historyDays: number;
  sparkline: number[];
  history: HistoricalPoint[];
};

export type HistoricalPoint = {
  date: string;
  close: number;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
};

type RadarPayload = {
  marketStatus: string;
  updatedAt: string;
  source: string;
  cached: boolean;
  stale: boolean;
  errors: string[];
  assets: RadarAsset[];
  summary: { total: number; opportunities: number; watch: number; avoid: number };
};

const DEFAULT_TICKERS = ["SPYM", "QQQM", "SCHD", "VXUS", "SCHG", "JEPQ", "MSFT", "NVDA", "KO", "WMT"];
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PERSONAL_RADAR_CACHE_ENTRIES = 100;
const RADAR_CACHE_PATH_ENV = "MARKET_RADAR_CACHE_PATH";
const DEFAULT_RADAR_CACHE_PATH = path.join(process.cwd(), ".cache", "public-market-radar.json");
const DCA_RSI_MIN = 30;
const DCA_RSI_MAX = 40;
let radarCache: { expiresAt: number; payload: RadarPayload } | null = null;
const personalRadarCache = new Map<string, { expiresAt: number; payload: RadarPayload }>();

type PersistedRadar = {
  version: 1;
  savedAt: string;
  payload: RadarPayload;
};

type StoredRadarPayload = Omit<RadarPayload, "stale"> & { stale?: boolean };

function getRadarCachePath() {
  return process.env[RADAR_CACHE_PATH_ENV] || DEFAULT_RADAR_CACHE_PATH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStoredRadarPayload(value: unknown): value is StoredRadarPayload {
  if (!isRecord(value)) return false;
  return typeof value.marketStatus === "string"
    && typeof value.updatedAt === "string"
    && typeof value.source === "string"
    && typeof value.cached === "boolean"
    && (value.stale === undefined || typeof value.stale === "boolean")
    && Array.isArray(value.errors)
    && value.errors.every((error) => typeof error === "string")
    && Array.isArray(value.assets)
    && isRecord(value.summary)
    && typeof value.summary.total === "number"
    && typeof value.summary.opportunities === "number"
    && typeof value.summary.watch === "number"
    && typeof value.summary.avoid === "number";
}

function normalizeStoredRadar(value: unknown): RadarPayload | null {
  if (!isStoredRadarPayload(value)) return null;
  return { ...value, stale: value.stale ?? false };
}

async function readPersistedRadar(): Promise<RadarPayload | null> {
  const cachePath = getRadarCachePath();
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const payload = isRecord(parsed) && parsed.version === 1 && typeof parsed.savedAt === "string"
      ? normalizeStoredRadar(parsed.payload)
      : normalizeStoredRadar(parsed);
    if (!payload) {
      logger.warn({ cachePath }, "Ignoring invalid persisted market radar cache");
      return null;
    }
    return payload;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    logger.warn({ err: error, cachePath }, "Unable to read persisted market radar cache");
    return null;
  }
}

async function persistRadar(payload: RadarPayload): Promise<void> {
  const cachePath = getRadarCachePath();
  const directory = path.dirname(cachePath);
  const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const persisted: PersistedRadar = { version: 1, savedAt: new Date().toISOString(), payload: { ...payload, cached: false, stale: false } };
    await writeFile(temporaryPath, JSON.stringify(persisted), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, cachePath);
  } catch (error) {
    logger.warn({ err: error, cachePath }, "Unable to persist market radar cache");
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (!(isRecord(cleanupError) && cleanupError.code === "ENOENT")) {
        logger.warn({ err: cleanupError, cachePath: temporaryPath }, "Unable to clean temporary market radar cache");
      }
    }
  }
}

function staleRadarPayload(payload: RadarPayload, errors: string[]): RadarPayload {
  return {
    ...payload,
    marketStatus: "Mercado · última lectura disponible",
    cached: true,
    stale: true,
    errors: [`Yahoo Finance no está disponible temporalmente: ${errors.join(" · ")}`],
  };
}

export function resetMarketRadarMemoryCache(): void {
  radarCache = null;
  personalRadarCache.clear();
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function computeRsi(closes: number[]): number {
  const deltas = closes.slice(1).map((value, index) => value - closes[index]);
  let gain = 0;
  let loss = 0;
  for (const delta of deltas) {
    gain = gain * (13 / 14) + Math.max(delta, 0) / 14;
    loss = loss * (13 / 14) + Math.max(-delta, 0) / 14;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function getPersonalCachedRadar(cacheKey: string) {
  const cached = personalRadarCache.get(cacheKey);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) personalRadarCache.delete(cacheKey);
    return null;
  }
  personalRadarCache.delete(cacheKey);
  personalRadarCache.set(cacheKey, cached);
  return cached;
}

function cachePersonalRadar(cacheKey: string, payload: RadarPayload) {
  const now = Date.now();
  for (const [key, item] of personalRadarCache) {
    if (item.expiresAt <= now) personalRadarCache.delete(key);
  }
  personalRadarCache.delete(cacheKey);
  personalRadarCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, payload });
  while (personalRadarCache.size > MAX_PERSONAL_RADAR_CACHE_ENTRIES) {
    const oldestKey = personalRadarCache.keys().next().value;
    if (!oldestKey) break;
    personalRadarCache.delete(oldestKey);
  }
}

function normalizeTicker(value: string): string | null {
  const ticker = value.trim().toUpperCase();
  return /^[A-Z0-9.^=-]{1,12}$/.test(ticker) ? ticker : null;
}

export function computeSignal(price: number, closes: number[], rsi: number) {
  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));
  const sma100 = average(closes.slice(-100));
  const sma200 = average(closes.slice(-200));
  let position = "Sobre todas las SMA";
  let pointsSma = 0;

  if (price < sma200) {
    position = "Debajo SMA200 · cuarta zona";
    pointsSma = 50;
  } else if (price < sma100) {
    position = "Debajo SMA100 · tercera zona";
    pointsSma = 40;
  } else if (price < sma50) {
    position = "Debajo SMA50 · segunda zona";
    pointsSma = 30;
  } else if (price < sma20) {
    position = "Debajo SMA20 · primera zona";
    pointsSma = 20;
  }

  const pointsRsi = Math.max(0, Math.min(50, (70 - rsi) * 1.25));
  let signal = "A considerar";
  let level = Math.trunc(pointsSma + pointsRsi);
  if (rsi >= 65 || pointsSma === 0) {
    signal = "Descartado de momento";
    level = 10;
  } else if (rsi >= DCA_RSI_MIN && rsi <= DCA_RSI_MAX && pointsSma >= 30) {
    signal = "Interesante";
  }
  return {
    position,
    level: Math.min(Math.max(level, 10), 100),
    signal,
    sma20,
    sma50,
    sma100,
    sma200,
    pointsSma,
    pointsRsi: Number(pointsRsi.toFixed(2)),
  };
}

function rollingAverage(closes: number[], index: number, window: number): number | null {
  if (index + 1 < window) return null;
  return average(closes.slice(index + 1 - window, index + 1));
}

type DatedClose = {
  date: string;
  close: number;
};

function parseDatedCloses(rawCloses: Array<number | null>, timestamps: Array<number | null>): DatedClose[] {
  return rawCloses.flatMap((value, index) => {
    const timestamp = timestamps[index];
    if (typeof value !== "number" || !Number.isFinite(value) || typeof timestamp !== "number" || !Number.isFinite(timestamp)) return [];
    const date = new Date(timestamp * 1000);
    if (Number.isNaN(date.getTime())) return [];
    return [{ date: date.toISOString().slice(0, 10), close: value }];
  });
}

function buildHistory(datedCloses: DatedClose[]): HistoricalPoint[] {
  const closes = datedCloses.map(({ close }) => close);
  return datedCloses.map(({ date, close }, index) => {
    const sma20 = rollingAverage(closes, index, 20);
    const sma50 = rollingAverage(closes, index, 50);
    const sma100 = rollingAverage(closes, index, 100);
    const sma200 = rollingAverage(closes, index, 200);
    return {
      date,
      close: Number(close.toFixed(2)),
      sma20: sma20 === null ? null : Number(sma20.toFixed(2)),
      sma50: sma50 === null ? null : Number(sma50.toFixed(2)),
      sma100: sma100 === null ? null : Number(sma100.toFixed(2)),
      sma200: sma200 === null ? null : Number(sma200.toFixed(2)),
    };
  });
}

export async function fetchTicker(ticker: string): Promise<RadarAsset> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&includePrePost=false`,
      { headers: { Accept: "application/json", "User-Agent": "JB-Termometro/1.0" }, signal: controller.signal },
    );
    if (!response.ok) throw new Error(`Yahoo respondió ${response.status}`);
    const json = (await response.json()) as {
      chart?: {
        result?: Array<{
          meta?: Record<string, unknown>;
          timestamp?: Array<number | null>;
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const rawCloses = result?.indicators?.quote?.[0]?.close ?? [];
    const timestamps = result?.timestamp ?? [];
    if (rawCloses.length !== timestamps.length) {
      throw new Error("histórico desalineado: Yahoo devolvió distinta cantidad de fechas y cierres");
    }
    const datedCloses = parseDatedCloses(rawCloses, timestamps);
    const closes = datedCloses.map(({ close }) => close);
    const meta = result?.meta ?? {};
    const quotedPrice = Number(meta.regularMarketPrice);
    const latest = Number.isFinite(quotedPrice) ? quotedPrice : closes.at(-1);
    if (typeof latest !== "number" || !Number.isFinite(latest)) throw new Error("precio no disponible");
    const quotedPrevious = Number(meta.chartPreviousClose);
    const previous = Number.isFinite(quotedPrevious) ? quotedPrevious : closes.at(-2);
    const change = typeof previous === "number" && Number.isFinite(previous) && previous !== 0
      ? Number((((latest - previous) / previous) * 100).toFixed(2))
      : null;

    const rsi = closes.length >= 15 ? computeRsi(closes) : null;
    const latestSma = (window: number) => closes.length >= window ? average(closes.slice(-window)) : null;
    const availableSma20 = latestSma(20);
    const availableSma50 = latestSma(50);
    const availableSma100 = latestSma(100);
    const availableSma200 = latestSma(200);
    const rule = rsi !== null && availableSma200 !== null ? computeSignal(latest, closes, rsi) : null;
    const sparkline = closes.slice(-20).map((close) => Number(close.toFixed(2)));
    const history = buildHistory(datedCloses);
    const rawName = String(meta.longName ?? meta.shortName ?? ticker);
    const instrument = String(meta.instrumentType ?? "").toUpperCase();
    const regularMarketTime = Number(meta.regularMarketTime);
    return {
      ticker,
      name: rawName,
      type: instrument === "ETF" ? "ETF" : "Stock",
      price: Number(latest.toFixed(2)),
      quoteUpdatedAt: Number.isFinite(regularMarketTime) ? new Date(regularMarketTime * 1000).toISOString() : null,
      change,
      rsi: rsi === null ? null : Number(rsi.toFixed(2)),
      sma20: availableSma20 === null ? null : Number(availableSma20.toFixed(2)),
      sma50: availableSma50 === null ? null : Number(availableSma50.toFixed(2)),
      sma100: availableSma100 === null ? null : Number(availableSma100.toFixed(2)),
      sma200: availableSma200 === null ? null : Number(availableSma200.toFixed(2)),
      pointsSma: rule?.pointsSma ?? null,
      pointsRsi: rule?.pointsRsi ?? null,
      level: rule?.level ?? null,
      signal: rule?.signal ?? "Sin cálculo JB",
      position: rule?.position ?? "Histórico insuficiente para cálculo JB completo",
      trend: change === null ? "flat" : change >= 0 ? "up" : "down",
      historyDays: closes.length,
      sparkline,
      history,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMarketRadar(force = false): Promise<RadarPayload> {
  if (!force && radarCache && radarCache.expiresAt > Date.now()) {
    return { ...radarCache.payload, cached: true };
  }
  return getRadarForTickers(DEFAULT_TICKERS, force);
}

export async function getRadarForTickers(tickers: string[], force = false): Promise<RadarPayload> {
  const normalizedTickers = [...new Set(tickers.map(normalizeTicker).filter((ticker): ticker is string => Boolean(ticker)))].sort();
  const cacheKey = normalizedTickers.join(",");
  const isDefaultRadar = cacheKey === DEFAULT_TICKERS.slice().sort().join(",");
  const cached = isDefaultRadar ? radarCache : getPersonalCachedRadar(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return { ...cached.payload, cached: true };
  }
  if (!normalizedTickers.length) {
    return {
      marketStatus: "Radar personal · sin activos",
      updatedAt: new Date().toISOString(),
      source: "Yahoo Finance · histórico diario",
      cached: false,
      stale: false,
      errors: [],
      assets: [],
      summary: { total: 0, opportunities: 0, watch: 0, avoid: 0 },
    };
  }
  const results = await Promise.allSettled(normalizedTickers.map(fetchTicker));
  const assets = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${normalizedTickers[index]}: ${result.reason instanceof Error ? result.reason.message : "sin respuesta"}`] : []);
  if (!assets.length) {
    if (isDefaultRadar) {
      const persistedRadar = await readPersistedRadar();
      if (persistedRadar) {
        logger.warn({ errors }, "Serving persisted market radar after Yahoo Finance failure");
        return staleRadarPayload(persistedRadar, errors);
      }
    }
    throw new Error("Yahoo Finance no devolvió datos utilizables.");
  }
  const payload: RadarPayload = {
    marketStatus: errors.length ? "Mercado · datos parciales" : "Mercado · última cotización",
    updatedAt: new Date().toISOString(),
    source: "Yahoo Finance · histórico diario",
    cached: false,
    stale: false,
    errors,
    assets,
    summary: {
      total: assets.length,
      opportunities: assets.filter((asset) => asset.level !== null && asset.signal === "Interesante").length,
      watch: assets.filter((asset) => asset.level !== null && asset.signal === "A considerar").length,
      avoid: assets.filter((asset) => asset.level !== null && asset.signal === "Descartado de momento").length,
    },
  };
  if (isDefaultRadar) {
    radarCache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
    await persistRadar(payload);
  }
  else cachePersonalRadar(cacheKey, payload);
  return payload;
}

export function isValidTicker(value: string): string | null {
  return normalizeTicker(value);
}

export type MarketSearchResult = {
  ticker: string;
  name: string;
  type: string;
  available: boolean;
  analysisReady: boolean;
  historyDays: number;
};

function searchVariants(query: string): string[] {
  const normalized = query
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const aliases = new Set<string>();
  if (normalized.includes("macdonald")) aliases.add(normalized.replace("macdonald", "mcdonald"));
  if (normalized.includes("mcdonald")) aliases.add(normalized);
  aliases.add(query.trim());
  if (normalized.length >= 2) aliases.add(normalized);
  return [...aliases].filter((value) => value.length >= 2).slice(0, 3);
}

export async function searchMarketInstruments(query: string): Promise<MarketSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const matchesByTicker = new Map<string, MarketSearchResult>();
    for (const variant of searchVariants(trimmed)) {
      const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(variant)}&quotesCount=8&newsCount=0`, {
        headers: { Accept: "application/json", "User-Agent": "JB-Termometro/1.0" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Yahoo respondió ${response.status}`);
      const json = (await response.json()) as { quotes?: Array<{ symbol?: string; longname?: string; shortname?: string; quoteType?: string }> };
      for (const match of (json.quotes ?? []).flatMap((quote) => {
        const ticker = quote.symbol ? normalizeTicker(quote.symbol) : null;
        if (!ticker || !["EQUITY", "ETF"].includes(String(quote.quoteType).toUpperCase())) return [];
        return [{ ticker, name: quote.longname ?? quote.shortname ?? ticker, type: String(quote.quoteType).toUpperCase() === "ETF" ? "ETF" : "Stock", available: true, analysisReady: false, historyDays: 0 }];
      })) {
        if (!matchesByTicker.has(match.ticker)) matchesByTicker.set(match.ticker, match);
      }
    }
    return Promise.all([...matchesByTicker.values()].slice(0, 8).map(async (match) => {
      try {
        const asset = await fetchTicker(match.ticker);
        return { ...match, available: true, analysisReady: asset.level !== null, historyDays: asset.historyDays };
      } catch {
        return { ...match, available: false, analysisReady: false, historyDays: 0 };
      }
    }));
  } finally {
    clearTimeout(timeout);
  }
}