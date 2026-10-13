import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";

type IndexStyle = "Capitalización" | "Reglas propias";
type UniverseEntry = { ticker: string; name: string; region: string; expenseRatio: number | null; style: IndexStyle };

const CAP: IndexStyle = "Capitalización";
const RULES: IndexStyle = "Reglas propias";
/**
 * Expense ratios (percent per year) are kept by hand because no free server-side
 * source exists. Reviewed against stockanalysis.com (and Nasdaq / ETF Central for
 * IEMG, EEM, VWO and SPEM). Update the date when the table is re-checked.
 * "Reglas propias" groups every fund that does not weight by market cap:
 * fundamentals, dividends, factors, themes and rule-based exclusions.
 */
export const EXPENSE_RATIOS_AS_OF = "2026-10-13";

const GLOBAL = "Emergentes (global)";

/**
 * Candidate pool. The region is only a label shown on the card: ranking never
 * looks at it, so if the five best ETFs all happen to be in one country, all
 * five are shown.
 */
export const EMERGING_MARKET_ETF_UNIVERSE: readonly UniverseEntry[] = [
  // Broad emerging-market funds
  { ticker: "IEMG", name: "iShares Core MSCI Emerging Markets ETF", region: GLOBAL, expenseRatio: 0.09, style: CAP },
  { ticker: "EEM", name: "iShares MSCI Emerging Markets ETF", region: GLOBAL, expenseRatio: 0.72, style: CAP },
  { ticker: "VWO", name: "Vanguard FTSE Emerging Markets ETF", region: GLOBAL, expenseRatio: 0.06, style: CAP },
  { ticker: "SPEM", name: "SPDR Portfolio Emerging Markets ETF", region: GLOBAL, expenseRatio: 0.07, style: CAP },
  { ticker: "SCHE", name: "Schwab Emerging Markets Equity ETF", region: GLOBAL, expenseRatio: 0.06, style: CAP },
  { ticker: "EMXC", name: "iShares MSCI Emerging Markets ex China ETF", region: "Emergentes sin China", expenseRatio: 0.25, style: CAP },
  { ticker: "XSOE", name: "WisdomTree Emerging Markets ex-State-Owned Enterprises Fund", region: GLOBAL, expenseRatio: 0.32, style: RULES },
  { ticker: "FNDE", name: "Schwab Fundamental Emerging Markets Large Company ETF", region: GLOBAL, expenseRatio: 0.39, style: RULES },
  { ticker: "FRDM", name: "Freedom 100 Emerging Markets ETF", region: GLOBAL, expenseRatio: 0.49, style: RULES },
  { ticker: "AVEM", name: "Avantis Emerging Markets Equity ETF", region: GLOBAL, expenseRatio: 0.33, style: RULES },
  { ticker: "DFAE", name: "Dimensional Emerging Core Equity Market ETF", region: GLOBAL, expenseRatio: 0.29, style: RULES },
  { ticker: "EEMV", name: "iShares MSCI Emerging Markets Min Vol Factor ETF", region: GLOBAL, expenseRatio: 0.25, style: RULES },
  { ticker: "EMGF", name: "iShares MSCI Emerging Markets Multifactor ETF", region: GLOBAL, expenseRatio: 0.26, style: RULES },
  { ticker: "DEM", name: "WisdomTree Emerging Markets High Dividend Fund", region: GLOBAL, expenseRatio: 0.63, style: RULES },
  { ticker: "DVYE", name: "iShares Emerging Markets Dividend ETF", region: GLOBAL, expenseRatio: 0.50, style: RULES },
  // Single-country and regional funds
  { ticker: "INDA", name: "iShares MSCI India ETF", region: "India", expenseRatio: 0.61, style: CAP },
  { ticker: "EPI", name: "WisdomTree India Earnings Fund", region: "India", expenseRatio: 0.84, style: RULES },
  { ticker: "EWZ", name: "iShares MSCI Brazil ETF", region: "Brasil", expenseRatio: 0.59, style: CAP },
  { ticker: "EWW", name: "iShares MSCI Mexico ETF", region: "México", expenseRatio: 0.50, style: CAP },
  { ticker: "ECH", name: "iShares MSCI Chile ETF", region: "Chile", expenseRatio: 0.59, style: CAP },
  { ticker: "ARGT", name: "Global X MSCI Argentina ETF", region: "Argentina", expenseRatio: 0.59, style: CAP },
  { ticker: "ILF", name: "iShares Latin America 40 ETF", region: "Latinoamérica", expenseRatio: 0.47, style: CAP },
  { ticker: "EWT", name: "iShares MSCI Taiwan ETF", region: "Taiwán", expenseRatio: 0.59, style: CAP },
  { ticker: "EWY", name: "iShares MSCI South Korea ETF", region: "Corea del Sur", expenseRatio: 0.59, style: CAP },
  { ticker: "MCHI", name: "iShares MSCI China ETF", region: "China", expenseRatio: 0.59, style: CAP },
  { ticker: "FXI", name: "iShares China Large-Cap ETF", region: "China", expenseRatio: 0.74, style: CAP },
  { ticker: "KWEB", name: "KraneShares CSI China Internet ETF", region: "China", expenseRatio: 0.69, style: RULES },
  { ticker: "EZA", name: "iShares MSCI South Africa ETF", region: "Sudáfrica", expenseRatio: 0.59, style: CAP },
  { ticker: "TUR", name: "iShares MSCI Turkey ETF", region: "Turquía", expenseRatio: 0.59, style: CAP },
  { ticker: "EPOL", name: "iShares MSCI Poland ETF", region: "Polonia", expenseRatio: 0.59, style: CAP },
  { ticker: "KSA", name: "iShares MSCI Saudi Arabia ETF", region: "Arabia Saudita", expenseRatio: 0.75, style: CAP },
  { ticker: "UAE", name: "iShares MSCI UAE ETF", region: "Emiratos Árabes", expenseRatio: 0.59, style: CAP },
  { ticker: "THD", name: "iShares MSCI Thailand ETF", region: "Tailandia", expenseRatio: 0.59, style: CAP },
  { ticker: "EIDO", name: "iShares MSCI Indonesia ETF", region: "Indonesia", expenseRatio: 0.59, style: CAP },
  { ticker: "EWM", name: "iShares MSCI Malaysia ETF", region: "Malasia", expenseRatio: 0.50, style: CAP },
  { ticker: "EPHE", name: "iShares MSCI Philippines ETF", region: "Filipinas", expenseRatio: 0.59, style: CAP },
  { ticker: "VNM", name: "VanEck Vietnam ETF", region: "Vietnam", expenseRatio: 0.66, style: CAP },
];

const TOP_N = 20;
const FETCH_CONCURRENCY = 8;
const SESSION_WINDOW = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PATH_ENV = "EMERGING_MARKET_IDEAS_CACHE_PATH";
const DEFAULT_CACHE_PATH = path.join(process.cwd(), ".cache", "emerging-market-ideas.json");
const CACHE_VERSION = 3;
const LIQUIDITY_WINDOW = 63;
const LOW_LIQUIDITY_USD = 5_000_000;
const SOURCE = "Yahoo Finance · precios, volumen y dividendos · ratios de gastos revisados a mano";

export type EmergingMarketIdea = {
  ticker: string;
  name: string;
  region: string;
  historySessions: number;
  growthTrend: "Al alza" | "Mixta" | "A la baja" | null;
  return200Sessions: number | null;
  volatility: number | null;
  maxDrawdown: number | null;
  dividendYield: number | null;
  /** Annual cost of the fund, in percent, from the hand-kept table. */
  expenseRatio: number | null;
  /** "Capitalización" or "Reglas propias". */
  indexStyle: string;
  /** Average daily traded value over the last 63 sessions, in US dollars. */
  avgDollarVolume: number | null;
  /** Kept for API compatibility; fundamentals are no longer requested. */
  peRatio: number | null;
  /** Kept for API compatibility; fundamentals are no longer requested. */
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
  expenseRatiosAsOf: string;
  ideas: EmergingMarketIdea[];
};

type RankedInput = Pick<
  EmergingMarketIdea,
  "ticker" | "name" | "region" | "historySessions" | "growthTrend" | "return200Sessions" | "volatility" | "maxDrawdown" | "dividendYield" | "expenseRatio" | "indexStyle" | "avgDollarVolume" | "peRatio" | "profitMargin"
>;
type PersistedIdeas = { version: number; savedAt: string; payload: EmergingMarketIdeasPayload };
type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>;
      timestamp?: Array<number | null>;
      events?: { dividends?: Record<string, { amount?: number; date?: number }> };
      indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }> };
    }>;
  };
};
type ParsedChart = {
  closes: number[];
  dollarVolumes: number[];
  lastTimestamp: number | null;
  dividends: Array<{ amount: number; date: number }>;
  name: string;
};

let ideasCache: { expiresAt: number; payload: EmergingMarketIdeasPayload } | null = null;

function cachePath() {
  return process.env[CACHE_PATH_ENV] || DEFAULT_CACHE_PATH;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

async function fetchJsonWithRetry(url: string): Promise<unknown> {
  try {
    return await fetchJson(url);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return fetchJson(url);
  }
}

function parseChart(json: YahooChart): ParsedChart {
  const result = json.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const volumes = result?.indicators?.quote?.[0]?.volume ?? [];
  const timestamps = result?.timestamp ?? [];
  if (closes.length !== timestamps.length) throw new Error("histórico desalineado");
  let lastTimestamp: number | null = null;
  const dollarVolumes: number[] = [];
  const valid = closes.flatMap((close, index) => {
    const timestamp = timestamps[index];
    if (typeof close === "number" && Number.isFinite(close) && typeof timestamp === "number" && Number.isFinite(timestamp)) {
      lastTimestamp = timestamp;
      const volume = volumes[index];
      if (typeof volume === "number" && Number.isFinite(volume) && volume >= 0) dollarVolumes.push(close * volume);
      return [close];
    }
    return [];
  });
  const dividends = Object.entries(result?.events?.dividends ?? {}).flatMap(([key, event]) => {
    const amount = event?.amount;
    const date = typeof event?.date === "number" ? event.date : Number(key);
    return typeof amount === "number" && Number.isFinite(amount) && Number.isFinite(date) ? [{ amount, date }] : [];
  });
  return {
    closes: valid,
    dollarVolumes,
    lastTimestamp,
    dividends,
    name: String(result?.meta?.longName ?? result?.meta?.shortName ?? ""),
  };
}

export function compute200SessionReturn(closes: number[]): number | null {
  if (closes.length < SESSION_WINDOW) return null;
  const window = closes.slice(-SESSION_WINDOW);
  const first = window[0];
  const last = window.at(-1);
  if (typeof last !== "number" || !Number.isFinite(first) || first === 0) return null;
  return Number((((last - first) / first) * 100).toFixed(2));
}

/** Worst peak-to-trough fall inside the last 200 sessions, in percent (positive number). */
export function computeMaxDrawdown(closes: number[]): number | null {
  if (closes.length < SESSION_WINDOW) return null;
  const window = closes.slice(-SESSION_WINDOW);
  let peak = window[0];
  let worst = 0;
  for (const close of window) {
    if (close > peak) peak = close;
    if (peak > 0) worst = Math.max(worst, (peak - close) / peak);
  }
  return Number((worst * 100).toFixed(2));
}

/** Annualised standard deviation of daily log returns over the last 200 sessions, in percent. */
export function computeVolatility(closes: number[]): number | null {
  if (closes.length < SESSION_WINDOW) return null;
  const window = closes.slice(-SESSION_WINDOW);
  const returns: number[] = [];
  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1];
    const current = window[index];
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous));
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance = returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1);
  return Number((Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(2));
}

/** Dividends paid in the 365 days before the last session, divided by the last close, in percent. */
export function computeTrailingDividendYield(
  dividends: Array<{ amount: number; date: number }>,
  lastClose: number | undefined,
  lastTimestamp: number | null,
): number | null {
  if (!lastClose || lastClose <= 0 || lastTimestamp === null) return null;
  const cutoff = lastTimestamp - 365 * 86_400;
  const paid = dividends
    .filter((dividend) => dividend.date > cutoff && dividend.date <= lastTimestamp)
    .reduce((total, dividend) => total + dividend.amount, 0);
  return paid > 0 ? Number(((paid / lastClose) * 100).toFixed(2)) : null;
}

/** Mean traded value (price x shares) over the last 63 sessions; null with fewer than 20 sessions of volume. */
export function computeAvgDollarVolume(dollarVolumes: number[]): number | null {
  const window = dollarVolumes.slice(-LIQUIDITY_WINDOW);
  if (window.length < 20) return null;
  return Math.round(window.reduce((total, value) => total + value, 0) / window.length);
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function growthTrend(closes: number[]): EmergingMarketIdea["growthTrend"] {
  if (closes.length < SESSION_WINDOW) return null;
  const last = closes.at(-1);
  const shortAverage = average(closes.slice(-50));
  const longAverage = average(closes.slice(-SESSION_WINDOW));
  if (last === undefined || shortAverage === null || longAverage === null) return null;
  if (last > shortAverage && shortAverage > longAverage) return "Al alza";
  if (last < shortAverage && shortAverage < longAverage) return "A la baja";
  return "Mixta";
}

/**
 * Score from 0 to 100, built only from checkable data:
 *   50 base
 *   + 200-session return, limited to -50..+50 points
 *   + trend adjustment (+10 rising, 0 mixed, -10 falling)
 *   - half of the maximum drawdown in the window, limited to 20 points
 *   - cost: 1 point per 0.10% of expense ratio above 0.20%, limited to 8 points
 *   - liquidity: 5 points when the average daily traded value is below US$5 million
 * A candidate without a full 200-session window gets no score and is left out.
 */
export function scoreIdea(candidate: Pick<RankedInput, "return200Sessions" | "growthTrend" | "maxDrawdown" | "historySessions" | "expenseRatio" | "avgDollarVolume">): number | null {
  if (candidate.return200Sessions === null || candidate.historySessions < SESSION_WINDOW) return null;
  const trendAdjustment = candidate.growthTrend === "Al alza" ? 10 : candidate.growthTrend === "A la baja" ? -10 : 0;
  const drawdownPenalty = candidate.maxDrawdown === null ? 0 : clamp(candidate.maxDrawdown, 0, 40) / 2;
  const costPenalty = candidate.expenseRatio === null ? 0 : clamp((candidate.expenseRatio - 0.2) / 0.1, 0, 8);
  const liquidityPenalty = candidate.avgDollarVolume !== null && candidate.avgDollarVolume < LOW_LIQUIDITY_USD ? 5 : 0;
  const raw = 50 + clamp(candidate.return200Sessions, -50, 50) + trendAdjustment - drawdownPenalty - costPenalty - liquidityPenalty;
  return Number(clamp(raw, 0, 100).toFixed(2));
}

/**
 * Ranks every scored candidate together, whatever its country or region, and
 * keeps the best TOP_N. Ties go to the smaller drawdown, then to the ticker. The page shows the first 10 after its own filters.
 */
export function rankEmergingIdeas(candidates: RankedInput[]): EmergingMarketIdea[] {
  const scored = candidates.flatMap((candidate) => {
    const score = scoreIdea(candidate);
    return score === null ? [] : [{ ...candidate, score }];
  });
  scored.sort((left, right) =>
    right.score - left.score
    || (left.maxDrawdown ?? Infinity) - (right.maxDrawdown ?? Infinity)
    || left.ticker.localeCompare(right.ticker));
  return scored.slice(0, TOP_N).map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    source: SOURCE,
    updatedAt: "",
  }));
}

async function fetchCandidate(candidate: UniverseEntry): Promise<RankedInput> {
  const json = await fetchJsonWithRetry(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate.ticker)}?range=2y&interval=1d&includePrePost=false&events=div`,
  );
  const chart = parseChart(json as YahooChart);
  return {
    ticker: candidate.ticker,
    name: chart.name || candidate.name,
    region: candidate.region,
    historySessions: chart.closes.length,
    growthTrend: growthTrend(chart.closes),
    return200Sessions: compute200SessionReturn(chart.closes),
    volatility: computeVolatility(chart.closes),
    maxDrawdown: computeMaxDrawdown(chart.closes),
    dividendYield: computeTrailingDividendYield(chart.dividends, chart.closes.at(-1), chart.lastTimestamp),
    expenseRatio: candidate.expenseRatio,
    indexStyle: candidate.style,
    avgDollarVolume: computeAvgDollarVolume(chart.dollarVolumes),
    peRatio: null,
    profitMargin: null,
  };
}

async function mapWithLimit<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
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
    if (typeof parsed !== "object" || parsed === null || (parsed as { version?: unknown }).version !== CACHE_VERSION) return null;
    const payload = (parsed as { payload?: unknown }).payload;
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
    const persisted: PersistedIdeas = { version: CACHE_VERSION, savedAt: new Date().toISOString(), payload: { ...payload, cached: false, stale: false } };
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

  const settled = await mapWithLimit(EMERGING_MARKET_ETF_UNIVERSE, FETCH_CONCURRENCY, fetchCandidate);
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
    expenseRatiosAsOf: EXPENSE_RATIOS_AS_OF,
    ideas,
  };
  ideasCache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
  await persist(payload);
  return payload;
}
