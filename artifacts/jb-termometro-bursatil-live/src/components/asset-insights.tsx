import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// ---------- Types (mirror of GET /api/market/analysis/:ticker) ----------
type AnalysisPoint = { date: string; close: number; adjClose: number; volume: number | null; sma20: number | null; sma50: number | null; sma100: number | null; sma200: number | null; drawdown: number };
type PeriodReturn = { key: string; label: string; startDate: string | null; totalReturn: number | null; priceReturn: number | null; cagr: number | null; benchmarkReturn: number | null; benchmarkCagr: number | null };
type RiskWindow = { key: string; label: string; volatility: number | null; maxDrawdown: number | null; maxDrawdownDate: string | null; cagr: number | null; sharpe: number | null; beta: number | null; correlation: number | null; benchmarkVolatility: number | null; benchmarkMaxDrawdown: number | null };
export type AssetAnalysis = {
  ticker: string; name: string; type: string; currency: string | null; updatedAt: string; benchmark: string; riskFreeRate: number | null; firstDate: string | null;
  history: AnalysisPoint[]; benchmarkHistory: Array<{ date: string; adjClose: number }>; periods: PeriodReturn[]; risk: RiskWindow[];
  currentDrawdown: number | null; bestDay: { date: string; change: number } | null; worstDay: { date: string; change: number } | null;
  dividends: Array<{ date: string; amount: number }>; trailingDividends: number | null;
  fundamentals: Record<string, number | string | null>; topHoldings: Array<{ symbol: string | null; name: string; weight: number }>; sectorWeights: Array<{ sector: string; weight: number }>;
  errors: string[];
};
type BasicPoint = { date: string; close: number; sma20: number | null; sma50: number | null; sma100: number | null; sma200: number | null };

// ---------- Formatting ----------
const COLORS = { coral: "#e46442", teal: "#2e887f", sky: "#3b8daf", amber: "#d89b36", red: "#be554a", fg: "hsl(var(--foreground))", muted: "hsl(var(--muted-foreground))", grid: "hsl(var(--border))" };
const TOOLTIP_STYLE = { borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 11, background: "hsl(var(--card))", color: "hsl(var(--foreground))" };
const n = (value: number | null | undefined, decimals = 2) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString("es-VE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const pct = (value: number | null | undefined, decimals = 2, signed = true) => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${signed && value > 0 ? "+" : ""}${n(value, decimals)}%`;
const money = (value: number | null | undefined) => value === null || value === undefined ? "—" : `$${n(value, 2)}`;
function big(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${n(value / 1e12, 2)} B`; // billones (es)
  if (abs >= 1e9) return `$${n(value / 1e9, 1)} mil M`;
  if (abs >= 1e6) return `$${n(value / 1e6, 1)} M`;
  return `$${n(value, 0)}`;
}
const shortDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });

// ---------- Tones ----------
type Tone = "good" | "neutral" | "bad" | "info";
const TONE_CLASS: Record<Tone, string> = {
  good: "border-teal-600/30 bg-teal-600/[.07]",
  neutral: "border-amber-500/30 bg-amber-500/[.07]",
  bad: "border-red-600/30 bg-red-600/[.07]",
  info: "border-card-border bg-card",
};
const TONE_LABEL: Record<Tone, string> = { good: "Favorable", neutral: "Neutral", bad: "Atención", info: "Contexto" };
const TONE_DOT: Record<Tone, string> = { good: "bg-teal-600", neutral: "bg-amber-500", bad: "bg-red-600", info: "bg-slate-400" };
function band(value: number | null | undefined, goodIf: (v: number) => boolean, badIf: (v: number) => boolean): Tone {
  if (value === null || value === undefined || !Number.isFinite(value)) return "info";
  return goodIf(value) ? "good" : badIf(value) ? "bad" : "neutral";
}

function Metric({ label, value, note, tone = "info" }: { label: string; value: string; note: string; tone?: Tone }) {
  return <div className={`rounded-xl border px-3 py-2.5 ${TONE_CLASS[tone]}`}>
    <div className="flex items-start justify-between gap-2">
      <p className="text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">{label}</p>
      {tone !== "info" && <span className="flex shrink-0 items-center gap-1 text-[9px] font-bold text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />{TONE_LABEL[tone]}</span>}
    </div>
    <p className="mt-1 font-mono-app text-base font-bold">{value}</p>
    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{note}</p>
  </div>;
}

function Section({ title, subtitle, children, right }: { title: string; subtitle?: string; children: ReactNode; right?: ReactNode }) {
  return <section className="mt-4 rounded-2xl border border-card-border bg-secondary/30 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold">{title}</p>{subtitle && <p className="mt-0.5 max-w-lg text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>}</div>{right}</div>
    {children}
  </section>;
}

// Keep charts light on long periods: at most ~420 points, always keeping the last one.
function thin<T>(rows: T[], max = 420): T[] {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  const out = rows.filter((_, index) => index % step === 0);
  if (out.at(-1) !== rows.at(-1)) out.push(rows.at(-1)!);
  return out;
}

const PERIOD_KEYS = ["1M", "3M", "6M", "YTD", "1A", "3A", "5A"] as const;
type PeriodKey = (typeof PERIOD_KEYS)[number];

function startFor(analysis: AssetAnalysis | undefined, period: PeriodKey, fallback: BasicPoint[]): string | null {
  const fromApi = analysis?.periods.find((item) => item.key === period)?.startDate;
  if (fromApi) return fromApi;
  if (period === "1A" && fallback.length) return fallback[0].date;
  return null;
}

// ---------- DCA simulator ----------
type DcaResult = { invested: number; value: number; gain: number; lumpValue: number; lumpGain: number; irr: number | null; lumpCagr: number | null; avgCostVsNow: number; purchases: number; series: Array<{ date: string; invested: number; value: number; lump: number }> };

function xirr(flows: Array<{ date: string; amount: number }>): number | null {
  const t0 = Date.parse(flows[0].date);
  const years = flows.map((flow) => (Date.parse(flow.date) - t0) / (365.25 * 86_400_000));
  const npv = (rate: number) => flows.reduce((sum, flow, index) => sum + flow.amount / Math.pow(1 + rate, years[index]), 0);
  let low = -0.99;
  let high = 10;
  if (npv(low) * npv(high) > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (npv(low) * npv(mid) <= 0) high = mid; else low = mid;
  }
  return ((low + high) / 2) * 100;
}

function simulateDca(history: AnalysisPoint[], months: number, amount: number): DcaResult | null {
  if (!history.length || amount <= 0) return null;
  const last = history.at(-1)!;
  const startLimit = new Date(`${last.date}T00:00:00Z`);
  startLimit.setUTCMonth(startLimit.getUTCMonth() - months);
  const start = startLimit.toISOString().slice(0, 10);
  if (history[0].date > start) return null;
  const window = history.filter((point) => point.date >= start);
  // First trading day of each calendar month.
  const buys: AnalysisPoint[] = [];
  let lastMonth = "";
  for (const point of window) {
    const month = point.date.slice(0, 7);
    if (month !== lastMonth) { buys.push(point); lastMonth = month; }
  }
  if (buys.length < 2) return null;
  let units = 0;
  let invested = 0;
  const total = amount * buys.length;
  const lumpUnits = total / buys[0].adjClose;
  const buyDates = new Set(buys.map((buy) => buy.date));
  const series: DcaResult["series"] = [];
  for (const point of window) {
    if (buyDates.has(point.date)) { units += amount / point.adjClose; invested += amount; }
    series.push({ date: point.date, invested: Number(invested.toFixed(2)), value: Number((units * point.adjClose).toFixed(2)), lump: Number((lumpUnits * point.adjClose).toFixed(2)) });
  }
  const value = units * last.adjClose;
  const lumpValue = lumpUnits * last.adjClose;
  const flows = [...buys.map((buy) => ({ date: buy.date, amount: -amount })), { date: last.date, amount: value }];
  const years = (Date.parse(last.date) - Date.parse(buys[0].date)) / (365.25 * 86_400_000);
  const avgCost = invested / units;
  return {
    invested, value, gain: (value / invested - 1) * 100, lumpValue, lumpGain: (lumpValue / total - 1) * 100,
    irr: xirr(flows), lumpCagr: years >= 0.98 ? (Math.pow(lumpValue / total, 1 / years) - 1) * 100 : null,
    avgCostVsNow: (avgCost / last.adjClose - 1) * 100, purchases: buys.length, series,
  };
}

function DcaSimulator({ history, loading }: { history: AnalysisPoint[]; loading: boolean }) {
  const [months, setMonths] = useState(36);
  const [amount, setAmount] = useState(100);
  const result = useMemo(() => simulateDca(history, months, amount), [history, months, amount]);
  const options = [{ months: 12, label: "1 año" }, { months: 36, label: "3 años" }, { months: 60, label: "5 años" }];
  return <Section title="Simulador DCA" subtitle="Compra el primer día hábil de cada mes con dividendos reinvertidos (precio ajustado). Compara con invertir todo el mismo monto el primer día.">
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 rounded-xl border border-card-border bg-card px-3 py-1.5 text-xs">
        <span className="text-muted-foreground">Aporte mensual $</span>
        <input type="number" min={1} step={10} value={amount} onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))} className="w-20 bg-transparent font-mono-app font-bold outline-none" aria-label="Aporte mensual en dólares" />
      </label>
      <div className="flex rounded-xl border border-card-border bg-card p-0.5">{options.map((option) => <button key={option.months} type="button" onClick={() => setMonths(option.months)} className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors ${months === option.months ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{option.label}</button>)}</div>
    </div>
    {loading ? <div className="mt-3 h-40 animate-pulse rounded-xl bg-card" /> : !result ? <p className="mt-3 rounded-xl bg-card px-3 py-3 text-xs text-muted-foreground">No hay historia suficiente para simular {months / 12} año{months > 12 ? "s" : ""} con este activo.</p> : <>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Aportado" value={money(result.invested)} note={`${result.purchases} compras mensuales`} />
        <Metric label="Valor hoy (DCA)" value={money(result.value)} note={`${pct(result.gain)} sobre lo aportado`} tone={band(result.gain, (v) => v > 0, (v) => v < 0)} />
        <Metric label="Rendimiento anual DCA" value={pct(result.irr)} note="Tasa interna de retorno de tus aportes (TIR)" tone={band(result.irr, (v) => v >= 7, (v) => v < 0)} />
        <Metric label="Todo de golpe" value={money(result.lumpValue)} note={`${pct(result.lumpGain)} · ${result.lumpCagr === null ? "menos de 1 año" : `${pct(result.lumpCagr)} anual`}`} />
      </div>
      <p className="mt-2 rounded-xl bg-card px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Tu costo promedio quedó <strong className="text-foreground">{pct(Math.abs(result.avgCostVsNow), 1, false)} {result.avgCostVsNow <= 0 ? "por debajo" : "por encima"}</strong> del precio actual.{" "}
        {result.value >= result.lumpValue ? "En este tramo el DCA superó a invertir todo de golpe: los aportes se beneficiaron de las caídas." : "En este tramo invertir todo de golpe habría rendido más: el activo subió de forma sostenida y el DCA compró cada vez más caro."}
      </p>
      <div className="mt-3 h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={thin(result.series, 300)} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.grid} strokeDasharray="2 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 9, fill: COLORS.muted }} axisLine={false} tickLine={false} minTickGap={40} />
            <YAxis tick={{ fontSize: 9, fill: COLORS.muted, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} width={52} tickFormatter={(value) => `$${n(Number(value), 0)}`} />
            <Tooltip labelFormatter={(label) => shortDate(String(label))} formatter={(value: number, name: string) => [money(value), name]} contentStyle={TOOLTIP_STYLE} />
            <Legend verticalAlign="top" align="right" iconType="plainline" wrapperStyle={{ fontSize: 10, paddingBottom: 6 }} />
            <Area type="stepAfter" dataKey="invested" name="Aportado" stroke={COLORS.muted} strokeDasharray="4 3" fill={COLORS.muted} fillOpacity={0.08} strokeWidth={1.5} isAnimationActive={false} />
            <Line type="monotone" dataKey="value" name="Valor DCA" stroke={COLORS.coral} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="lump" name="Todo de golpe" stroke={COLORS.teal} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>}
  </Section>;
}

// ---------- Risk lens ----------
function RiskLens({ analysis, period, history }: { analysis: AssetAnalysis; period: PeriodKey; history: AnalysisPoint[] }) {
  const oneYear = analysis.risk.find((item) => item.key === "1A");
  const longest = [...analysis.risk].reverse().find((item) => item.maxDrawdown !== null) ?? oneYear;
  const relative = useMemo(() => {
    if (!history.length || !analysis.benchmarkHistory.length) return [];
    const bench = new Map(analysis.benchmarkHistory.map((point) => [point.date, point.adjClose]));
    const base = history[0].adjClose;
    let benchBase: number | undefined;
    return thin(history.flatMap((point) => {
      const b = bench.get(point.date);
      if (b === undefined) return [];
      benchBase ??= b;
      return [{ date: point.date, asset: Number(((point.adjClose / base) * 10_000).toFixed(0)), benchmark: Number(((b / benchBase) * 10_000).toFixed(0)) }];
    }));
  }, [history, analysis.benchmarkHistory]);
  const drawdownSeries = useMemo(() => {
    if (!history.length) return [];
    let peak = 0;
    return thin(history.map((point) => { peak = Math.max(peak, point.adjClose); return { date: point.date, drawdown: Number(((point.adjClose / peak - 1) * 100).toFixed(2)) }; }));
  }, [history]);
  const vol = oneYear?.volatility ?? null;
  const beta = oneYear?.beta ?? null;
  return <>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Metric label="Volatilidad 1 año" value={pct(vol, 1, false)} note={`S&P 500: ${pct(oneYear?.benchmarkVolatility, 1, false)} · cuánto oscila al año`} tone={band(vol, (v) => v < 18, (v) => v > 35)} />
      <Metric label={`Caída máxima ${longest?.label ?? ""}`} value={pct(longest?.maxDrawdown, 1)} note={`${longest?.maxDrawdownDate ? `Fondo el ${shortDate(longest.maxDrawdownDate)}` : ""} · S&P 500: ${pct(longest?.benchmarkMaxDrawdown, 1)}`} tone={band(longest?.maxDrawdown, (v) => v > -20, (v) => v < -35)} />
      <Metric label="Distancia al máximo" value={pct(analysis.currentDrawdown, 1)} note="Caída actual desde su máximo de 5 años (con dividendos)" tone={band(analysis.currentDrawdown, (v) => v > -5, (v) => v < -25)} />
      <Metric label="Beta vs S&P 500" value={n(beta, 2)} note={beta === null ? "Sin datos suficientes" : beta < 0.8 ? "Defensivo: se mueve menos que el mercado" : beta > 1.2 ? "Agresivo: amplifica los movimientos del mercado" : "Se mueve en línea con el mercado"} />
      <Metric label="Sharpe 1 año" value={n(oneYear?.sharpe, 2)} note={`Rendimiento por unidad de riesgo sobre la tasa libre (${pct(analysis.riskFreeRate, 2, false)})`} tone={band(oneYear?.sharpe, (v) => v >= 1, (v) => v < 0.3)} />
      <Metric label="Correlación con S&P 500" value={n(oneYear?.correlation, 2)} note={oneYear?.correlation === null || oneYear?.correlation === undefined ? "Sin datos" : oneYear.correlation > 0.85 ? "Diversifica poco frente al índice" : oneYear.correlation < 0.5 ? "Aporta diversificación" : "Diversificación moderada"} />
    </div>
    {(analysis.bestDay || analysis.worstDay) && <p className="mt-2 text-[11px] text-muted-foreground">Último año · mejor día {analysis.bestDay ? `${pct(analysis.bestDay.change)} (${shortDate(analysis.bestDay.date)})` : "—"} · peor día {analysis.worstDay ? `${pct(analysis.worstDay.change)} (${shortDate(analysis.worstDay.date)})` : "—"}</p>}
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-card-border bg-card p-3">
        <p className="text-[11px] font-bold">Crecimiento de $10.000 · {period}</p>
        <p className="text-[10px] text-muted-foreground">Con dividendos reinvertidos, frente al S&P 500 (SPY)</p>
        {relative.length ? <div className="mt-2 h-[180px]"><ResponsiveContainer width="100%" height="100%">
          <LineChart data={relative} margin={{ top: 6, right: 6, left: -8, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.grid} strokeDasharray="2 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 9, fill: COLORS.muted }} axisLine={false} tickLine={false} minTickGap={40} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9, fill: COLORS.muted, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} width={50} tickFormatter={(value) => `$${n(Number(value) / 1000, 1)}k`} />
            <Tooltip labelFormatter={(label) => shortDate(String(label))} formatter={(value: number, name: string) => [`$${n(value, 0)}`, name]} contentStyle={TOOLTIP_STYLE} />
            <Legend verticalAlign="top" align="right" iconType="plainline" wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="asset" name={analysis.ticker} stroke={COLORS.coral} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="benchmark" name="S&P 500" stroke={COLORS.teal} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer></div> : <p className="mt-3 text-xs text-muted-foreground">Comparación no disponible.</p>}
      </div>
      <div className="rounded-xl border border-card-border bg-card p-3">
        <p className="text-[11px] font-bold">Caída desde máximos · {period}</p>
        <p className="text-[10px] text-muted-foreground">Cuánto llegó a estar por debajo de su máximo previo</p>
        {drawdownSeries.length ? <div className="mt-2 h-[180px]"><ResponsiveContainer width="100%" height="100%">
          <AreaChart data={drawdownSeries} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.grid} strokeDasharray="2 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 9, fill: COLORS.muted }} axisLine={false} tickLine={false} minTickGap={40} />
            <YAxis domain={["dataMin", 0]} tick={{ fontSize: 9, fill: COLORS.muted, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} width={44} tickFormatter={(value) => `${n(Number(value), 0)}%`} />
            <Tooltip labelFormatter={(label) => shortDate(String(label))} formatter={(value: number) => [pct(value, 1), "Caída"]} contentStyle={TOOLTIP_STYLE} />
            <Area type="monotone" dataKey="drawdown" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.18} strokeWidth={1.5} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer></div> : <p className="mt-3 text-xs text-muted-foreground">Sin datos.</p>}
      </div>
    </div>
    <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Guía de colores: volatilidad baja &lt;18%, alta &gt;35%; caída máxima moderada &gt;−20%, severa &lt;−35%; Sharpe favorable ≥1. Son referencias generales, no reglas.</p>
  </>;
}

// ---------- Value lens ----------
function ValueLens({ analysis, price }: { analysis: AssetAnalysis; price: number }) {
  const f = analysis.fundamentals;
  const v = (key: string) => (typeof f[key] === "number" ? (f[key] as number) : null);
  const s = (key: string) => (typeof f[key] === "string" ? (f[key] as string) : null);
  const hasAny = Object.values(f).some((value) => value !== null && value !== undefined);
  if (!hasAny) return <p className="mt-3 rounded-xl bg-card px-3 py-3 text-xs text-muted-foreground">Yahoo Finance no entregó fundamentales para {analysis.ticker} en este momento. Intenta más tarde.</p>;
  const yieldPct = v("dividendYield");
  const dividendNote = analysis.trailingDividends ? `${money(analysis.trailingDividends)} pagados en 12 meses` : "Sin dividendos en 12 meses";

  if (analysis.type === "ETF") {
    const expense = v("expenseRatio");
    const assets = v("totalAssets");
    const top10 = analysis.topHoldings.reduce((sum, item) => sum + item.weight, 0);
    return <>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {expense !== null && <Metric label="Comisión anual" value={pct(expense, 2, false)} note="Lo que cobra el fondo cada año sobre tu inversión" tone={band(expense, (x) => x <= 0.1, (x) => x > 0.6)} />}
        {assets !== null && <Metric label="Tamaño del fondo" value={big(assets)} note="Fondos grandes: más liquidez y menor riesgo de cierre" tone={band(assets, (x) => x >= 10e9, (x) => x < 100e6)} />}
        <Metric label="Rendimiento por dividendo" value={pct(yieldPct, 2, false)} note={dividendNote} />
        {v("holdingsPE") !== null && <Metric label="P/E de sus posiciones" value={n(v("holdingsPE"), 1)} note="Qué tan caras están, en promedio, las empresas que contiene" tone={band(v("holdingsPE"), (x) => x < 18, (x) => x > 32)} />}
        {top10 > 0 && <Metric label="Concentración top 10" value={pct(top10, 1, false)} note={top10 > 50 ? "Muy concentrado en pocas empresas" : top10 > 30 ? "Concentración moderada" : "Bien diversificado"} tone={band(top10, (x) => x < 30, (x) => x > 55)} />}
        {s("category") && <Metric label="Categoría" value={s("category")!} note={s("fundFamily") ? `Gestora: ${s("fundFamily")}` : "Tipo de fondo"} />}
      </div>
      {expense === null && !analysis.topHoldings.length && <p className="mt-2 rounded-xl bg-card px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">La comisión, el tamaño y las posiciones del fondo no están disponibles desde nuestra fuente de datos. Puedes verlas en la <a className="font-bold text-primary underline" href={`https://finance.yahoo.com/quote/${encodeURIComponent(analysis.ticker)}/holdings/`} target="_blank" rel="noopener noreferrer">ficha del fondo en Yahoo Finance</a>.</p>}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {analysis.topHoldings.length > 0 && <div className="rounded-xl border border-card-border bg-card p-3">
          <p className="text-[11px] font-bold">Principales posiciones</p>
          <div className="mt-2 space-y-1.5">{analysis.topHoldings.map((item) => <div key={`${item.symbol}-${item.name}`}>
            <div className="flex justify-between gap-2 text-[11px]"><span className="truncate"><strong className="font-mono-app">{item.symbol ?? ""}</strong> <span className="text-muted-foreground">{item.name}</span></span><span className="font-mono-app">{pct(item.weight, 2, false)}</span></div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.min(100, item.weight * (100 / Math.max(...analysis.topHoldings.map((h) => h.weight))))}%`, backgroundColor: COLORS.sky }} /></div>
          </div>)}</div>
        </div>}
        {analysis.sectorWeights.length > 0 && <div className="rounded-xl border border-card-border bg-card p-3">
          <p className="text-[11px] font-bold">Peso por sector</p>
          <div className="mt-2 space-y-1.5">{analysis.sectorWeights.map((item) => <div key={item.sector}>
            <div className="flex justify-between text-[11px]"><span>{item.sector}</span><span className="font-mono-app">{pct(item.weight, 1, false)}</span></div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.min(100, item.weight)}%`, backgroundColor: COLORS.teal }} /></div>
          </div>)}</div>
        </div>}
      </div>
    </>;
  }

  const pe = v("trailingPE");
  const fpe = v("forwardPE");
  const target = v("targetMeanPrice");
  const upside = target !== null && price > 0 ? (target / price - 1) * 100 : null;
  const recommendation: Record<string, string> = { strong_buy: "Compra fuerte", buy: "Compra", hold: "Mantener", underperform: "Bajo rendimiento", sell: "Venta" };
  return <>
    <p className="mt-3 text-[11px] text-muted-foreground">{[s("sector"), s("industry"), `Capitalización ${big(v("marketCap"))}`].filter(Boolean).join(" · ")}</p>
    <p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Valoración</p>
    <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Metric label="P/E (12 meses)" value={n(pe, 1)} note={v("trailingEps") !== null ? `Utilidad por acción 12 meses: ${money(v("trailingEps"))}` : "Años de utilidades que pagas por la acción"} tone={band(pe, (x) => x > 0 && x < 18, (x) => x > 35 || x <= 0)} />
      {fpe !== null && <Metric label="P/E futuro" value={n(fpe, 1)} note={pe !== null && fpe !== null ? (fpe < pe ? "Menor que el actual: se esperan más utilidades" : "Mayor que el actual: se esperan menos utilidades") : "Con utilidades estimadas"} tone={band(fpe, (x) => x > 0 && x < 18, (x) => x > 35 || x <= 0)} />}
      {v("pegRatio") !== null && <Metric label="PEG" value={n(v("pegRatio"), 2)} note="P/E ajustado por crecimiento; menos de 1 suele ser atractivo" tone={band(v("pegRatio"), (x) => x > 0 && x < 1, (x) => x > 2.5)} />}
      <Metric label="Precio / Ventas" value={n(v("priceToSales"), 2)} note="Cuánto pagas por cada dólar de ingresos" tone={band(v("priceToSales"), (x) => x < 3, (x) => x > 10)} />
      <Metric label="Precio / Valor en libros" value={n(v("priceToBook"), 2)} note="Precio frente al patrimonio contable" />
      {v("evToEbitda") !== null && <Metric label="EV / EBITDA" value={n(v("evToEbitda"), 1)} note="Valor de la empresa frente a su caja operativa" tone={band(v("evToEbitda"), (x) => x > 0 && x < 12, (x) => x > 25)} />}
    </div>
    <p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Calidad y crecimiento</p>
    <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Metric label="Margen neto" value={pct(v("profitMargin"), 1, false)} note={`Bruto ${pct(v("grossMargin"), 1, false)} · operativo ${pct(v("operatingMargin"), 1, false)}`} tone={band(v("profitMargin"), (x) => x >= 20, (x) => x < 5)} />
      <Metric label="ROE" value={pct(v("returnOnEquity"), 1, false)} note="Rentabilidad sobre el capital de los accionistas" tone={band(v("returnOnEquity"), (x) => x >= 15, (x) => x < 8)} />
      <Metric label="Crecimiento de ingresos" value={pct(v("revenueGrowth"), 1)} note={`Utilidades: ${pct(v("earningsGrowth"), 1)} (interanual)`} tone={band(v("revenueGrowth"), (x) => x >= 10, (x) => x < 0)} />
      <Metric label="Deuda / Patrimonio" value={n(v("debtToEquity"), 0)} note="En %; más de 200 es apalancamiento alto" tone={band(v("debtToEquity"), (x) => x < 60, (x) => x > 200)} />
      <Metric label="Liquidez corriente" value={n(v("currentRatio"), 2)} note="Activos de corto plazo por cada dólar de deudas de corto plazo" tone={band(v("currentRatio"), (x) => x >= 1.5, (x) => x < 1)} />
      <Metric label="Flujo de caja libre" value={big(v("freeCashflow"))} note="Caja que queda tras invertir en el negocio" tone={band(v("freeCashflow"), (x) => x > 0, (x) => x < 0)} />
    </div>
    <p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Dividendo</p>
    <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Metric label="Rendimiento por dividendo" value={pct(yieldPct, 2, false)} note={`${dividendNote} · promedio 5 años ${pct(v("fiveYearAvgDividendYield"), 2, false)}`} />
      <Metric label="Pago sobre utilidades" value={pct(v("payoutRatio"), 0, false)} note="Qué parte de las utilidades se reparte" tone={band(v("payoutRatio"), (x) => x > 0 && x <= 60, (x) => x > 90)} />
      {target !== null && <Metric label="Precio objetivo" value={money(target)} note={`${upside === null ? "—" : `${pct(upside, 1)} vs precio actual`} · ${v("analystCount") ?? "?"} analistas · ${recommendation[s("recommendation") ?? ""] ?? "sin consenso"}`} tone={band(upside, (x) => x >= 15, (x) => x < 0)} />}
    </div>
    <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{s("source") === "SEC EDGAR" ? "Fuente: estados financieros oficiales presentados a la SEC. P/E y márgenes con los últimos 12 meses; crecimiento del último año fiscal completo. " : ""}Los rangos de color son referencias generales: un P/E alto puede estar justificado en empresas de alto crecimiento. Úsalos para comparar, no como veredicto.</p>
  </>;
}

// ---------- Main ----------
export function AssetInsights({ ticker, price, fallbackHistory, dcaContent }: { ticker: string; price: number; fallbackHistory: BasicPoint[]; dcaContent: ReactNode }) {
  const [period, setPeriod] = useState<PeriodKey>("1A");
  const [lens, setLens] = useState<"dca" | "risk" | "value">("dca");
  const query = useQuery({
    queryKey: ["asset-analysis", ticker],
    queryFn: async (): Promise<AssetAnalysis> => {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/market/analysis/${encodeURIComponent(ticker)}`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error ?? "No disponible");
      return response.json();
    },
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
  const analysis = query.data;
  const start = startFor(analysis, period, fallbackHistory);
  const fullHistory = analysis?.history ?? [];
  const periodHistory = useMemo(() => (start ? fullHistory.filter((point) => point.date >= start) : []), [fullHistory, start]);
  const chartRows: BasicPoint[] = useMemo(() => {
    if (analysis && periodHistory.length) return thin(periodHistory);
    return period === "1A" ? fallbackHistory : [];
  }, [analysis, periodHistory, period, fallbackHistory]);
  const available = (key: PeriodKey) => !analysis || analysis.periods.some((item) => item.key === key && item.startDate);

  return <>
    <Section
      title="Evolución del precio y medias móviles"
      subtitle="Cierres diarios de Yahoo Finance. La vista inicial es de 1 año; elige otro período para ampliar."
      right={<div className="flex flex-wrap gap-1 rounded-xl border border-card-border bg-card p-0.5">{PERIOD_KEYS.map((key) => <button key={key} type="button" disabled={!available(key)} onClick={() => setPeriod(key)} className={`rounded-lg px-2 py-1 font-mono-app text-[10px] font-bold transition-colors disabled:opacity-30 ${period === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{key}</button>)}</div>}
    >
      {chartRows.length ? <div className="mt-4 h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartRows} margin={{ top: 8, right: 8, left: -18, bottom: 2 }}>
            <CartesianGrid stroke={COLORS.grid} strokeDasharray="2 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 9, fill: COLORS.muted }} axisLine={false} tickLine={false} minTickGap={34} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9, fill: COLORS.muted, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} tickFormatter={(value) => n(Number(value), 0)} width={48} />
            <Tooltip labelFormatter={(label) => shortDate(String(label))} formatter={(value, name) => [typeof value === "number" ? n(value) : "—", String(name)]} contentStyle={TOOLTIP_STYLE} />
            <Legend verticalAlign="top" align="right" iconType="plainline" wrapperStyle={{ fontSize: 10, paddingBottom: 8 }} />
            <Line type="monotone" dataKey="close" name="Precio" stroke={COLORS.fg} strokeWidth={2.2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="sma20" name="SMA20" stroke={COLORS.coral} strokeWidth={1.4} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="sma50" name="SMA50" stroke={COLORS.teal} strokeWidth={1.4} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="sma100" name="SMA100" stroke={COLORS.sky} strokeWidth={1.4} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="sma200" name="SMA200" stroke={COLORS.amber} strokeWidth={1.7} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div> : <div className="mt-4 flex h-32 items-center justify-center rounded-xl bg-card text-xs text-muted-foreground">{query.isLoading ? "Cargando historia…" : "Histórico no disponible para este período."}</div>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-card-border bg-card">
        <table className="w-full min-w-[420px] text-[11px]">
          <thead><tr className="text-left text-[9px] uppercase tracking-[.1em] text-muted-foreground"><th className="px-3 py-2">Período</th><th className="px-3 py-2 text-right">Rendimiento</th><th className="px-3 py-2 text-right">Promedio anual</th><th className="px-3 py-2 text-right">S&P 500</th><th className="px-3 py-2 text-right">Diferencia</th></tr></thead>
          <tbody>{query.isLoading ? <tr><td colSpan={5} className="px-3 py-3 text-muted-foreground">Calculando rendimientos…</td></tr> : analysis ? analysis.periods.map((row) => {
            const diff = row.totalReturn !== null && row.benchmarkReturn !== null ? row.totalReturn - row.benchmarkReturn : null;
            const tone = (value: number | null) => value === null ? "text-muted-foreground" : value >= 0 ? "text-accent" : "text-destructive";
            return <tr key={row.key} onClick={() => row.startDate && setPeriod(row.key as PeriodKey)} className={`cursor-pointer border-t border-card-border ${period === row.key ? "bg-secondary/60" : "hover:bg-secondary/30"}`}>
              <td className="px-3 py-1.5 font-bold">{row.label}</td>
              <td className={`px-3 py-1.5 text-right font-mono-app ${tone(row.totalReturn)}`}>{pct(row.totalReturn)}</td>
              <td className={`px-3 py-1.5 text-right font-mono-app ${tone(row.cagr)}`}>{row.cagr === null ? (row.startDate ? <span className="text-muted-foreground">menos de 1 año</span> : "—") : `${pct(row.cagr)} / año`}</td>
              <td className="px-3 py-1.5 text-right font-mono-app text-muted-foreground">{row.benchmarkCagr !== null ? `${pct(row.benchmarkCagr)} / año` : pct(row.benchmarkReturn)}</td>
              <td className={`px-3 py-1.5 text-right font-mono-app ${tone(diff)}`}>{pct(diff)}</td>
            </tr>;
          }) : <tr><td colSpan={5} className="px-3 py-3 text-muted-foreground">{query.error instanceof Error ? query.error.message : "Sin datos"}</td></tr>}</tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Rendimiento total con dividendos reinvertidos. "Promedio anual" es la tasa compuesta anual (CAGR): cuánto habría crecido por año de forma constante. Solo se calcula para períodos de 1 año o más.</p>
    </Section>

    <div className="mt-5 flex rounded-2xl border border-card-border bg-secondary/40 p-1" role="tablist">
      {([["dca", "DCA"], ["risk", "Riesgo"], ["value", "Valor"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={lens === key} onClick={() => setLens(key)} className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${lens === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
    </div>

    {lens === "dca" && <>{dcaContent}<DcaSimulator history={fullHistory} loading={query.isLoading} /></>}
    {lens !== "dca" && (query.isLoading ? <div className="mt-4 h-48 animate-pulse rounded-2xl bg-secondary/40" /> : !analysis ? <p className="mt-4 rounded-2xl bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">{query.error instanceof Error ? query.error.message : "Análisis no disponible."}</p> : lens === "risk"
      ? <Section title="Riesgo" subtitle="Cuánto oscila, cuánto ha llegado a caer y cómo se comporta frente al S&P 500.">
        <RiskLens analysis={analysis} period={period} history={periodHistory} />
      </Section>
      : <Section title="Valor" subtitle={analysis.type === "ETF" ? "Costos, tamaño y composición del fondo." : "Valoración, calidad del negocio y dividendo."}>
        <ValueLens analysis={analysis} price={price} />
      </Section>)}
    {analysis?.errors.length ? <p className="mt-2 text-[10px] text-muted-foreground">{analysis.errors.join(" ")}</p> : null}
  </>;
}
