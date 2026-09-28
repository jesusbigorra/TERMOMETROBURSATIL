import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";

export const EMERGING_MARKET_ETF_UNIVERSE = [
  { ticker: "IEMG", name: "iShares Core MSCI Emerging Markets ETF" },
  { ticker: "EEM", name: "iShares MSCI Emerging Markets ETF" },
  { ticker: "VWO", name: "Vanguard FTSE Emerging Markets ETF" },
  { ticker: "SPEM", name: "SPDR Portfolio Emerging Markets ETF" },
  { ticker: "EMXC", name: "iShares MSCI Emerging Markets ex China ETF" },
  { ticker: "XSOE", name: "WisdomTree Emerging Markets ex-State-Owned Enterprises Fund" },
  { ticker: "FNDE", name: "Schwab Fundamental Emerging Markets Large Company ETF" },
  { ticker: "DEM", name: "WisdomTree Emerging Markets High Dividend Fund" },
  { ticker: "EMLC", name: "VanEck J.P. Morgan EM Local Currency Bond ETF" },
  { ticker: "FRDM", name: "Freedom 100 Emerging Markets ETF" },
] as const;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PATH_ENV = "EMERGING_MARKET_IDEAS_CACHE_PATH";
const DEFAULT_CACHE_PATH = path.join(process.cwd(), ".cache", "emerging-market-ideas.json");
const SOURCE = "Yahoo Finance · histórico diario y fundamentales cuando disponibles";

export type EmergingMarketIdea = {
  ticker: string;
  name: string;
  historySessions: number;
  growthTrend: "Al alza" | "Mixta" | "A la baja" | null;
  return200Sessions: number | null;
  dividendYield: number | null;
  peRatio: number | null;
  profitMargin: number | null;
  score: number | null;
  rank: number | null;
  source: string;
  updatedAt: string;
};

export type EmergingMarketIdeasPayload = {
  updatedAt: string;
  source: string;
  cached: boolean;
  stale: boolean;
  errors: string[];
  candidateUniverse: string[];
  candidatesEvaluated: number;
  ideas: EmergingMarketIdea[];
};

type RankedInput = Pick<EmergingMarketIdea, "ticker" | "name" | "historySessions" | "growthTrend" | "return200Sessions" | "dividendYield" | "peRatio" | "profitMargin">;
type PersistedIdeas = { version: 1; savedAt: string; payload: EmergingMarketIdeasPayload };
type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>;
      timestamp?: Array<number | null>;
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};
type QuoteFundamentals = {
  dividendYield: number | null;
  peRatio: number | null;
  profitMargin: number | null;
};

let ideasCache: { expiresAt: number; payload: EmergingMarketIdeasPayload } | null = null;

function cachePath() {
  return process.env[CACHE_PATH_ENV] || DEFAULT_CACHE_PATH;
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function rawValue(value: unknown): number | null {
  if (typeof value === "object" && value !== null && "raw" in value) {
    return numberOrNull((value as { raw?: unknown }).raw);
  }
  return numberOrNull(value);
}

function extractFundamentals(json: unknown): QuoteFundamentals {
  const root = json as {
    quoteSummary?: { result?: Array<Record<string, unknown>> };
    quoteResponse?: { result?: Array<Record<string, unknown>> };
  };
  const summary = root.quoteSummary?.result?.[0] ?? {};
  const detail = (summary.summaryDetail ?? {}) as Record<string, unknown>;
  const statistics = (summary.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const financial = (summary.financialData ?? {}) as Record<string, unknown>;
  const quote = root.quoteResponse?.result?.[0] ?? {};
  const dividend = rawValue(detail.dividendYield) ?? rawValue(quote.dividendYield);
  const pe = rawValue(statistics.trailingPE) ?? rawValue(quote.trailingPE);
  const margin = rawValue(financial.profitMargins) ?? rawValue(quote.profitMargins);
  return {
    dividendYield: dividend === null ? null : Number((dividend * 100).toFixed(4)),
    peRatio: pe === null ? null : Number(pe.toFixed(4)),
    profitMargin: margin === null ? null : Number((margin * 100).toFixed(4)),
  };
}

async function fetchJson(url: string, timeoutMs = 7000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "JB-Termometro/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Yahoo respondió ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function parseChart(json: YahooChart): { closes: number[]; name: string } {
  const result = json.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const timestamps = result?.timestamp ?? [];
  if (closes.length !== timestamps.length) throw new Error("histórico desalineado");
  const valid = closes.flatMap((close, index) => {
    const timestamp = timestamps[index];
    return typeof close === "number" && Number.isFinite(close) && typeof timestamp === "number" && Number.isFinite(timestamp) ? [close] : [];
  });
  return {
    closes: valid,
    name: String(result?.meta?.longName ?? result?.meta?.shortName ?? ""),
  };
}

export function compute200SessionReturn(closes: number[]): number | null {
  if (closes.length < 200) return null;
  const window = closes.slice(-200);
  const first = window[0];
  const last = window.at(-1);
  if (typeof last !== "number" || !Number.isFinite(first) || first === 0) return null;
  return Number((((last - first) / first) * 100).toFixed(2));
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function growthTrend(closes: number[]): EmergingMarketIdea["growthTrend"] {
  if (closes.length < 200) return null;
  const last = closes.at(-1);
  const shortAverage = average(closes.slice(-50));
  const longAverage = average(closes.slice(-200));
  if (last === undefined || shortAverage === null || longAverage === null) return null;
  if (last > shortAverage && shortAverage > longAverage) return "Al alza";
  if (last < shortAverage && shortAverage < longAverage) return "A la baja";
  return "Mixta";
}

/**
 * Rank only candidates with a complete 200-session window. A missing metric is
 * retained as null and never replaced with an estimate. The score is deliberately
 * simple: return (0-100 points, capped) plus a trend adjustment (10/0/-10).
 */
export function rankEmergingIdeas(candidates: RankedInput[]): EmergingMarketIdea[] {
  const scored = candidates.map((candidate) => {
    const returnValue = candidate.return200Sessions;
    const trendAdjustment = candidate.growthTrend === "Al alza" ? 10 : candidate.growthTrend === "A la baja" ? -10 : 0;
    const score = returnValue === null || candidate.historySessions < 200
      ? null
      : Number(Math.max(0, Math.min(100, returnValue + 50 + trendAdjustment)).toFixed(2));
    return { ...candidate, score };
  });
  const sorted = [...scored].sort((left, right) => {
    if (left.score === null && right.score === null) return left.ticker.localeCompare(right.ticker);
    if (left.score === null) return 1;
    if (right.score === null) return -1;
    return right.score - left.score || left.ticker.localeCompare(right.ticker);
  });
  return sorted.slice(0, 5).map((candidate, index) => ({
    ...candidate,
    rank: candidate.score === null ? null : index + 1,
    source: SOURCE,
    updatedAt: "",
  }));
}

async function fetchFundamentals(ticker: string): Promise<QuoteFundamentals> {
  const modules = "summaryDetail,defaultKeyStatistics,financialData";
  try {
    const summary = await fetchJson(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`);
    const values = extractFundamentals(summary);
    if (values.dividendYield !== null || values.peRatio !== null || values.profitMargin !== null) return values;
  } catch {
    // The quoteSummary endpoint is not available for every region/ticker.
  }
  try {
    const quote = await fetchJson(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`);
    return extractFundamentals(quote);
  } catch {
    return { dividendYield: null, peRatio: null, profitMargin: null };
  }
}

async function fetchCandidate(candidate: typeof EMERGING_MARKET_ETF_UNIVERSE[number]) {
  const [chartResult, fundamentals] = await Promise.all([
    fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate.ticker)}?range=2y&interval=1d&includePrePost=false`).then((json) => parseChart(json as YahooChart)),
    fetchFundamentals(candidate.ticker),
  ]);
  const name = chartResult.name || candidate.name;
  return {
    ticker: candidate.ticker,
    name,
    historySessions: chartResult.closes.length,
    growthTrend: growthTrend(chartResult.closes),
    return200Sessions: compute200SessionReturn(chartResult.closes),
    ...fundamentals,
  } satisfies RankedInput;
}

function isPayload(value: unknown): value is EmergingMarketIdeasPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<EmergingMarketIdeasPayload>;
  return typeof payload.updatedAt === "string"
    && typeof payload.source === "string"
    && typeof payload.cached === "boolean"
    && typeof payload.stale === "boolean"
    && Array.isArray(payload.errors)
    && Array.isArray(payload.candidateUniverse)
    && typeof payload.candidatesEvaluated === "number"
    && Array.isArray(payload.ideas);
}

async function readPersisted(): Promise<EmergingMarketIdeasPayload | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath(), "utf8"));
    const payload = typeof parsed === "object" && parsed !== null && "payload" in parsed
      ? (parsed as { payload?: unknown }).payload
      : parsed;
    return isPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function persist(payload: EmergingMarketIdeasPayload) {
  const destination = cachePath();
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const persisted: PersistedIdeas = { version: 1, savedAt: new Date().toISOString(), payload: { ...payload, cached: false, stale: false } };
    await writeFile(temporary, JSON.stringify(persisted), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  } catch (error) {
    logger.warn({ err: error, cachePath: destination }, "Unable to persist emerging-market ideas cache");
    await unlink(temporary).catch(() => undefined);
  }
}

export function resetEmergingMarketIdeasCache() {
  ideasCache = null;
}

export async function getEmergingMarketIdeas(force = false): Promise<EmergingMarketIdeasPayload> {
  if (!force && ideasCache && ideasCache.expiresAt > Date.now()) return { ...ideasCache.payload, cached: true };

  const settled = await Promise.allSettled(EMERGING_MARKET_ETF_UNIVERSE.map(fetchCandidate));
  const valid = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const errors = settled.flatMap((result, index) => result.status === "rejected"
    ? [`${EMERGING_MARKET_ETF_UNIVERSE[index].ticker}: ${result.reason instanceof Error ? result.reason.message : "sin respuesta"}`]
    : []);

  if (!valid.length) {
    const persisted = await readPersisted();
    if (persisted) {
      return {
        ...persisted,
        cached: true,
        stale: true,
        errors: [`Yahoo Finance no está disponible temporalmente: ${errors.join(" · ")}`],
      };
    }
  }

  const updatedAt = new Date().toISOString();
  const ideas = rankEmergingIdeas(valid).map((idea) => ({ ...idea, updatedAt }));
  const payload: EmergingMarketIdeasPayload = {
    updatedAt,
    source: SOURCE,
    cached: false,
    stale: false,
    errors,
    candidateUniverse: EMERGING_MARKET_ETF_UNIVERSE.map(({ ticker }) => ticker),
    candidatesEvaluated: valid.length,
    ideas,
  };
  ideasCache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
  await persist(payload);
  return payload;
}