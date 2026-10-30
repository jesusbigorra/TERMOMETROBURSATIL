// Cálculos del portafolio. Funciones puras: reciben posiciones e historiales
// diarios (los de /api/market/history/:ticker) y devuelven series y métricas.
// Convención: el valor de hoy usa el último cierre; el pasado se reconstruye con
// las posiciones actuales sobre el cierre ajustado (dividendos reinvertidos).

export type History = { ticker: string; dates: string[]; close: number[]; adjClose: number[] };
export type Holding = { ticker: string; units: number; avgCost: number | null };
export type Point = { date: string; value: number };

export const RANGES = ["1S", "1M", "3M", "1A", "5A", "Máx"] as const;
export type Range = (typeof RANGES)[number];

const TRADING_DAYS = 252;

function lastFinite(values: number[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (Number.isFinite(values[i]) && values[i] > 0) return values[i];
  return null;
}

/** Valor diario del portafolio en las fechas que comparten todas las posiciones. */
export function buildValueSeries(holdings: Holding[], histories: History[]): Point[] {
  const used = holdings
    .map((holding) => ({ holding, history: histories.find((h) => h.ticker === holding.ticker) }))
    .filter((item): item is { holding: Holding; history: History } => Boolean(item.history && item.history.dates.length));
  if (!used.length) return [];
  const maps = used.map(({ holding, history }) => {
    const lastClose = lastFinite(history.close);
    const lastAdj = lastFinite(history.adjClose);
    const byDate = new Map<string, number>();
    if (lastClose && lastAdj) {
      history.dates.forEach((date, i) => {
        const adj = history.adjClose[i];
        if (Number.isFinite(adj) && adj > 0) byDate.set(date, holding.units * lastClose * (adj / lastAdj));
      });
    }
    return byDate;
  });
  const [first, ...rest] = maps;
  const dates = [...first.keys()].filter((date) => rest.every((map) => map.has(date))).sort();
  return dates.map((date) => ({ date, value: maps.reduce((sum, map) => sum + (map.get(date) ?? 0), 0) }));
}

/** Serie de un solo activo (cierre ajustado) para compararla, p. ej. SPY. */
export function buildBenchmarkSeries(history: History | undefined): Point[] {
  if (!history) return [];
  return history.dates.flatMap((date, i) => (Number.isFinite(history.adjClose[i]) && history.adjClose[i] > 0 ? [{ date, value: history.adjClose[i] }] : []));
}

export function rangeStart(range: Range, lastDate: string): string | null {
  if (range === "Máx") return null;
  const d = new Date(`${lastDate}T00:00:00Z`);
  if (range === "1S") d.setUTCDate(d.getUTCDate() - 7);
  else if (range === "1M") d.setUTCMonth(d.getUTCMonth() - 1);
  else if (range === "3M") d.setUTCMonth(d.getUTCMonth() - 3);
  else if (range === "1A") d.setUTCFullYear(d.getUTCFullYear() - 1);
  else d.setUTCFullYear(d.getUTCFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

/** Puntos desde la fecha de inicio. Incluye el último cierre anterior como base. */
export function sliceRange(series: Point[], range: Range): Point[] {
  if (series.length < 2) return series;
  const start = rangeStart(range, series[series.length - 1].date);
  if (!start) return series;
  const firstIndex = series.findIndex((point) => point.date >= start);
  if (firstIndex < 0) return series.slice(-2);
  return series.slice(Math.max(0, firstIndex - 1));
}

/** Reescala una serie para que arranque en `base` (para superponer el S&P 500). */
export function rebase(series: Point[], base: number): Point[] {
  if (!series.length) return [];
  const factor = base / series[0].value;
  return series.map((point) => ({ date: point.date, value: point.value * factor }));
}

export function periodReturn(series: Point[]): number | null {
  if (series.length < 2) return null;
  return series[series.length - 1].value / series[0].value - 1;
}

export function dailyReturns(series: Point[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) out.push(series[i].value / series[i - 1].value - 1);
  return out;
}

export function volatility(returns: number[]): number | null {
  if (returns.length < 20) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS);
}

/** Beta contra el benchmark, alineando por fecha. */
export function beta(portfolio: Point[], benchmark: Point[]): number | null {
  const bench = new Map(benchmark.map((p) => [p.date, p.value]));
  const pairs: Array<[number, number]> = [];
  for (let i = 1; i < portfolio.length; i++) {
    const b0 = bench.get(portfolio[i - 1].date);
    const b1 = bench.get(portfolio[i].date);
    if (b0 && b1) pairs.push([portfolio[i].value / portfolio[i - 1].value - 1, b1 / b0 - 1]);
  }
  if (pairs.length < 60) return null;
  const mp = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
  const mb = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
  let cov = 0;
  let varB = 0;
  for (const [p, b] of pairs) {
    cov += (p - mp) * (b - mb);
    varB += (b - mb) ** 2;
  }
  return varB > 0 ? cov / varB : null;
}

export type Drawdown = { series: Array<{ date: string; value: number }>; max: number; current: number; maxDate: string | null };

/** Caída respecto al máximo previo, día a día (valores ≤ 0). */
export function drawdown(series: Point[]): Drawdown {
  let peak = -Infinity;
  let max = 0;
  let maxDate: string | null = null;
  const out = series.map((point) => {
    peak = Math.max(peak, point.value);
    const value = point.value / peak - 1;
    if (value < max) {
      max = value;
      maxDate = point.date;
    }
    return { date: point.date, value };
  });
  return { series: out, max, current: out.length ? out[out.length - 1].value : 0, maxDate };
}

export function bestWorstDay(returns: number[]): { best: number; worst: number } | null {
  if (!returns.length) return null;
  return { best: Math.max(...returns), worst: Math.min(...returns) };
}

/** Rendimiento por año natural; el año en curso es lo que va hasta hoy. */
export function annualReturns(series: Point[]): Array<{ year: number; value: number }> {
  const lastOfYear = new Map<number, number>();
  const firstOfYear = new Map<number, number>();
  for (const point of series) {
    const year = Number(point.date.slice(0, 4));
    if (!firstOfYear.has(year)) firstOfYear.set(year, point.value);
    lastOfYear.set(year, point.value);
  }
  const years = [...lastOfYear.keys()].sort((a, b) => a - b);
  const out: Array<{ year: number; value: number }> = [];
  years.forEach((year, i) => {
    // Base: cierre del año anterior; en el primer año, el primer dato disponible.
    const base = i === 0 ? firstOfYear.get(year)! : lastOfYear.get(years[i - 1])!;
    out.push({ year, value: lastOfYear.get(year)! / base - 1 });
  });
  return out;
}

export type Weighted = { ticker: string; value: number; weight: number };

export function weights(items: Array<{ ticker: string; value: number }>): Weighted[] {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return items
    .map((item) => ({ ...item, weight: total > 0 ? item.value / total : 0 }))
    .sort((a, b) => b.weight - a.weight);
}

/** Número efectivo de posiciones: 1 / Σ w². Con 6 posiciones iguales vale 6. */
export function effectivePositions(w: Weighted[]): number | null {
  const sumSquares = w.reduce((sum, item) => sum + item.weight ** 2, 0);
  return sumSquares > 0 ? 1 / sumSquares : null;
}

export function concentrationLabel(effective: number | null, count: number): string {
  if (!effective || count === 0) return "—";
  const ratio = effective / count;
  if (count === 1) return "Una sola posición";
  if (effective < 3) return "Muy concentrada";
  if (effective < 5) return ratio < 0.65 ? "Concentrada" : "Moderada";
  if (effective < 10) return "Moderada";
  return "Amplia";
}

export function riskLabel(vol: number | null): { label: string; level: number } {
  if (vol === null) return { label: "—", level: 0 };
  if (vol < 0.08) return { label: "Bajo", level: 1 };
  if (vol < 0.12) return { label: "Medio-bajo", level: 2 };
  if (vol < 0.18) return { label: "Medio", level: 3 };
  if (vol < 0.26) return { label: "Alto", level: 4 };
  return { label: "Muy alto", level: 5 };
}
