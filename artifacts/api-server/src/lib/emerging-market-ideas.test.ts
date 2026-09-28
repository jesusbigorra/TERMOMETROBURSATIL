import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import {
  compute200SessionReturn,
  getEmergingMarketIdeas,
  rankEmergingIdeas,
  resetEmergingMarketIdeasCache,
} from "./emerging-market-ideas.ts";

const baseCandidate = (ticker: string, score: number) => ({
  ticker,
  name: ticker,
  historySessions: 205,
  growthTrend: score > 0 ? "Al alza" as const : "Mixta" as const,
  return200Sessions: score,
  dividendYield: null,
  peRatio: null,
  profitMargin: null,
});

test("calcula el retorno de exactamente las últimas 200 sesiones y deja null si faltan", () => {
  const closes = Array.from({ length: 205 }, (_, index) => index + 1);
  assert.equal(compute200SessionReturn(closes), Number(((205 - 6) / 6 * 100).toFixed(2)));
  assert.equal(compute200SessionReturn(closes.slice(0, 199)), null);
});

test("ordena las ideas por score, permite repetir ganadores y limita a cinco", () => {
  const ideas = rankEmergingIdeas([
    baseCandidate("AAA", 1),
    baseCandidate("BBB", 50),
    baseCandidate("CCC", 10),
    baseCandidate("DDD", 20),
    baseCandidate("EEE", 30),
    baseCandidate("FFF", 40),
    { ...baseCandidate("GGG", 90), historySessions: 199, return200Sessions: null },
  ]);
  assert.equal(ideas.length, 5);
  assert.deepEqual(ideas.map((idea) => idea.ticker), ["BBB", "FFF", "EEE", "DDD", "CCC"]);
  assert.equal(ideas.every((idea) => idea.rank !== null), true);
});

test("usa la caché de 24 horas para no repetir la evaluación pública", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jb-emerging-ideas-"));
  const previousPath = process.env.EMERGING_MARKET_IDEAS_CACHE_PATH;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  process.env.EMERGING_MARKET_IDEAS_CACHE_PATH = path.join(directory, "ideas.json");
  globalThis.fetch = async (url: string | URL) => {
    calls += 1;
    if (String(url).includes("/chart/")) {
      const count = 205;
      return new Response(JSON.stringify({
        chart: {
          result: [{
            meta: { longName: "ETF de prueba" },
            timestamp: Array.from({ length: count }, (_, index) => 1_700_000_000 + index * 86_400),
            indicators: { quote: [{ close: Array.from({ length: count }, (_, index) => 100 + index) }] },
          }],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ quoteSummary: { result: [{}] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    resetEmergingMarketIdeasCache();
    const first = await getEmergingMarketIdeas(true);
    const callsAfterFirst = calls;
    const second = await getEmergingMarketIdeas();
    assert.equal(first.ideas.length, 5);
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