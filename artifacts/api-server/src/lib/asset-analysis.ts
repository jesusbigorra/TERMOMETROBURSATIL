// Per-asset deep analysis for the termómetro "ficha": 5 years of daily history
// (adjusted for dividends and splits), period returns with CAGR vs the S&P 500,
// risk metrics and fundamentals. Everything is computed from Yahoo Finance data.
import { logger } from "./logger";
import { YAHOO_USER_AGENT, fetchYahooAuthed } from "./yahoo-session";
import { getSecFundamentals } from "./sec-fundamentals";

const BENCHMARK = "SPY";
const RISK_FREE_TICKER = "^IRX"; // 13-week US T-bill yield, in percent
const CACHE_TTL_MS = 15 * 60 * 1000;
const TRADING_DAYS = 252;

export type AnalysisPoint = {
  date: string;
  close: number;
  adjClose: number;
  volume: number | null;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  drawdown: number; // % below the running peak of adjClose (0 or negative)
};

export type PeriodReturn = {
  key: string;
  label: string;
  startDate: string | null;
  totalReturn: number | null; // %, includes dividends (adjusted close)
  priceReturn: number | null; // %, price only
  cagr: number | null; // % per year, only for periods of 1 year or more
  benchmarkReturn: number | null;
  benchmarkCagr: number | null;
};

export type RiskWindow = {
  key: string;
  label: string;
  volatility: number | null; // annualized %
  maxDrawdown: number | null; // %
  maxDrawdownDate: string | null;
  cagr: number | null;
  sharpe: number | null;
  beta: number | null;
  correlation: number | null;
  benchmarkVolatility: number | null;
  benchmarkMaxDrawdown: number | null;
};

export type Fundamentals = Record<string, number | string | null> & {
  holdings?: never;
};

export type AssetAnalysis = {
  ticker: string;
  name: string;
  type: string;
  currency: string | null;
  updatedAt: string;
  benchmark: string;
  riskFreeRate: number | null;
  firstDate: string | null;
  history: AnalysisPoint[];
  benchmarkHistory: Array<{ date: string; adjClose: number }>;
  periods: PeriodReturn[];
  risk: RiskWindow[];
  currentDrawdown: number | null;
  bestDay: { date: string; change: number } | null;
  worstDay: { date: string; change: number } | null;
  dividends: Array<{ date: string; amount: number }>;
  trailingDividends: number | null;
  fundamentals: Record<string, number | string | null>;
  topHoldings: Array<{ symbol: string | null; name: string; weight: number }>;
  sectorWeights: Array<{ sector: string; weight: number }>;
  errors: string[];
};

type Series = {
  dates: string[];
  close: number[];
  adjClose: number[];
  volume: Array<number | null>;
  dividends: Array<{ date: string; amount: number }>;
  meta: Record<string, unknown>;
};

const cache = new Map<string, { expiresAt: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return value;
}

const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));

function num(value: unknown): number | null {
  if (typeof value === "object" && value !== null && "raw" in value) return num((value as { raw: unknown }).raw);
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "fmt" in value) return str((value as { fmt: unknown }).fmt);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function fetchSeries(ticker: string, range = "5y"): Promise<Series> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const path = `/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d&events=div%2Csplit&includePrePost=false`;
    // Same client id as the radar (which Yahoo accepts); on 429 retry the other host.
    let response = await fetch(`https://query1.finance.yahoo.com${path}`, { headers: { Accept: "application/json", "User-Agent": "JB-Termometro/1.0" }, signal: controller.signal });
    if (response.status === 429 || response.status >= 500) {
      response = await fetch(`https://query2.finance.yahoo.com${path}`, { headers: { Accept: "application/json", "User-Agent": YAHOO_USER_AGENT }, signal: controller.signal });
    }
    if (!response.ok) throw new Error(`Yahoo respondió ${response.status} para ${ticker}`);
    const json = (await response.json()) as {
      chart?: { result?: Array<{
        meta?: Record<string, unknown>;
        timestamp?: Array<number | null>;
        events?: { dividends?: Record<string, { amount?: number; date?: number }> };
        indicators?: {
          quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }>;
          adjclose?: Array<{ adjclose?: Array<number | null> }>;
        };
      }> };
    };
    const result = json.chart?.result?.[0];
    if (!result) throw new Error(`Sin datos para ${ticker}`);
    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const volumes = result.indicators?.quote?.[0]?.volume ?? [];
    const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    const series: Series = { dates: [], close: [], adjClose: [], volume: [], dividends: [], meta: result.meta ?? {} };
    timestamps.forEach((timestamp, index) => {
      const close = closes[index];
      if (typeof timestamp !== "number" || typeof close !== "number" || !Number.isFinite(close) || close <= 0) return;
      const adj = adjusted[index];
      series.dates.push(new Date(timestamp * 1000).toISOString().slice(0, 10));
      series.close.push(close);
      series.adjClose.push(typeof adj === "number" && Number.isFinite(adj) && adj > 0 ? adj : close);
      const volume = volumes[index];
      series.volume.push(typeof volume === "number" && Number.isFinite(volume) ? volume : null);
    });
    series.dividends = Object.values(result.events?.dividends ?? {})
      .filter((item) => typeof item.amount === "number" && typeof item.date === "number")
      .map((item) => ({ date: new Date(item.date! * 1000).toISOString().slice(0, 10), amount: round(item.amount!, 4) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (series.dates.length < 2) throw new Error(`Histórico insuficiente para ${ticker}`);
    return series;
  } finally {
    clearTimeout(timer);
  }
}

function sma(values: number[], index: number, window: number): number | null {
  if (index + 1 < window) return null;
  let sum = 0;
  for (let i = index + 1 - window; i <= index; i += 1) sum += values[i];
  return round(sum / window);
}

function buildHistory(series: Series): AnalysisPoint[] {
  let peak = 0;
  return series.dates.map((date, index) => {
    const adj = series.adjClose[index];
    peak = Math.max(peak, adj);
    return {
      date,
      close: round(series.close[index]),
      adjClose: round(adj, 4),
      volume: series.volume[index],
      sma20: sma(series.close, index, 20),
      sma50: sma(series.close, index, 50),
      sma100: sma(series.close, index, 100),
      sma200: sma(series.close, index, 200),
      drawdown: round((adj / peak - 1) * 100),
    };
  });
}

function shiftMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString().slice(0, 10);
}

function yearsBetween(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / (365.25 * 86_400_000);
}

// Index of the first observation on or after `date`; null if the series starts
// more than 7 days after it (not enough history for that period).
function indexFrom(dates: string[], date: string): number | null {
  const index = dates.findIndex((value) => value >= date);
  if (index < 0) return null;
  if (index === 0 && yearsBetween(date, dates[0]) * 365.25 > 7) return null;
  return index;
}

// Last observation on or before `date`.
function indexAtOrBefore(dates: string[], date: string): number | null {
  for (let i = dates.length - 1; i >= 0; i -= 1) if (dates[i] <= date) return i;
  return null;
}

const PERIODS: Array<{ key: string; label: string; months?: number; ytd?: boolean }> = [
  { key: "1M", label: "1 mes", months: 1 },
  { key: "3M", label: "3 meses", months: 3 },
  { key: "6M", label: "6 meses", months: 6 },
  { key: "YTD", label: "En el año", ytd: true },
  { key: "1A", label: "1 año", months: 12 },
  { key: "3A", label: "3 años", months: 36 },
  { key: "5A", label: "5 años", months: 60 },
];

function periodReturns(series: Series, benchmark: Series | null): PeriodReturn[] {
  const lastDate = series.dates.at(-1)!;
  const last = series.dates.length - 1;
  return PERIODS.map((period) => {
    // YTD compares against the last close of the previous year.
    const start = period.ytd
      ? indexAtOrBefore(series.dates, `${Number(lastDate.slice(0, 4)) - 1}-12-31`)
      : indexFrom(series.dates, shiftMonths(lastDate, period.months!));
    const empty: PeriodReturn = { key: period.key, label: period.label, startDate: null, totalReturn: null, priceReturn: null, cagr: null, benchmarkReturn: null, benchmarkCagr: null };
    if (start === null || start >= last) return empty;
    const startDate = series.dates[start];
    const years = yearsBetween(startDate, lastDate);
    const total = series.adjClose[last] / series.adjClose[start] - 1;
    const price = series.close[last] / series.close[start] - 1;
    const annualize = (value: number) => (years >= 0.98 ? round((Math.pow(1 + value, 1 / years) - 1) * 100) : null);
    let benchmarkReturn: number | null = null;
    let benchmarkCagr: number | null = null;
    if (benchmark) {
      const bStart = indexAtOrBefore(benchmark.dates, startDate);
      const bEnd = indexAtOrBefore(benchmark.dates, lastDate);
      if (bStart !== null && bEnd !== null && bEnd > bStart && Math.abs(yearsBetween(benchmark.dates[bStart], startDate)) * 365.25 <= 7) {
        const value = benchmark.adjClose[bEnd] / benchmark.adjClose[bStart] - 1;
        benchmarkReturn = round(value * 100);
        benchmarkCagr = annualize(value);
      }
    }
    return { ...empty, startDate, totalReturn: round(total * 100), priceReturn: round(price * 100), cagr: annualize(total), benchmarkReturn, benchmarkCagr };
  });
}

function dailyReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) out.push(values[i] / values[i - 1] - 1);
  return out;
}

function stdev(values: number[]): number | null {
  if (values.length < 20) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function maxDrawdown(dates: string[], values: number[]): { value: number; date: string } | null {
  if (values.length < 2) return null;
  let peak = values[0];
  let worst = 0;
  let worstDate = dates[0];
  values.forEach((value, index) => {
    peak = Math.max(peak, value);
    const drawdown = value / peak - 1;
    if (drawdown < worst) {
      worst = drawdown;
      worstDate = dates[index];
    }
  });
  return { value: round(worst * 100), date: worstDate };
}

function riskWindow(key: string, label: string, months: number, series: Series, benchmark: Series | null, riskFree: number | null): RiskWindow {
  const lastDate = series.dates.at(-1)!;
  const start = indexFrom(series.dates, shiftMonths(lastDate, months));
  const empty: RiskWindow = { key, label, volatility: null, maxDrawdown: null, maxDrawdownDate: null, cagr: null, sharpe: null, beta: null, correlation: null, benchmarkVolatility: null, benchmarkMaxDrawdown: null };
  if (start === null) return empty;
  const dates = series.dates.slice(start);
  const values = series.adjClose.slice(start);
  const returns = dailyReturns(values);
  const sd = stdev(returns);
  const volatility = sd === null ? null : sd * Math.sqrt(TRADING_DAYS);
  const years = yearsBetween(dates[0], dates.at(-1)!);
  const cagr = years >= 0.98 ? Math.pow(values.at(-1)! / values[0], 1 / years) - 1 : null;
  const drawdown = maxDrawdown(dates, values);
  const sharpe = volatility && cagr !== null && riskFree !== null ? (cagr - riskFree / 100) / volatility : null;
  let beta: number | null = null;
  let correlation: number | null = null;
  let benchmarkVolatility: number | null = null;
  let benchmarkMaxDrawdown: number | null = null;
  if (benchmark) {
    const byDate = new Map(benchmark.dates.map((date, index) => [date, benchmark.adjClose[index]]));
    const pairs: Array<[number, number]> = [];
    for (let i = 1; i < dates.length; i += 1) {
      const b0 = byDate.get(dates[i - 1]);
      const b1 = byDate.get(dates[i]);
      if (b0 && b1) pairs.push([values[i] / values[i - 1] - 1, b1 / b0 - 1]);
    }
    if (pairs.length >= 60) {
      const meanA = pairs.reduce((sum, [a]) => sum + a, 0) / pairs.length;
      const meanB = pairs.reduce((sum, [, b]) => sum + b, 0) / pairs.length;
      let cov = 0;
      let varA = 0;
      let varB = 0;
      for (const [a, b] of pairs) {
        cov += (a - meanA) * (b - meanB);
        varA += (a - meanA) ** 2;
        varB += (b - meanB) ** 2;
      }
      beta = varB ? cov / varB : null;
      correlation = varA && varB ? cov / Math.sqrt(varA * varB) : null;
    }
    const bStart = indexFrom(benchmark.dates, dates[0]);
    if (bStart !== null) {
      const bValues = benchmark.adjClose.slice(bStart);
      const bSd = stdev(dailyReturns(bValues));
      benchmarkVolatility = bSd === null ? null : round(bSd * Math.sqrt(TRADING_DAYS) * 100);
      benchmarkMaxDrawdown = maxDrawdown(benchmark.dates.slice(bStart), bValues)?.value ?? null;
    }
  }
  return {
    key,
    label,
    volatility: volatility === null ? null : round(volatility * 100),
    maxDrawdown: drawdown?.value ?? null,
    maxDrawdownDate: drawdown?.date ?? null,
    cagr: cagr === null ? null : round(cagr * 100),
    sharpe: sharpe === null ? null : round(sharpe),
    beta: beta === null ? null : round(beta),
    correlation: correlation === null ? null : round(correlation),
    benchmarkVolatility,
    benchmarkMaxDrawdown,
  };
}

async function fetchRiskFreeRate(): Promise<number | null> {
  return cached("riskfree", async () => {
    try {
      const series = await fetchSeries(RISK_FREE_TICKER, "1mo");
      const value = series.close.at(-1);
      return value === undefined ? null : round(value, 3);
    } catch (error) {
      logger.warn({ err: error }, "Risk-free rate unavailable");
      return null;
    }
  });
}

type FundamentalsResult = {
  values: Record<string, number | string | null>;
  topHoldings: AssetAnalysis["topHoldings"];
  sectorWeights: AssetAnalysis["sectorWeights"];
};

const SECTOR_NAMES: Record<string, string> = {
  realestate: "Inmobiliario",
  consumer_cyclical: "Consumo cíclico",
  basic_materials: "Materiales",
  consumer_defensive: "Consumo defensivo",
  technology: "Tecnología",
  communication_services: "Comunicaciones",
  financial_services: "Financiero",
  utilities: "Servicios públicos",
  industrials: "Industrial",
  energy: "Energía",
  healthcare: "Salud",
};

async function fetchFundamentals(ticker: string): Promise<FundamentalsResult> {
  const modules = "price,summaryDetail,defaultKeyStatistics,financialData,fundProfile,topHoldings,assetProfile";
  const json = (await fetchYahooAuthed(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`,
  )) as { quoteSummary?: { result?: Array<Record<string, Record<string, unknown>>> } };
  const result = json.quoteSummary?.result?.[0] ?? {};
  const price = result.price ?? {};
  const detail = result.summaryDetail ?? {};
  const stats = result.defaultKeyStatistics ?? {};
  const financial = result.financialData ?? {};
  const fund = result.fundProfile ?? {};
  const holdings = result.topHoldings ?? {};
  const profile = result.assetProfile ?? {};
  const fees = (fund.feesExpensesInvestment ?? {}) as Record<string, unknown>;
  const equity = (holdings.equityHoldings ?? {}) as Record<string, unknown>;
  const pct = (value: unknown) => {
    const parsed = num(value);
    return parsed === null ? null : round(parsed * 100);
  };
  const values: Record<string, number | string | null> = {
    marketCap: num(price.marketCap) ?? num(detail.marketCap),
    trailingPE: num(detail.trailingPE) ?? num(stats.trailingPE),
    forwardPE: num(detail.forwardPE) ?? num(stats.forwardPE),
    pegRatio: num(stats.pegRatio) ?? num(stats.trailingPegRatio),
    priceToBook: num(stats.priceToBook),
    priceToSales: num(detail.priceToSalesTrailing12Months),
    evToEbitda: num(stats.enterpriseToEbitda),
    grossMargin: pct(financial.grossMargins),
    operatingMargin: pct(financial.operatingMargins),
    profitMargin: pct(financial.profitMargins ?? stats.profitMargins),
    returnOnEquity: pct(financial.returnOnEquity),
    revenueGrowth: pct(financial.revenueGrowth),
    earningsGrowth: pct(financial.earningsGrowth ?? stats.earningsQuarterlyGrowth),
    debtToEquity: num(financial.debtToEquity),
    currentRatio: num(financial.currentRatio),
    freeCashflow: num(financial.freeCashflow),
    dividendYield: pct(detail.dividendYield ?? detail.yield),
    payoutRatio: pct(detail.payoutRatio),
    fiveYearAvgDividendYield: num(detail.fiveYearAvgDividendYield),
    beta: num(detail.beta) ?? num(stats.beta3Year),
    fiftyTwoWeekHigh: num(detail.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(detail.fiftyTwoWeekLow),
    targetMeanPrice: num(financial.targetMeanPrice),
    targetLowPrice: num(financial.targetLowPrice),
    targetHighPrice: num(financial.targetHighPrice),
    analystCount: num(financial.numberOfAnalystOpinions),
    recommendation: str(financial.recommendationKey),
    sector: str(profile.sector),
    industry: str(profile.industry),
    expenseRatio: pct(fees.annualReportExpenseRatio ?? stats.annualReportExpenseRatio ?? detail.expenseRatio),
    totalAssets: num(detail.totalAssets) ?? num(stats.totalAssets),
    category: str(fund.categoryName) ?? str(stats.category),
    fundFamily: str(fund.family) ?? str(stats.fundFamily),
    fundInceptionDate: str(stats.fundInceptionDate),
    holdingsPE: num(equity.priceToEarnings),
    holdingsPB: num(equity.priceToBook),
    turnover: pct(fees.annualHoldingsTurnover ?? stats.annualHoldingsTurnover),
  };
  const topHoldings = Array.isArray(holdings.holdings)
    ? (holdings.holdings as Array<Record<string, unknown>>).slice(0, 10).map((item) => ({
      symbol: str(item.symbol),
      name: str(item.holdingName) ?? str(item.symbol) ?? "—",
      weight: round((num(item.holdingPercent) ?? 0) * 100),
    }))
    : [];
  const sectorWeights = Array.isArray(holdings.sectorWeightings)
    ? (holdings.sectorWeightings as Array<Record<string, unknown>>).flatMap((item) => Object.entries(item).map(([key, value]) => ({
      sector: SECTOR_NAMES[key] ?? key,
      weight: round((num(value) ?? 0) * 100),
    }))).filter((item) => item.weight > 0).sort((a, b) => b.weight - a.weight)
    : [];
  return { values, topHoldings, sectorWeights };
}

export async function getAssetAnalysis(rawTicker: string): Promise<AssetAnalysis> {
  const ticker = rawTicker.trim().toUpperCase();
  return cached(`analysis:${ticker}`, async () => {
    const errors: string[] = [];
    const [seriesResult, benchmarkResult, riskFree, fundamentalsResult] = await Promise.allSettled([
      fetchSeries(ticker),
      ticker === BENCHMARK ? Promise.resolve(null) : cached(`series:${BENCHMARK}`, () => fetchSeries(BENCHMARK)),
      fetchRiskFreeRate(),
      fetchFundamentals(ticker),
    ]);
    if (seriesResult.status === "rejected") throw seriesResult.reason;
    const series = seriesResult.value;
    const benchmark = benchmarkResult.status === "fulfilled" ? (benchmarkResult.value ?? series) : null;
    if (benchmarkResult.status === "rejected") errors.push("No se pudo cargar el S&P 500 (SPY) para comparar.");
    const rate = riskFree.status === "fulfilled" ? riskFree.value : null;
    let fundamentals: FundamentalsResult = { values: {}, topHoldings: [], sectorWeights: [] };
    if (fundamentalsResult.status === "fulfilled") fundamentals = fundamentalsResult.value;
    else logger.info({ err: String(fundamentalsResult.reason), ticker }, "Yahoo fundamentals unavailable, using SEC");
    const lastClose = series.close.at(-1)!;
    const sec = await getSecFundamentals(ticker, lastClose);
    const yahooValues = Object.fromEntries(Object.entries(fundamentals.values).filter(([, value]) => value !== null && value !== undefined));
    fundamentals.values = { ...(sec ?? {}), ...yahooValues };
    if (!Object.keys(yahooValues).length && !sec) fundamentals.values.source = null;
    const returns = dailyReturns(series.adjClose);
    const lastYearStart = Math.max(1, series.dates.length - TRADING_DAYS);
    let best: AssetAnalysis["bestDay"] = null;
    let worst: AssetAnalysis["worstDay"] = null;
    for (let i = lastYearStart; i < series.dates.length; i += 1) {
      const change = round(returns[i - 1] * 100);
      if (!best || change > best.change) best = { date: series.dates[i], change };
      if (!worst || change < worst.change) worst = { date: series.dates[i], change };
    }
    const lastDate = series.dates.at(-1)!;
    const oneYearAgo = shiftMonths(lastDate, 12);
    const trailing = series.dividends.filter((item) => item.date > oneYearAgo).reduce((sum, item) => sum + item.amount, 0);
    const history = buildHistory(series);
    if ((fundamentals.values.dividendYield ?? null) === null && trailing > 0) {
      fundamentals.values.dividendYield = round((trailing / series.close.at(-1)!) * 100);
    }
    const meta = series.meta;
    const instrument = String(meta.instrumentType ?? "").toUpperCase();
    return {
      ticker,
      name: String(meta.longName ?? meta.shortName ?? ticker),
      type: instrument === "ETF" ? "ETF" : "Stock",
      currency: typeof meta.currency === "string" ? meta.currency : null,
      updatedAt: new Date().toISOString(),
      benchmark: BENCHMARK,
      riskFreeRate: rate,
      firstDate: series.dates[0],
      history,
      benchmarkHistory: benchmark && benchmark !== series
        ? benchmark.dates.map((date, index) => ({ date, adjClose: round(benchmark.adjClose[index], 4) }))
        : [],
      periods: periodReturns(series, benchmark === series ? null : benchmark),
      risk: [
        riskWindow("1A", "1 año", 12, series, benchmark === series ? null : benchmark, rate),
        riskWindow("3A", "3 años", 36, series, benchmark === series ? null : benchmark, rate),
        riskWindow("5A", "5 años", 60, series, benchmark === series ? null : benchmark, rate),
      ],
      currentDrawdown: history.at(-1)?.drawdown ?? null,
      bestDay: best,
      worstDay: worst,
      dividends: series.dividends,
      trailingDividends: trailing ? round(trailing, 4) : null,
      fundamentals: fundamentals.values,
      topHoldings: fundamentals.topHoldings,
      sectorWeights: fundamentals.sectorWeights,
      errors,
    };
  });
}

// Full daily history (Yahoo "max") in a compact shape, for long backtests of the JB signal.
export async function getLongHistory(rawTicker: string): Promise<{ ticker: string; dates: string[]; close: number[]; adjClose: number[] }> {
  const ticker = rawTicker.trim().toUpperCase();
  const series = await fetchSeries(ticker, "max");
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return { ticker, dates: series.dates, close: series.close.map(round), adjClose: series.adjClose.map(round) };
}
