import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { ArrowLeft, LogIn, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  RANGES,
  annualReturns,
  beta,
  bestWorstDay,
  buildBenchmarkSeries,
  buildValueSeries,
  concentrationLabel,
  dailyReturns,
  drawdown,
  effectivePositions,
  periodReturn,
  rebase,
  riskLabel,
  sliceRange,
  volatility,
  weights,
  type History,
  type Point,
  type Range,
} from "@/lib/portfolio-math";

type Position = {
  ticker: string;
  units: number;
  avgCost: number | null;
  name: string;
  type: string | null;
  price: number | null;
  change: number | null;
  signal: string | null;
  level: number | null;
};
type PortfolioResponse = { positions: Position[]; errors: string[] };

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(body.error ?? `Error ${response.status}`, response.status);
  return body;
}

async function fetchHistory(ticker: string): Promise<History> {
  const response = await fetch(`/api/market/history/${encodeURIComponent(ticker)}`);
  if (!response.ok) throw new Error(`Historia no disponible para ${ticker}`);
  return (await response.json()) as History;
}

const num = (value: number, digits = 2) => value.toLocaleString("es-VE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const usd = (value: number) => `$${num(value)}`;
const pct = (value: number | null, digits = 2, sign = true) => (value === null || !Number.isFinite(value) ? "—" : `${sign && value > 0 ? "+" : ""}${num(value * 100, digits)}%`);
const tone = (value: number | null) => (value === null ? "text-muted-foreground" : value >= 0 ? "text-emerald-600" : "text-destructive");
const monthFmt = new Intl.DateTimeFormat("es-VE", { month: "short", year: "numeric", timeZone: "UTC" });
const axisFmt = new Intl.DateTimeFormat("es-VE", { month: "short", year: "2-digit", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const TOOLTIP_STYLE = { borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 11, background: "hsl(var(--card))", color: "hsl(var(--foreground))" };
const PALETTE = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "#94a3b8", "#cbd5e1", "#64748b"];

function Card({ title, subtitle, children, className = "", action }: { title?: string; subtitle?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return <section className={`rounded-2xl border border-card-border bg-card p-5 sm:p-6 ${className}`}>
    {(title || action) && <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        {title && <h2 className="font-display text-base font-bold tracking-[-0.02em]">{title}</h2>}
        {subtitle && <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </header>}
    {children}
  </section>;
}

function Pills<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (value: T) => void }) {
  return <div className="flex flex-wrap gap-1.5" role="tablist">
    {options.map((option) => <button key={option} type="button" role="tab" aria-selected={value === option} onClick={() => onChange(option)} className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${value === option ? "border-foreground bg-foreground text-background" : "border-card-border text-muted-foreground hover:text-foreground"}`}>{option}</button>)}
  </div>;
}

function Metric({ label, value, hint, className = "" }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-card-border bg-background/60 px-4 py-3.5 ${className}`}>
    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
    <p className="mt-1 font-display text-2xl font-bold tracking-[-0.04em]">{value}</p>
    {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
  </div>;
}

function LevelBars({ level }: { level: number }) {
  return <div className="mt-2 flex gap-1" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= level ? "bg-primary" : "bg-card-border"}`} />)}</div>;
}

function Rows({ head, rows }: { head: string[]; rows: Array<Array<ReactNode>> }) {
  return <table className="w-full text-sm">
    <thead><tr className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{head.map((h, i) => <th key={h} className={`pb-2 font-bold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((row, r) => <tr key={r} className="border-t border-card-border">{row.map((cell, i) => <td key={i} className={`py-2.5 ${i === 0 ? "text-left" : "text-right tabular-nums"}`}>{cell}</td>)}</tr>)}</tbody>
  </table>;
}

type FormState = { ticker: string; units: string; avgCost: string };
const EMPTY_FORM: FormState = { ticker: "", units: "", avgCost: "" };

function PositionForm({ value, onChange, onSubmit, saving, error, editing, onCancel }: { value: FormState; onChange: (next: FormState) => void; onSubmit: (event: FormEvent) => void; saving: boolean; error: string | null; editing: boolean; onCancel: () => void }) {
  const input = "w-full rounded-xl border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground";
  return <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
    <label className="text-xs font-semibold">Ticker
      <input className={`${input} mt-1 uppercase`} value={value.ticker} disabled={editing} maxLength={12} placeholder="VOO, KO, MSFT…" onChange={(e) => onChange({ ...value, ticker: e.target.value.toUpperCase() })} required />
    </label>
    <label className="text-xs font-semibold">Unidades
      <input className={`${input} mt-1`} value={value.units} inputMode="decimal" placeholder="2,4431" onChange={(e) => onChange({ ...value, units: e.target.value })} required />
    </label>
    <label className="text-xs font-semibold">Costo promedio por unidad (opcional)
      <input className={`${input} mt-1`} value={value.avgCost} inputMode="decimal" placeholder="USD, para calcular tu ganancia" onChange={(e) => onChange({ ...value, avgCost: e.target.value })} />
    </label>
    <div className="flex gap-2">
      <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"><Plus className="h-3.5 w-3.5" />{editing ? "Guardar" : "Añadir"}</button>
      {editing && <button type="button" onClick={onCancel} className="rounded-xl border border-card-border px-3 py-2 text-xs font-semibold">Cancelar</button>}
    </div>
    {error && <p className="text-xs font-semibold text-destructive sm:col-span-4" role="alert">{error}</p>}
  </form>;
}

const parseNumber = (text: string): number | null => {
  const cleaned = text.trim().replace(/\s/g, "");
  if (!cleaned) return null;
  // Acepta "2,4431" y "2.4431"; con ambos separadores, el último es el decimal.
  const normalized = cleaned.includes(",") && cleaned.includes(".") ? (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "")) : cleaned.replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

export function PortfolioPage({ onBack, signInHref }: { onBack: () => void; signInHref: string }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<Range>("1A");
  const [compare, setCompare] = useState(true);
  const [split, setSplit] = useState<"Posiciones" | "Tipo de activo">("Posiciones");
  const [ddRange, setDdRange] = useState<"1A" | "5A" | "Máx">("5A");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const portfolio = useQuery({
    queryKey: ["portfolio"],
    queryFn: async () => api<PortfolioResponse>("/api/portfolio", await getToken()),
    enabled: isLoaded && Boolean(isSignedIn),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const positions = useMemo(() => portfolio.data?.positions ?? [], [portfolio.data]);

  const historyTickers = useMemo(() => [...new Set([...positions.map((p) => p.ticker), "SPY"])], [positions]);
  const historyQueries = useQueries({
    queries: historyTickers.map((ticker) => ({ queryKey: ["history", ticker], queryFn: () => fetchHistory(ticker), staleTime: 60 * 60 * 1000, retry: 1, refetchOnWindowFocus: false })),
  });
  const histories = useMemo(() => historyQueries.flatMap((q) => (q.data ? [q.data] : [])), [historyQueries]);
  const historiesLoading = historyQueries.some((q) => q.isLoading);

  const save = useMutation({
    mutationFn: async (input: { ticker: string; units: number; avgCost: number | null }) =>
      api(`/api/portfolio/${encodeURIComponent(input.ticker)}`, await getToken(), { method: "PUT", body: JSON.stringify({ units: input.units, avgCost: input.avgCost }) }),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setEditing(false);
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
    onError: (error: Error) => setFormError(error.message),
  });
  const remove = useMutation({
    mutationFn: async (ticker: string) => api(`/api/portfolio/${encodeURIComponent(ticker)}`, await getToken(), { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const units = parseNumber(form.units);
    const avgCost = form.avgCost.trim() ? parseNumber(form.avgCost) : null;
    if (!form.ticker.trim() || units === null || units <= 0) return setFormError("Indica el ticker y una cantidad de unidades mayor que cero.");
    if (form.avgCost.trim() && (avgCost === null || avgCost < 0)) return setFormError("El costo promedio debe ser un número válido.");
    setFormError(null);
    save.mutate({ ticker: form.ticker.trim(), units, avgCost });
  };

  // Valor de cada posición con el precio del radar; si falta, el último cierre del historial.
  const valued = useMemo(() => positions.map((p) => {
    const history = histories.find((h) => h.ticker === p.ticker);
    const price = p.price ?? (history ? history.close[history.close.length - 1] : null);
    return { ...p, price, value: price === null ? 0 : price * p.units };
  }), [positions, histories]);
  const total = valued.reduce((sum, p) => sum + p.value, 0);
  const w = useMemo(() => weights(valued.map((p) => ({ ticker: p.ticker, value: p.value }))), [valued]);
  const weightOf = (ticker: string) => w.find((item) => item.ticker === ticker)?.weight ?? 0;

  // Hoy: cada posición aporta su variación de la sesión.
  const todayPct = useMemo(() => {
    let now = 0;
    let before = 0;
    for (const p of valued) {
      if (p.change === null || p.value <= 0) continue;
      now += p.value;
      before += p.value / (1 + p.change / 100);
    }
    return before > 0 ? now / before - 1 : null;
  }, [valued]);
  const costed = valued.filter((p) => p.avgCost !== null && p.price !== null);
  const costBasis = costed.reduce((sum, p) => sum + p.units * (p.avgCost ?? 0), 0);
  const gain = costed.reduce((sum, p) => sum + p.units * ((p.price ?? 0) - (p.avgCost ?? 0)), 0);
  const gainPct = costBasis > 0 ? gain / costBasis : null;

  const fullSeries = useMemo(() => buildValueSeries(valued.map((p) => ({ ticker: p.ticker, units: p.units, avgCost: p.avgCost })), histories), [valued, histories]);
  const spyFull = useMemo(() => buildBenchmarkSeries(histories.find((h) => h.ticker === "SPY")), [histories]);

  const shown = useMemo(() => sliceRange(fullSeries, range), [fullSeries, range]);
  const spyShown = useMemo(() => {
    if (!shown.length) return [] as Point[];
    const start = shown[0].date;
    const from = spyFull.filter((p) => p.date >= start);
    return rebase(from, shown[0].value);
  }, [shown, spyFull]);
  const chartData = useMemo(() => {
    const spy = new Map(spyShown.map((p) => [p.date, p.value]));
    return shown.map((p) => ({ date: p.date, value: p.value, spy: spy.get(p.date) ?? null }));
  }, [shown, spyShown]);
  const rangeReturn = periodReturn(shown);
  const spyRangeReturn = periodReturn(spyShown);

  // Riesgo: ventana de hasta 5 años, igual para el portafolio y para el S&P 500.
  const riskSeries = useMemo(() => sliceRange(fullSeries, "5A"), [fullSeries]);
  const riskSpy = useMemo(() => {
    if (!riskSeries.length) return [] as Point[];
    return spyFull.filter((p) => p.date >= riskSeries[0].date);
  }, [riskSeries, spyFull]);
  const vol = volatility(dailyReturns(riskSeries));
  const spyVol = volatility(dailyReturns(riskSpy));
  const betaValue = beta(riskSeries, riskSpy);
  const days = bestWorstDay(dailyReturns(riskSeries));
  const spyDays = bestWorstDay(dailyReturns(riskSpy));
  const risk = riskLabel(vol);

  const ddSeries = useMemo(() => sliceRange(fullSeries, ddRange), [fullSeries, ddRange]);
  const dd = useMemo(() => drawdown(ddSeries), [ddSeries]);
  const ddSpy = useMemo(() => {
    if (!ddSeries.length) return null;
    return drawdown(spyFull.filter((p) => p.date >= ddSeries[0].date));
  }, [ddSeries, spyFull]);

  const yearly = useMemo(() => annualReturns(riskSeries), [riskSeries]);
  const spyYearly = useMemo(() => annualReturns(riskSpy), [riskSpy]);
  const yearlyData = yearly.map((item, index) => ({
    label: index === 0 && riskSeries[0] && riskSeries[0].date.slice(5, 7) !== "01" ? `${item.year}*` : String(item.year),
    tu: item.value,
    spy: spyYearly.find((s) => s.year === item.year)?.value ?? null,
  }));
  const ytd = yearly.length ? yearly[yearly.length - 1] : null;
  const spyYtd = spyYearly.length ? spyYearly[spyYearly.length - 1] : null;

  const effective = effectivePositions(w);
  const typeSplit = useMemo(() => {
    const groups = new Map<string, number>();
    for (const p of valued) groups.set(p.type === "ETF" ? "ETF" : p.type ? "Acciones" : "Otros", (groups.get(p.type === "ETF" ? "ETF" : p.type ? "Acciones" : "Otros") ?? 0) + p.value);
    return [...groups.entries()].map(([name, value]) => ({ name, value, weight: total > 0 ? value / total : 0 })).sort((a, b) => b.value - a.value);
  }, [valued, total]);
  const donutData = split === "Posiciones" ? w.map((item) => ({ name: item.ticker, value: item.value, weight: item.weight })) : typeSplit;
  const top3 = w.slice(0, 3).reduce((sum, item) => sum + item.weight, 0);

  const historyStart = fullSeries[0]?.date;
  const startEdit = (p: Position) => {
    setForm({ ticker: p.ticker, units: String(p.units).replace(".", ","), avgCost: p.avgCost === null ? "" : String(p.avgCost).replace(".", ",") });
    setEditing(true);
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const header = <div className="flex flex-wrap items-center justify-between gap-3">
    <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Volver al radar</button>
    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Portafolio · información general, no es asesoría</p>
  </div>;

  if (!isLoaded) return <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{header}<p className="mt-10 text-sm text-muted-foreground">Cargando…</p></main>;

  if (!isSignedIn || (portfolio.error as ApiError | null)?.status === 401) {
    return <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">{header}
      <Card className="mt-6 text-center">
        <Wallet className="mx-auto h-8 w-8 text-primary" />
        <h1 className="mt-3 font-display text-2xl font-bold tracking-[-0.04em]">Tu portafolio, con el criterio del termómetro</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Anota tus acciones y ETF y mira su valor, su riesgo y su concentración. Solo tú ves tus posiciones.</p>
        <a href={signInHref} className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground"><LogIn className="h-3.5 w-3.5" /> Entrar para ver mi portafolio</a>
      </Card>
    </main>;
  }

  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
    {header}
    <div>
      <h1 className="font-display text-3xl font-bold tracking-[-0.05em]">Mi portafolio</h1>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">Anota lo que tienes y mira cuánto vale, qué riesgo lleva y cómo se reparte. Aquí no se compra ni se vende nada.</p>
    </div>

    <Card title={editing ? `Editar ${form.ticker}` : "Añadir una posición"} subtitle={editing ? undefined : "Acciones y ETF de EE. UU. Si ya tienes el ticker, volver a añadirlo reemplaza las unidades."}>
      <PositionForm value={form} onChange={setForm} onSubmit={submit} saving={save.isPending} error={formError} editing={editing} onCancel={() => { setEditing(false); setForm(EMPTY_FORM); setFormError(null); }} />
    </Card>

    {portfolio.isLoading && <p className="text-sm text-muted-foreground">Leyendo tu portafolio…</p>}
    {portfolio.isError && (portfolio.error as ApiError).status !== 401 && <p className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{(portfolio.error as Error).message}</p>}

    {!portfolio.isLoading && !portfolio.isError && positions.length === 0 && <Card className="text-center">
      <Wallet className="mx-auto h-7 w-7 text-primary" />
      <p className="mt-3 text-sm font-semibold">Todavía no has añadido posiciones</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">Empieza con una: ticker y unidades. Con el costo promedio también calculamos tu ganancia.</p>
    </Card>}

    {positions.length > 0 && <>
      <Card>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Tu portafolio hoy</p>
        <p className="mt-1 font-display text-5xl font-bold tracking-[-0.06em]">{usd(total)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Valores orientativos con datos de mercado de Yahoo Finance. El valor exacto de tu cuenta está en tu broker.</p>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div><dt className="text-muted-foreground">Hoy</dt><dd className={`font-display text-xl font-bold ${tone(todayPct)}`}>{pct(todayPct)}</dd></div>
          <div><dt className="text-muted-foreground">Ganancia desde que compraste</dt><dd className={`font-display text-xl font-bold ${tone(costed.length ? gain : null)}`}>{costed.length ? `${gain >= 0 ? "+" : "−"}${usd(Math.abs(gain))}` : "—"}{gainPct !== null && <span className="ml-2 text-sm">{pct(gainPct)}</span>}</dd>{costed.length > 0 && costed.length < valued.length && <dd className="text-[11px] text-muted-foreground">Solo con las {costed.length} posiciones que tienen costo.</dd>}{costed.length === 0 && <dd className="text-[11px] text-muted-foreground">Añade el costo promedio para verla.</dd>}</div>
          <div><dt className="text-muted-foreground">Rendimiento · {range}</dt><dd className={`font-display text-xl font-bold ${tone(rangeReturn)}`}>{pct(rangeReturn)}</dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <Pills options={RANGES} value={range} onChange={setRange} />
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Comparar con S&amp;P 500{compare && spyRangeReturn !== null && <span className={`tabular-nums ${tone(spyRangeReturn)}`}>({pct(spyRangeReturn)})</span>}</label>
        </div>
        <div className="mt-4 h-72 w-full">
          {historiesLoading && !chartData.length ? <p className="pt-24 text-center text-sm text-muted-foreground">Cargando el historial…</p> : chartData.length < 2 ? <p className="pt-24 text-center text-sm text-muted-foreground">No hay historial común suficiente para dibujar el gráfico.</p> :
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs><linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.22} /><stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tickFormatter={(d: string) => axisFmt.format(asDate(d))} minTickGap={48} tickLine={false} axisLine={false} fontSize={11} />
                <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => `$${num(v, 0)}`} width={64} tickLine={false} axisLine={false} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d: string) => dayFmt.format(asDate(d))} formatter={(v: number, name: string) => [usd(v), name === "spy" ? "S&P 500 (misma base)" : "Tu portafolio"]} />
                <Area type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#pf-fill)" dot={false} isAnimationActive={false} />
                {compare && <Area type="monotone" dataKey="spy" stroke="#94a3b8" strokeWidth={1.5} fill="none" dot={false} isAnimationActive={false} connectNulls />}
              </AreaChart>
            </ResponsiveContainer>}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">El pasado se calcula con las posiciones que tienes hoy y con dividendos reinvertidos; no refleja cuándo compraste cada una.{historyStart && ` Historia común desde ${dayFmt.format(asDate(historyStart))}.`}</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card title="Cómo se reparte tu dinero" subtitle="Parte del valor de hoy por posición y por tipo de activo." action={<Pills options={["Posiciones", "Tipo de activo"] as const} value={split} onChange={setSplit} />}>
          <div className="grid items-center gap-4 sm:grid-cols-[200px_1fr]">
            <div className="h-48"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={donutData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none" isAnimationActive={false}>{donutData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => usd(v)} /></PieChart></ResponsiveContainer></div>
            <ul className="space-y-2 text-sm">
              {donutData.map((item, i) => <li key={item.name} className="flex items-center justify-between gap-3 border-b border-card-border pb-2 last:border-0"><span className="flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{item.name}</span><span className="tabular-nums">{num(item.weight * 100, 1)}%</span></li>)}
            </ul>
          </div>
        </Card>

        <Card title="Riesgo de un vistazo">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Nivel de riesgo" value={risk.label} hint={vol === null ? "Historia insuficiente" : `Varía ${num(vol * 100, 1)}% al año`} className="col-span-1"/>
            <Metric label="Caída máxima" value={<span className="text-destructive">{pct(dd.max, 1, false)}</span>} hint={dd.maxDate ? monthFmt.format(asDate(dd.maxDate)) : undefined} />
            <Metric label="En el año" value={<span className={tone(ytd?.value ?? null)}>{pct(ytd?.value ?? null, 1)}</span>} hint={spyYtd ? `S&P 500 ${pct(spyYtd.value, 1)}` : undefined} />
            <Metric label="Mayor posición" value={w[0] ? `${num(w[0].weight * 100, 0)}%` : "—"} hint={w[0]?.ticker} />
          </div>
          {risk.level > 0 && <LevelBars level={risk.level} />}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="flex flex-col" title="Caídas" subtitle="Cuánto estuvo tu combinación actual por debajo de su último máximo, día a día." action={<Pills options={["1A", "5A", "Máx"] as const} value={ddRange} onChange={setDdRange} />}>
          <div className="flex flex-wrap gap-6">
            <div><p className="text-xs text-muted-foreground">Bajo el máximo hoy</p><p className="font-display text-2xl font-bold text-destructive">{pct(dd.current, 1, false)}</p></div>
            <div><p className="text-xs text-muted-foreground">Caída máxima en este periodo</p><p className="font-display text-2xl font-bold text-destructive">{pct(dd.max, 1, false)}</p></div>
          </div>
          <div className="mt-3 min-h-44 flex-1">{dd.series.length > 2 && <ResponsiveContainer width="100%" height="100%"><AreaChart data={dd.series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}><XAxis dataKey="date" hide /><YAxis hide domain={["dataMin", 0]} /><Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d: string) => dayFmt.format(asDate(d))} formatter={(v: number) => [pct(v, 1, false), "Bajo el máximo"]} /><Area type="monotone" dataKey="value" stroke="hsl(var(--destructive))" strokeWidth={1.2} fill="hsl(var(--destructive))" fillOpacity={0.12} dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer>}</div>
          <Rows head={["", "Tú", "S&P 500"]} rows={[["Caída máxima en el periodo", pct(dd.max, 1, false), ddSpy ? pct(ddSpy.max, 1, false) : "—"]]} />
        </Card>

        <div className="space-y-5">
          <Card title="Volatilidad" subtitle="Últimos 5 años, o el historial común disponible.">
            <Rows head={["", "Tú", "S&P 500"]} rows={[
              ["Volatilidad anual", pct(vol, 1, false), pct(spyVol, 1, false)],
              ["Beta", betaValue === null ? "—" : num(betaValue), "1,00"],
              ["Mejor día", pct(days?.best ?? null, 1), pct(spyDays?.best ?? null, 1)],
              ["Peor día", pct(days?.worst ?? null, 1), pct(spyDays?.worst ?? null, 1)],
            ]} />
          </Card>
          <Card title="Concentración">
            <Rows head={["", ""]} rows={[
              ["Diversificación", concentrationLabel(effective, w.length)],
              ["Mayor posición", w[0] ? `${w[0].ticker} · ${num(w[0].weight * 100, 0)}%` : "—"],
              ["Tres mayores", w.length ? `${num(top3 * 100, 0)}%` : "—"],
              ["Número efectivo de posiciones", effective ? `${num(effective, 1)} de ${w.length}` : "—"],
              ["Tipo principal", typeSplit[0] ? `${typeSplit[0].name} · ${num(typeSplit[0].weight * 100, 0)}%` : "—"],
            ]} />
          </Card>
        </div>
      </div>

      {yearlyData.length > 0 && <Card title="Rendimiento por año" subtitle="Tu combinación actual frente al S&P 500, con dividendos reinvertidos.">
        <div className="h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={yearlyData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}><CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} /><YAxis tickFormatter={(v: number) => `${num(v * 100, 0)}%`} width={48} tickLine={false} axisLine={false} fontSize={11} /><Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [pct(v, 1), name]} /><Legend formatter={(value: string) => <span className="text-foreground">{value}</span>} /><Bar dataKey="tu" name="Tú" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} isAnimationActive={false} /><Bar dataKey="spy" name="S&P 500" fill="#cbd5e1" radius={[4, 4, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div>
        {yearlyData.some((d) => d.label.endsWith("*")) && <p className="mt-1 text-[11px] text-muted-foreground">* Año parcial: desde el primer dato común.</p>}
      </Card>}

      <Card title="Tus posiciones">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"><th className="pb-2">Activo</th><th className="pb-2 text-right">Valor</th><th className="pb-2 text-right">Peso</th><th className="pb-2 text-right">Hoy</th><th className="pb-2 text-right">Desde que compraste</th><th className="pb-2 text-right">Zona JB</th><th className="pb-2" /></tr></thead>
            <tbody>
              {valued.map((p) => {
                const sinceBuy = p.avgCost !== null && p.avgCost > 0 && p.price !== null ? p.price / p.avgCost - 1 : null;
                return <tr key={p.ticker} className="border-t border-card-border">
                  <td className="py-3"><p className="font-bold">{p.ticker}</p><p className="max-w-[16rem] truncate text-xs text-muted-foreground" translate="no">{p.name}</p></td>
                  <td className="py-3 text-right tabular-nums"><p className="font-semibold">{p.price === null ? "—" : usd(p.value)}</p><p className="text-xs text-muted-foreground">{num(p.units, 4)} unidades</p></td>
                  <td className="py-3 text-right tabular-nums">{num(weightOf(p.ticker) * 100, 1)}%</td>
                  <td className={`py-3 text-right tabular-nums ${tone(p.change)}`}>{p.change === null ? "—" : pct(p.change / 100)}</td>
                  <td className={`py-3 text-right tabular-nums ${tone(sinceBuy)}`}>{pct(sinceBuy)}</td>
                  <td className="py-3 text-right text-xs">{p.signal ? <span className="rounded-full border border-card-border px-2 py-0.5 font-semibold">{p.signal}</span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-3 text-right"><div className="flex justify-end gap-1"><button type="button" onClick={() => startEdit(p)} aria-label={`Editar ${p.ticker}`} className="rounded-lg p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button><button type="button" disabled={remove.isPending} onClick={() => { if (window.confirm(`¿Quitar ${p.ticker} de tu portafolio?`)) remove.mutate(p.ticker); }} aria-label={`Quitar ${p.ticker}`} className="rounded-lg p-1.5 text-muted-foreground hover:bg-background hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {portfolio.data && portfolio.data.errors.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Sin cotización ahora: {portfolio.data.errors.map((e) => e.split(":")[0]).join(", ")}.</p>}
      </Card>

      <p className="text-[11px] leading-relaxed text-muted-foreground">Precios y rendimientos de Yahoo Finance, con posible retraso. La columna Zona JB es la lectura del termómetro para cada activo y no es una recomendación de compra o venta. Información de carácter general, no asesoría de inversión.</p>
    </>}
  </main>;
}
