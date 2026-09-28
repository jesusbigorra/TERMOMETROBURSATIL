import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { computeSignal, fetchTicker, getMarketRadar, resetMarketRadarMemoryCache } from "./market-data.ts";

type YahooChartPayload = {
  chart: {
    result: Array<{
      meta: Record<string, unknown>;
      timestamp: Array<number | null>;
      indicators: { quote: Array<{ close: Array<number | null> }> };
    }>;
  };
};

function makeYahooPayload(options: { count?: number; missingCloseIndex?: number; missingTimestampIndex?: number; droppedTimestampIndex?: number } = {}): YahooChartPayload {
  const count = options.count ?? 205;
  const timestamp: Array<number | null> = Array.from({ length: count }, (_, index) => 1_700_000_000 + index * 86_400);
  const close: Array<number | null> = Array.from({ length: count }, (_, index) => 100 + index * 0.5 + (index % 7) * 0.13);
  if (options.missingCloseIndex !== undefined) close[options.missingCloseIndex] = null;
  if (options.missingTimestampIndex !== undefined) timestamp[options.missingTimestampIndex] = null;
  if (options.droppedTimestampIndex !== undefined) timestamp.splice(options.droppedTimestampIndex, 1);

  return {
    chart: {
      result: [{
        meta: {
          longName: "Instrumento de prueba",
          instrumentType: "ETF",
        },
        timestamp,
        indicators: { quote: [{ close }] },
      }],
    },
  };
}

async function fetchWithPayload(payload: YahooChartPayload) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  try {
    return await fetchTicker("TEST");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("mantiene fecha y cierre alineados cuando Yahoo omite cierres o fechas", async () => {
  const payload = makeYahooPayload({ missingCloseIndex: 5, missingTimestampIndex: 10 });
  const asset = await fetchWithPayload(payload);
  const history = asset.history;

  assert.equal(history.length, 203);
  const expectedRows = payload.chart.result[0].indicators.quote[0].close.flatMap((close, index) => {
    const timestamp = payload.chart.result[0].timestamp[index];
    if (typeof close !== "number" || typeof timestamp !== "number") return [];
    return [{
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close: Number(close.toFixed(2)),
    }];
  });
  assert.deepEqual(history.map(({ date, close }) => ({ date, close })), expectedRows);

  for (const [key, window] of [
    ["sma20", 20],
    ["sma50", 50],
    ["sma100", 100],
    ["sma200", 200],
  ] as const) {
    assert.equal(history[window - 2][key], null);
    assert.notEqual(history[window - 1][key], null);
  }
});

test("rechaza un histórico con una fecha eliminada para no desplazar cierres posteriores", async () => {
  const payload = makeYahooPayload({ droppedTimestampIndex: 10 });

  await assert.rejects(
    fetchWithPayload(payload),
    /histórico desalineado: Yahoo devolvió distinta cantidad de fechas y cierres/,
  );
});

test("hace coincidir las SMA finales del histórico con las SMA de la lectura JB", async () => {
  const asset = await fetchWithPayload(makeYahooPayload());
  const lastPoint = asset.history.at(-1);

  assert.ok(lastPoint);
  assert.equal(lastPoint.sma20, asset.sma20);
  assert.equal(lastPoint.sma50, asset.sma50);
  assert.equal(lastPoint.sma100, asset.sma100);
  assert.equal(lastPoint.sma200, asset.sma200);
});

test("acepta históricos cortos y deja pendiente el cálculo JB completo", async () => {
  const asset = await fetchWithPayload(makeYahooPayload({ count: 30 }));

  assert.equal(asset.historyDays, 30);
  assert.equal(asset.signal, "Sin cálculo JB");
  assert.equal(asset.level, null);
  assert.equal(asset.sma20 !== null, true);
  assert.equal(asset.sma50, null);
  assert.equal(asset.sma200, null);
  assert.equal(asset.rsi !== null, true);
  assert.equal(asset.sparkline.length, 20);
});

test("solo marca oportunidad de compra DCA cuando el RSI está entre 30 y 40", () => {
  const closes = Array.from({ length: 200 }, () => 100);
  const dcaSignal = computeSignal(95, closes, 35);
  const higherRsiSignal = computeSignal(95, closes, 54);
  const oversoldSignal = computeSignal(95, closes, 25);

  assert.equal(dcaSignal.signal, "Interesante");
  assert.equal(higherRsiSignal.signal, "A considerar");
  assert.equal(oversoldSignal.signal, "A considerar");
});

test("sirve la última lectura después de un reinicio de memoria y respuestas 429 de Yahoo", async () => {
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), "jb-market-radar-"));
  const previousCachePath = process.env.MARKET_RADAR_CACHE_PATH;
  const originalFetch = globalThis.fetch;
  let shouldRateLimit = false;
  process.env.MARKET_RADAR_CACHE_PATH = path.join(cacheDirectory, "radar.json");
  globalThis.fetch = async () => {
    if (shouldRateLimit) {
      return new Response("Too Many Requests", { status: 429 });
    }
    return new Response(JSON.stringify(makeYahooPayload()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    resetMarketRadarMemoryCache();
    const freshRadar = await getMarketRadar(true);
    resetMarketRadarMemoryCache();
    shouldRateLimit = true;

    const fallbackRadar = await getMarketRadar(true);

    assert.equal(fallbackRadar.stale, true);
    assert.equal(fallbackRadar.cached, true);
    assert.equal(fallbackRadar.marketStatus, "Mercado · última lectura disponible");
    assert.equal(fallbackRadar.source, "Yahoo Finance · histórico diario");
    assert.equal(fallbackRadar.updatedAt, freshRadar.updatedAt);
    assert.equal(fallbackRadar.assets.length, freshRadar.assets.length);
    assert.match(fallbackRadar.errors[0], /Yahoo Finance no está disponible temporalmente/);
    assert.match(fallbackRadar.errors[0], /429/);
  } finally {
    globalThis.fetch = originalFetch;
    resetMarketRadarMemoryCache();
    if (previousCachePath === undefined) delete process.env.MARKET_RADAR_CACHE_PATH;
    else process.env.MARKET_RADAR_CACHE_PATH = previousCachePath;
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});