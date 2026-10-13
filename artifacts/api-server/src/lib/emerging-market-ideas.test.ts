import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import {
  EMERGING_MARKET_ETF_UNIVERSE,
  EXPENSE_RATIOS_AS_OF,
  compute200SessionReturn,
  computeAvgDollarVolume,
  computeMaxDrawdown,
  computeTrailingDividendYield,
  computeVolatility,
  getEmergingMarketIdeas,
  rankEmergingIdeas,
  resetEmergingMarketIdeasCache,
  scoreIdea,
} from "./emerging-market-ideas.ts";

const candidate = (ticker: string, returnValue: number, overrides: Record<string, unknown> = {}) => ({
  ticker,
  name: ticker,
  region: "Brasil",
  historySessions: 205,
  growthTrend: "Mixta" as "Al alza" | "Mixta" | "A la baja" | null,
  return200Sessions: returnValue as number | null,
  volatility: 20 as number | null,
  maxDrawdown: 0 as number | null,
  dividendYield: null,
  expenseRatio: null as number | null,
  indexStyle: "Capitalización",
  avgDollarVolume: null as number | null,
  peRatio: null,
  profitMargin: null,
  ...overrides,
});

test("calcula el retorno de exactamente las últimas 200 sesiones y deja null si faltan", () => {
  const closes = Array.from({ length: 205 }, (_, index) => index + 1);
  assert.equal(compute200SessionReturn(closes), Number(((205 - 6) / 6 * 100).toFixed(2)));
  assert.equal(compute200SessionReturn(closes.slice(0, 199)), null);
});

test("mide la caída máxima dentro de la ventana de 200 sesiones", () => {
  const closes = [...Array.from({ length: 100 }, () => 100), ...Array.from({ length: 50 }, () => 80), ...Array.from({ length: 50 }, () => 90)];
  assert.equal(computeMaxDrawdown(closes), 20);
  assert.equal(computeMaxDrawdown(closes.slice(0, 199)), null);
  assert.equal(computeMaxDrawdown(Array.from({ length: 200 }, (_, index) => 100 + index)), 0);
});

test("la volatilidad es cero con precio plano y positiva cuando el precio oscila", () => {
  assert.equal(computeVolatility(Array.from({ length: 200 }, () => 50)), 0);
  const zigzag = Array.from({ length: 200 }, (_, index) => (index % 2 === 0 ? 100 : 102));
  assert.ok((computeVolatility(zigzag) ?? 0) > 10);
  assert.equal(computeVolatility(zigzag.slice(0, 150)), null);
});

test("el rendimiento por dividendo suma solo los últimos 12 meses", () => {
  const last = 1_700_000_000;
  const day = 86_400;
  const dividends = [
    { amount: 1, date: last - 30 * day },
    { amount: 1, date: last - 300 * day },
    { amount: 5, date: last - 400 * day },
  ];
  assert.equal(computeTrailingDividendYield(dividends, 100, last), 2);
  assert.equal(computeTrailingDividendYield([], 100, last), null);
  assert.equal(computeTrailingDividendYield(dividends, undefined, last), null);
});

test("el volumen diario promedio usa las últimas 30 sesiones y exige al menos 20", () => {
  assert.equal(computeAvgDollarVolume(Array.from({ length: 19 }, () => 1_000_000)), null);
  const values = [...Array.from({ length: 100 }, () => 9_000_000), ...Array.from({ length: 30 }, () => 2_000_000)];
  assert.equal(computeAvgDollarVolume(values), 2_000_000);
});

test("el costo y la poca liquidez restan puntos", () => {
  assert.equal(scoreIdea(candidate("AAA", 20, { expenseRatio: 0.2 })), 70);
  assert.equal(scoreIdea(candidate("AAA", 20, { expenseRatio: 0.09 })), 70);
  assert.equal(scoreIdea(candidate("AAA", 20, { expenseRatio: 0.72 })), 64.8);
  assert.equal(scoreIdea(candidate("AAA", 20, { expenseRatio: 5 })), 62);
  assert.equal(scoreIdea(candidate("AAA", 20, { avgDollarVolume: 9_999_999 })), 65);
  assert.equal(scoreIdea(candidate("AAA", 20, { avgDollarVolume: 10_000_000 })), 70);
});

test("el puntaje suma retorno y tendencia y resta la caída máxima", () => {
  assert.equal(scoreIdea(candidate("AAA", 20)), 70);
  assert.equal(scoreIdea(candidate("AAA", 20, { growthTrend: "Al alza" })), 80);
  assert.equal(scoreIdea(candidate("AAA", 20, { growthTrend: "A la baja" })), 60);
  assert.equal(scoreIdea(candidate("AAA", 20, { maxDrawdown: 10 })), 65);
  assert.equal(scoreIdea(candidate("AAA", 20, { maxDrawdown: 90 })), 50);
  assert.equal(scoreIdea(candidate("AAA", 500)), 100);
  assert.equal(scoreIdea(candidate("AAA", 20, { historySessions: 199 })), null);
  assert.equal(scoreIdea(candidate("AAA", 0, { return200Sessions: null })), null);
});

test("ordena todo junto sin mirar la región: cinco fondos del mismo país entran los cinco", () => {
  const ideas = rankEmergingIdeas([
    candidate("BR1", 30), candidate("BR2", 25), candidate("BR3", 20), candidate("BR4", 15), candidate("BR5", 10),
    candidate("IN1", 5, { region: "India" }),
  ]);
  assert.deepEqual(ideas.map((idea) => idea.ticker), ["BR1", "BR2", "BR3", "BR4", "BR5", "IN1"]);
  assert.equal(ideas.every((idea) => idea.region === "Brasil" || idea.ticker === "IN1"), true);
  assert.deepEqual(ideas.map((idea) => idea.rank), [1, 2, 3, 4, 5, 6]);
});

test("limita a veinte, excluye los fondos sin 200 sesiones y desempata por menor caída y luego por ticker", () => {
  const many = Array.from({ length: 25 }, (_, index) => candidate(`T${String(index).padStart(2, "0")}`, 40 - index));
  const ideas = rankEmergingIdeas([
    ...many,
    candidate("NEW", 90, { historySessions: 199, return200Sessions: null }),
  ]);
  assert.equal(ideas.length, 20);
  assert.equal(ideas.some((idea) => idea.ticker === "NEW"), false);

  const tied = rankEmergingIdeas([
    candidate("ZZZ", 20, { maxDrawdown: 4 }),
    candidate("AAA", 20, { maxDrawdown: 10 }),
    candidate("MMM", 20, { maxDrawdown: 4 }),
  ]);
  // 20 + 50 - 2 = 68 for ZZZ and MMM, 20 + 50 - 5 = 65 for AAA.
  assert.deepEqual(tied.map((idea) => idea.ticker), ["MMM", "ZZZ", "AAA"]);
});

test("el universo no repite tickers, trae ratio de gastos y estilo válidos y cubre varias regiones", () => {
  const tickers = EMERGING_MARKET_ETF_UNIVERSE.map((entry) => entry.ticker);
  assert.equal(new Set(tickers).size, tickers.length);
  assert.equal(EMERGING_MARKET_ETF_UNIVERSE.every((entry) => typeof entry.expenseRatio === "number" && entry.expenseRatio > 0 && entry.expenseRatio < 2), true);
  assert.equal(EMERGING_MARKET_ETF_UNIVERSE.every((entry) => entry.style === "Capitalización" || entry.style === "Reglas propias"), true);
  const byTicker = new Map(EMERGING_MARKET_ETF_UNIVERSE.map((entry) => [entry.ticker, entry]));
  assert.equal(byTicker.get("EEM")?.expenseRatio, 0.72);
  assert.equal(byTicker.get("EEM")?.category, "cap-weighted");
  assert.equal(byTicker.get("FNDE")?.category, "smart-beta");
  assert.equal(byTicker.get("FNDE")?.style, "Reglas propias");
  assert.equal(byTicker.get("DEM")?.category, "dividend");
  assert.equal(byTicker.get("DEM")?.style, "Reglas propias");
  assert.equal(byTicker.get("EMXC")?.style, "Capitalización");
  assert.match(EXPENSE_RATIOS_AS_OF, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(new Set(EMERGING_MARKET_ETF_UNIVERSE.map((entry) => entry.region)).size >= 15);
});

test("usa la caché de 24 horas para no repetir la evaluación pública", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jb-emerging-ideas-"));
  const previousPath = process.env.EMERGING_MARKET_IDEAS_CACHE_PATH;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  process.env.EMERGING_MARKET_IDEAS_CACHE_PATH = path.join(directory, "ideas.json");
  globalThis.fetch = async (url: string | URL) => {
    calls += 1;
    const count = 205;
    const start = 1_700_000_000;
    const lastTimestamp = start + (count - 1) * 86_400;
    return new Response(JSON.stringify({
      chart: {
        result: [{
          meta: { longName: "ETF de prueba" },
          timestamp: Array.from({ length: count }, (_, index) => start + index * 86_400),
          events: { dividends: { [String(lastTimestamp - 86_400)]: { amount: 2, date: lastTimestamp - 86_400 } } },
          indicators: { quote: [{ close: Array.from({ length: count }, (_, index) => 100 + index), volume: Array.from({ length: count }, () => 100_000) }] },
        }],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    resetEmergingMarketIdeasCache();
    const first = await getEmergingMarketIdeas(true);
    const callsAfterFirst = calls;
    const second = await getEmergingMarketIdeas();
    assert.equal(first.ideas.length, 20);
    assert.equal(first.candidatesEvaluated, EMERGING_MARKET_ETF_UNIVERSE.length);
    assert.equal(first.expenseRatiosAsOf, EXPENSE_RATIOS_AS_OF);
    assert.equal(first.ideas[0].dividendYield, Number(((2 / 304) * 100).toFixed(2)));
    assert.equal(first.ideas[0].maxDrawdown, 0);
    assert.equal(first.ideas.every((idea) => idea.avgDollarVolume !== null && idea.avgDollarVolume > 10_000_000), true);
    assert.equal(first.ideas.every((idea) => typeof idea.indexStyle === "string"), true);
    assert.equal(second.cached, true);
    assert.equal(calls, callsAfterFirst);
  } finally {
    globalThis.fetch = originalFetch;
    resetEmergingMarketIdeasCache();
    if (previousPath === undefined) delete process.env.EMERGING_MARKET_IDEAS_CACHE_PATH;
    else process.env.EMERGING_MARKET_IDEAS_CACHE_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});
