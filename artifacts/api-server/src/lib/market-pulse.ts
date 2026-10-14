import { getSecShares } from "./sec-fundamentals";
import { logger } from "./logger";

// Data for the Mercado page: index tape and S&P 500 sector heat map.
// Daily change comes from Yahoo's chart endpoint (same source as the radar); block size is
// price x shares outstanding, with shares from SEC EDGAR (same source as the fundamentals).

export const TAPE = [
  { ticker: "SPY", name: "S&P 500" },
  { ticker: "QQQ", name: "Nasdaq 100" },
  { ticker: "DIA", name: "Dow Jones" },
  { ticker: "IWM", name: "Russell 2000" },
  { ticker: "SCHD", name: "Dividendos EE. UU." },
  { ticker: "TLT", name: "Bonos 20+ años" },
] as const;

// Largest companies of each GICS sector, plus the sector SPDR ETF. Sizes are computed live,
// so the lists only need to contain the big names, not be ordered or exhaustive.
export const SECTORS = [
  { key: "tech", name: "Tecnología", etf: "XLK", stocks: ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM"] },
  { key: "comm", name: "Comunicaciones", etf: "XLC", stocks: ["GOOGL", "META", "NFLX", "DIS", "T"] },
  { key: "disc", name: "Consumo discrecional", etf: "XLY", stocks: ["AMZN", "TSLA", "HD", "MCD", "NKE"] },
  { key: "staples", name: "Consumo básico", etf: "XLP", stocks: ["WMT", "COST", "PG", "KO", "PEP"] },
  { key: "health", name: "Salud", etf: "XLV", stocks: ["LLY", "UNH", "JNJ", "ABBV", "MRK"] },
  { key: "fin", name: "Financiero", etf: "XLF", stocks: ["BRK-B", "JPM", "V", "MA", "BAC"] },
  { key: "ind", name: "Industriales", etf: "XLI", stocks: ["GE", "CAT", "RTX", "UNP", "HON"] },
  { key: "energy", name: "Energía", etf: "XLE", stocks: ["XOM", "CVX", "COP", "SLB", "EOG"] },
  { key: "util", name: "Servicios públicos", etf: "XLU", stocks: ["NEE", "SO", "DUK", "CEG"] },
  { key: "re", name: "Inmobiliario", etf: "XLRE", stocks: ["PLD", "AMT", "EQIX", "WELL"] },
  { key: "mat", name: "Materiales", etf: "XLB", stocks: ["LIN", "SHW", "FCX", "ECL"] },
] as const;

export type PulseQuote = { ticker: string; price: number; change: number | null };
export type PulseStock = { ticker: string; change: number | null; marketCap: number };
export type PulseSector = { key: string; name: string; etf: string; etfChange: number | null; stocks: PulseStock[] };
export type MarketPulse = {
  updatedAt: string;
  source: string;
  partial: boolean;
  tape: Array<PulseQuote & { name: string }>;
  sectors: PulseSector[];
};

const PULSE_TTL_MS = 5 * 60 * 1000;
const SHARES_TTL_MS = 24 * 3600 * 1000;
let pulseCache: { expiresAt: number; payload: MarketPulse } | null = null;
let inflight: Promise<MarketPulse> | null = null;
const sharesCache = new Map<string, { expiresAt: number; shares: number | null }>();

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchQuote(ticker: string): Promise<PulseQuote | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d&includePrePost=false`,
      { headers: { Accept: "application/json", "User-Agent": "JB-Termometro/1.0" }, signal: controller.signal },
    );
    if (!response.ok) return null;
    const json = (await response.json()) as {
      chart?: { result?: Array<{ meta?: Record<string, unknown>; timestamp?: Array<number | null>; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
    };
    const result = json.chart?.result?.[0];
    const meta = result?.meta ?? {};
    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const bars = timestamps.flatMap((time, index) => (typeof time === "number" && typeof closes[index] === "number" ? [{ time, close: closes[index] as number }] : []));
    const price = Number(meta.regularMarketPrice);
    if (!Number.isFinite(price) || !bars.length) return null;
    // Compare with the last close from a previous session: if the newest bar is today's, use the one before it.
    const marketTime = Number(meta.regularMarketTime);
    const day = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);
    const last = bars[bars.length - 1];
    const sameDay = Number.isFinite(marketTime) && day(last.time) === day(marketTime);
    const previous = sameDay ? bars[bars.length - 2]?.close : last.close;
    const change = typeof previous === "number" && previous > 0 ? Number((((price - previous) / previous) * 100).toFixed(2)) : null;
    return { ticker, price: Number(price.toFixed(2)), change };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function sharesFor(ticker: string): Promise<number | null> {
  const hit = sharesCache.get(ticker);
  if (hit && hit.expiresAt > Date.now()) return hit.shares;
  const shares = await getSecShares(ticker);
  // Do not remember failures for long, so the next request can retry.
  sharesCache.set(ticker, { expiresAt: Date.now() + (shares === null ? 2 * 60 * 1000 : SHARES_TTL_MS), shares });
  return shares;
}

async function buildPulse(): Promise<MarketPulse> {
  const allTickers = [...TAPE.map((row) => row.ticker), ...SECTORS.flatMap((sector) => [sector.etf, ...sector.stocks])];
  const quotes = new Map<string, PulseQuote>();
  (await mapLimit(allTickers, 10, fetchQuote)).forEach((quote) => { if (quote) quotes.set(quote.ticker, quote); });
  const stockTickers = SECTORS.flatMap((sector) => [...sector.stocks]);
  const shares = new Map<string, number | null>();
  (await mapLimit(stockTickers, 5, async (ticker) => [ticker, await sharesFor(ticker)] as const)).forEach(([ticker, value]) => shares.set(ticker, value));

  let partial = false;
  const sectors: PulseSector[] = SECTORS.map((sector) => ({
    key: sector.key,
    name: sector.name,
    etf: sector.etf,
    etfChange: quotes.get(sector.etf)?.change ?? null,
    stocks: sector.stocks.flatMap((ticker) => {
      const quote = quotes.get(ticker);
      const count = shares.get(ticker);
      if (!quote || !count) { partial = true; return []; }
      return [{ ticker, change: quote.change, marketCap: Math.round(quote.price * count) }];
    }),
  }));
  const tape = TAPE.flatMap((row) => { const quote = quotes.get(row.ticker); return quote ? [{ ...quote, name: row.name }] : []; });
  if (tape.length < TAPE.length) partial = true;
  if (!tape.length && !sectors.some((sector) => sector.stocks.length)) throw new Error("Yahoo Finance no devolvió datos utilizables.");
  return { updatedAt: new Date().toISOString(), source: "Yahoo Finance (variación) · SEC EDGAR (acciones en circulación)", partial, tape, sectors };
}

export async function getMarketPulse(): Promise<MarketPulse> {
  if (pulseCache && pulseCache.expiresAt > Date.now()) return pulseCache.payload;
  inflight ??= buildPulse()
    .then((payload) => {
      // A partial result is kept only briefly, so missing names are retried soon.
      pulseCache = { expiresAt: Date.now() + (payload.partial ? 60 * 1000 : PULSE_TTL_MS), payload };
      return payload;
    })
    .catch((error) => { logger.warn({ err: error }, "Market pulse unavailable"); throw error; })
    .finally(() => { inflight = null; });
  return inflight;
}
