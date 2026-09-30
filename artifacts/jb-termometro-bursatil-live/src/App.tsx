import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { getGetAlertDeliveriesQueryKey, getGetEmergingMarketIdeasQueryKey, getGetMarketActivityQueryKey, getGetMarketRadarQueryKey, getGetWatchlistQueryKey, getGetWatchlistRadarQueryKey, useAddWatchlistItem, useGetAlertDeliveries, useGetEmergingMarketIdeas, useGetMarketActivity, useGetMarketRadar, useGetWatchlist, useGetWatchlistRadar, useHealthCheck, useRemoveWatchlistItem, useSearchMarketInstruments } from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { AssetInsights } from "@/components/asset-insights";
import { RecommendedSection } from "@/components/recommended";
import { TelegramAlerts } from "@/components/telegram-alerts";
import { AdminPage } from "@/components/admin-page";
import { MethodologyPage } from "@/components/methodology-page";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Star, Activity as ActivityIcon, Archive, ArrowDownRight, ArrowUpRight, BarChart3, BellRing, Check, ChevronDown, CircleHelp, Clock3, Download, ExternalLink, Filter, Gauge, Gem, Globe2, LayoutDashboard, LogIn, LogOut, Moon, MoreHorizontal, PanelLeftClose, Plus, Printer, Radio, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Sparkles, Sun, TrendingDown, TrendingUp, Wifi, X } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import { ClerkProvider, Show, SignIn, SignUp, useAuth, useClerk, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

const CHART_COLORS = {
  coral: "#e46442",
  teal: "#2e887f",
  sky: "#3b8daf",
  amber: "#d89b36",
  ink: "#203746",
  red: "#be554a",
};

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getYahooAdvancedChartUrl(ticker: string) {
  const normalizedTicker = ticker.trim().toUpperCase();
  const studyId = (name: string) => `\u200c${name}\u200c`;
  const volumeId = studyId("vol undr");
  const rsiId = studyId("rsi (14)");
  const movingAverageIds = [20, 50, 100, 200].map((period) => studyId(`ma (${period},ma,0)`));
  const movingAverageColors = ["#00afedff", "#FF0000", "#43b77aff", "#000000ff"];
  const movingAverageStudies = Object.fromEntries(movingAverageIds.map((id, index) => {
    const period = [20, 50, 100, 200][index];
    return [id, {
      type: "ma",
      inputs: { Period: String(period), Field: "field", Type: "ma", Offset: 0, id, display: id },
      outputs: { MA: { ...(period === 200 ? { width: 3, pattern: "solid" } : {}), color: movingAverageColors[index] } },
      panel: "chart",
      parameters: { chartName: "chart", editMode: true, panelName: "chart" },
      disabled: false,
    }];
  }));
  const chartConfig = {
    layout: {
      interval: "day",
      periodicity: 1,
      timeUnit: null,
      volumeUnderlay: true,
      adj: true,
      crosshair: true,
      chartType: "candle",
      extended: false,
      marketSessions: {},
      aggregationType: "ohlc",
      chartScale: "linear",
      studies: {
        [volumeId]: {
          type: "vol undr",
          inputs: { Series: "series", id: volumeId, display: volumeId },
          outputs: { "Up Volume": "#0dbd6eee", "Down Volume": "#ff5547ee" },
          panel: "chart",
          parameters: { chartName: "chart", editMode: true, panelName: "chart" },
          disabled: false,
        },
        [rsiId]: {
          type: "rsi",
          inputs: { Period: 14, Field: "field", id: rsiId, display: rsiId },
          outputs: { RSI: "auto" },
          panel: rsiId,
          parameters: { studyOverZonesEnabled: true, studyOverBoughtValue: "70", studyOverBoughtColor: "auto", studyOverSoldValue: "30", studyOverSoldColor: "auto", chartName: "chart", editMode: true, panelName: rsiId },
          disabled: false,
        },
        ...movingAverageStudies,
      },
      panels: {
        chart: { percent: 0.8, display: normalizedTicker, chartName: "chart", index: 0, yAxis: { name: "chart", position: null }, yaxisLHS: [], yaxisRHS: ["chart", volumeId] },
        [rsiId]: { percent: 0.2, display: rsiId, chartName: "chart", index: 1, yAxis: { name: rsiId, position: null }, yaxisLHS: [], yaxisRHS: [rsiId] },
      },
      setSpan: { multiplier: 1, base: "year", periodicity: { period: 1, timeUnit: "day" }, showEventsQuote: true, forceLoad: true },
      outliers: false,
      animation: true,
      headsUp: { static: true, dynamic: false, floating: false },
      lineWidth: 2,
      fullScreen: true,
      stripedBackground: true,
      color: "#0081f2",
      crosshairSticky: false,
      dontSaveRangeToLayout: true,
      symbols: [{ symbol: normalizedTicker, periodicity: 1, interval: "day", timeUnit: null, setSpan: null }],
      renderers: [],
      range: null,
    },
    events: { divs: true, splits: true, tradingHorizon: "none", sigDevEvents: [] },
    drawings: null,
    preferences: {},
  };
  return `https://es.finance.yahoo.com/chart/${encodeURIComponent(normalizedTicker)}#${encodeBase64Url(JSON.stringify(chartConfig))}`;
}

const INTERVAL_OPTIONS = [
  { label: "Cada 5 min", ms: 5 * 60 * 1000 },
  { label: "Cada 15 min", ms: 15 * 60 * 1000 },
  { label: "Cada hora", ms: 60 * 60 * 1000 },
  { label: "Cada 24 horas", ms: 24 * 60 * 60 * 1000 },
];

type Asset = {
  ticker: string;
  name: string;
  type: string;
  price: number;
  quoteUpdatedAt?: string | null;
  change: number | null;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  pointsSma: number | null;
  pointsRsi: number | null;
  level: number | null;
  signal: string;
  position: string;
  trend: string;
  historyDays: number;
  sparkline: number[];
  history?: HistoricalPoint[];
};

type HistoricalPoint = {
  date: string;
  close: number;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
};

function scopeUserQuery(baseKey: readonly unknown[], userId?: string | null) {
  return [...baseKey, userId ?? "anonymous"];
}

type ActivityItem = {
  id: string;
  ticker: string;
  title: string;
  detail: string;
  kind: string;
  time: string;
};

type InterestLink = {
  name: string;
  url: string;
  description: string;
  mark: string;
  markClass: string;
  icon: typeof Search;
  tag: string;
};

const interestLinks: InterestLink[] = [
  { name: "Finviz", url: "https://finviz.com/", description: "Screener, mapas de mercado y cotizaciones", mark: "F", markClass: "bg-[#102a43] text-[#8fe3cf]", icon: Search, tag: "Mercado" },
  { name: "Dataroma", url: "https://www.dataroma.com/m/holdings.php?m=BRK", description: "Holdings de grandes inversores y fondos", mark: "D", markClass: "bg-[#17324d] text-[#f3c969]", icon: ShieldAlert, tag: "Holdings" },
  { name: "ETF.com", url: "https://www.etf.com/", description: "Investigación, comparaciones y análisis de ETF", mark: "ETF", markClass: "bg-[#e8f5f1] text-[#18766f]", icon: BarChart3, tag: "ETF" },
  { name: "MORNINGSTAR", url: "https://www.morningstar.com/etfs/arcx/gldm/performance", description: "Rendimiento histórico y evaluación de fondos", mark: "M*", markClass: "bg-[#ed1c24] text-white", icon: TrendingUp, tag: "Análisis" },
  { name: "CNBC World", url: "https://www.cnbc.com/world/?region=world", description: "Noticias económicas y mercados globales", mark: "CNBC", markClass: "bg-[#0b8b82] text-white", icon: Radio, tag: "Noticias" },
];

function formatNumber(value: number | null | undefined, decimals = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function formatTime(value?: string | number) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function formatExactDateTime(value?: string | number) {
  if (!value) return "fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDataAge(value?: string | number) {
  if (!value) return "antigüedad no disponible";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "antigüedad no disponible";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "hace menos de 1 min";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d ${hours % 24} h`;
}

function formatChartDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" });
}

const DCA_RSI_MIN = 30;
const DCA_RSI_MAX = 40;

function isDcaRsiRange(value: number | null | undefined) {
  return typeof value === "number" && value >= DCA_RSI_MIN && value <= DCA_RSI_MAX;
}

function signalTone(value = "") {
  const normalized = value.toLowerCase();
  if (normalized.includes("sin cálculo") || normalized.includes("sin calculo") || normalized.includes("pendiente")) return "unavailable";
  if (normalized.includes("compra") || normalized.includes("oportun") || normalized.includes("interesante")) return "positive";
  if (normalized.includes("evit") || normalized.includes("venta") || normalized.includes("riesgo") || normalized.includes("descart")) return "negative";
  return "neutral";
}

function alertDeliveryStatusLabel(status: string) {
  const labels: Record<string, string> = {
    accepted: "Enviado por Telegram",
    sending: "Enviando",
    digest_pending: "Irá en el resumen",
    digest_sent: "Incluido en el resumen",
    waiting_for_whatsapp_configuration: "Pendiente de configurar",
    failed: "No enviado",
    test_accepted: "Prueba enviada",
    test_waiting_for_whatsapp_configuration: "Prueba pendiente de configurar",
    test_failed: "Prueba no enviada",
  };
  return labels[status] ?? status;
}

function levelTone(value: number | null | undefined) {
  if (typeof value !== "number") return "";
  if (value >= 70) return "level-high";
  if (value >= 40) return "level-mid";
  return "level-low";
}

function differenceFromAverage(price: number, average: number | null) {
  if (average === null) return null;
  return ((price - average) / average) * 100;
}

function signalExplanation(asset: Asset) {
  if (asset.level === null) return `La cotización y el histórico disponible se muestran con normalidad. El cálculo JB completo se habilitará cuando Yahoo Finance reúna 200 sesiones válidas; ahora hay ${asset.historyDays} de 200.`;
  if (asset.rsi !== null && asset.rsi >= 65) return `El RSI está en ${formatNumber(asset.rsi, 1)}, por encima del límite de 65. La regla JB fija el nivel final en 10 para evitar perseguir un momentum exigente.`;
  if (asset.pointsSma === 0) return "El precio está sobre todas las SMA. La regla JB fija el nivel final en 10 porque no hay zona de descuento frente a las medias.";
  if (asset.rsi !== null && asset.pointsSma !== null && isDcaRsiRange(asset.rsi) && asset.pointsSma >= 30) return "Compra DCA en zona favorable: RSI entre 30 y 40 y precio por debajo de SMA50, SMA100 o SMA200.";
  if (asset.rsi !== null && asset.rsi < DCA_RSI_MIN) return `El RSI está en ${formatNumber(asset.rsi, 1)}: zona de sobreventa, pero fuera de la ventana DCA confirmada (30–40). Se mantiene en vigilancia.`;
  if (asset.rsi !== null && asset.rsi > DCA_RSI_MAX && asset.rsi < 65) return `El RSI está en ${formatNumber(asset.rsi, 1)}: hay descuento frente a las medias, pero no está en la ventana DCA de 30–40. No se marca como compra.`;
  return "El nivel suma los puntos de la zona SMA y los puntos del RSI; el resultado se trunca y se limita entre 10 y 100.";
}

function summarizeAssets(assets: Asset[]) {
  return {
    total: assets.length,
    opportunities: assets.filter((asset) => asset.level !== null && signalTone(asset.signal) === "positive").length,
    watch: assets.filter((asset) => asset.level !== null && signalTone(asset.signal) === "neutral").length,
    avoid: assets.filter((asset) => asset.level !== null && signalTone(asset.signal) === "negative").length,
  };
}

function statusLabel(value = "") {
  const normalized = value.toLowerCase();
  if (normalized.includes("open") || normalized.includes("abiert")) return "Mercado abierto";
  if (normalized.includes("close") || normalized.includes("cerrad")) return "Mercado cerrado";
  if (normalized.includes("demo")) return "Radar de demostración";
  return value || "Estado no disponible";
}

function exportCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const content = [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function MiniSparkline({ values, positive }: { values?: number[]; positive?: boolean }) {
  const points = values?.length ? values : [4, 5, 4.4, 6, 5.7, 7, 6.4];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((point, index) => `${(index / Math.max(points.length - 1, 1)) * 100},${28 - ((point - min) / span) * 23}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-[88px]" aria-label={positive ? "Tendencia ascendente" : "Tendencia de precio"}>
      <polyline points={coords} fill="none" stroke={positive ? CHART_COLORS.teal : CHART_COLORS.coral} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TickerMark({ value, large = false }: { value: string; large?: boolean }) {
  return <span translate="no" lang="en" className={`notranslate ticker-mark${large ? " ticker-mark-large" : ""}`}>{value.slice(0, 2)}</span>;
}

function TickerText({ value, className = "" }: { value: string; className?: string }) {
  return <span translate="no" lang="en" className={`notranslate ${className}`}>{value}</span>;
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[hsl(var(--muted))] ${className}`} />;
}

function CSVButton({ filename, rows }: { filename: string; rows: Record<string, unknown>[] }) {
  return (
    <button
      type="button"
      onClick={() => exportCSV(filename, rows)}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[hsl(var(--secondary))] hover:text-foreground print:hidden"
      aria-label={`Exportar ${filename} a CSV`}
      title="Exportar CSV"
    >
      <Download className="h-3.5 w-3.5" />
    </button>
  );
}

function SignalBadge({ value }: { value: string }) {
  const tone = signalTone(value);
  return <span className={`signal-badge signal-${tone}`}><span className="signal-dot" aria-hidden="true" />{value || "Sin señal"}</span>;
}

function MarketThermometerMark() {
  return (
    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-foreground text-background shadow-lg shadow-foreground/10 sm:h-16 sm:w-16" aria-hidden="true">
      <svg viewBox="0 0 64 64" className="h-10 w-10 sm:h-11 sm:w-11" fill="none">
        <path d="M21 12v27.5a10 10 0 1 0 8 0V12a4 4 0 0 0-8 0Z" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M25 28v17" stroke="hsl(var(--primary))" strokeWidth="4.5" strokeLinecap="round" />
        <circle cx="25" cy="49" r="6.5" fill="hsl(var(--primary))" />
        <path d="m35 43 6-7 6 4 8-12" stroke="hsl(var(--primary))" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M53 28h2v2" stroke="hsl(var(--primary))" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

type ColumnFilterKey = "asset" | "price" | "change" | "rsi" | "level" | "signal" | "trend";

type ColumnFilters = {
  asset: string;
  priceMin: string;
  priceMax: string;
  changeMin: string;
  changeMax: string;
  rsiMin: string;
  rsiMax: string;
  levelMin: string;
  levelMax: string;
  signal: string;
  trend: string;
};

const EMPTY_COLUMN_FILTERS: ColumnFilters = {
  asset: "",
  priceMin: "",
  priceMax: "",
  changeMin: "",
  changeMax: "",
  rsiMin: "",
  rsiMax: "",
  levelMin: "",
  levelMax: "",
  signal: "",
  trend: "",
};

function parseNumericFilter(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesNumericRange(value: number | null, min: string, max: string) {
  const lower = parseNumericFilter(min);
  const upper = parseNumericFilter(max);
  if (value === null) return lower === null && upper === null;
  return (lower === null || value >= lower) && (upper === null || value <= upper);
}

function NumberRangeFilter({ min, max, onMinChange, onMaxChange, step = "any" }: { min: string; max: string; onMinChange: (value: string) => void; onMaxChange: (value: string) => void; step?: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="column-filter-field">Mínimo<input type="number" inputMode="decimal" step={step} value={min} onChange={(event) => onMinChange(event.target.value)} placeholder="Desde" /></label>
      <label className="column-filter-field">Máximo<input type="number" inputMode="decimal" step={step} value={max} onChange={(event) => onMaxChange(event.target.value)} placeholder="Hasta" /></label>
    </div>
  );
}

function ColumnFilterMenu({ label, active, open, alignRight = false, onToggle, onClose, onClear, children }: { label: string; active: boolean; open: boolean; alignRight?: boolean; onToggle: () => void; onClose: () => void; onClear: () => void; children: ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <div ref={menuRef} className="column-filter-menu">
      <button type="button" onClick={onToggle} className={`column-filter-trigger${active ? " column-filter-trigger-active" : ""}`} aria-expanded={open} aria-label={`Filtrar columna ${label}`} title={`Filtrar por ${label}`}>
        <Filter className="h-3 w-3" /> <span>{label}</span>{active ? <span className="column-filter-active-dot" aria-hidden="true" /> : null}
      </button>
      {open ? <div className={`column-filter-popover${alignRight ? " column-filter-popover-right" : ""}`}>
        <div className="flex items-center justify-between gap-3 border-b border-card-border pb-2">
          <span className="text-[11px] font-bold">Filtrar por {label}</span>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Cerrar filtro de ${label}`}><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="pt-3">{children}</div>
        {active ? <button type="button" onClick={() => { onClear(); onClose(); }} className="mt-3 w-full rounded-lg border border-card-border px-2.5 py-2 text-[10px] font-bold text-muted-foreground hover:bg-secondary hover:text-foreground">Limpiar este filtro</button> : null}
      </div> : null}
    </div>
  );
}

function ColumnFilterToolbar({ filters, active, activeCount, openColumn, onToggle, onClose, onClear, onClearAll, onChange }: { filters: ColumnFilters; active: Record<ColumnFilterKey, boolean>; activeCount: number; openColumn: ColumnFilterKey | null; onToggle: (column: ColumnFilterKey) => void; onClose: () => void; onClear: (column: ColumnFilterKey) => void; onClearAll: () => void; onChange: (key: keyof ColumnFilters, value: string) => void }) {
  return (
    <div className="border-b border-card-border bg-card px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground"><SlidersHorizontal className="h-3.5 w-3.5 text-primary" /> Filtros por columna {activeCount ? <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground">{activeCount}</span> : null}</div>
        {activeCount ? <button type="button" onClick={onClearAll} className="text-[10px] font-bold text-primary hover:underline">Limpiar todos</button> : <span className="text-[10px] text-muted-foreground">Combina los filtros que quieras</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <ColumnFilterMenu label="Activo" active={active.asset} open={openColumn === "asset"} onToggle={() => onToggle("asset")} onClose={onClose} onClear={() => onClear("asset")}>
          <label className="column-filter-field">Ticker o nombre<input type="text" value={filters.asset} onChange={(event) => onChange("asset", event.target.value)} placeholder="Ej. NVDA o Microsoft" autoFocus /></label>
        </ColumnFilterMenu>
        <ColumnFilterMenu label="Precio" active={active.price} open={openColumn === "price"} onToggle={() => onToggle("price")} onClose={onClose} onClear={() => onClear("price")}>
          <NumberRangeFilter min={filters.priceMin} max={filters.priceMax} onMinChange={(value) => onChange("priceMin", value)} onMaxChange={(value) => onChange("priceMax", value)} step="0.01" />
        </ColumnFilterMenu>
        <ColumnFilterMenu label="Cambio" active={active.change} open={openColumn === "change"} onToggle={() => onToggle("change")} onClose={onClose} onClear={() => onClear("change")}>
          <NumberRangeFilter min={filters.changeMin} max={filters.changeMax} onMinChange={(value) => onChange("changeMin", value)} onMaxChange={(value) => onChange("changeMax", value)} step="0.01" />
          <p className="mt-2 text-[10px] text-muted-foreground">En porcentaje diario. Ej.: -5 a 3.</p>
        </ColumnFilterMenu>
        <ColumnFilterMenu label="RSI" active={active.rsi} open={openColumn === "rsi"} onToggle={() => onToggle("rsi")} onClose={onClose} onClear={() => onClear("rsi")}>
          <NumberRangeFilter min={filters.rsiMin} max={filters.rsiMax} onMinChange={(value) => onChange("rsiMin", value)} onMaxChange={(value) => onChange("rsiMax", value)} step="0.1" />
        </ColumnFilterMenu>
        <ColumnFilterMenu label="Nivel JB" active={active.level} open={openColumn === "level"} onToggle={() => onToggle("level")} onClose={onClose} onClear={() => onClear("level")}>
          <NumberRangeFilter min={filters.levelMin} max={filters.levelMax} onMinChange={(value) => onChange("levelMin", value)} onMaxChange={(value) => onChange("levelMax", value)} step="1" />
          <p className="mt-2 text-[10px] text-muted-foreground">Escala de 0 a 100.</p>
        </ColumnFilterMenu>
        <ColumnFilterMenu label="Señal" active={active.signal} open={openColumn === "signal"} onToggle={() => onToggle("signal")} onClose={onClose} onClear={() => onClear("signal")}>
          <label className="column-filter-field">Mostrar<select value={filters.signal} onChange={(event) => onChange("signal", event.target.value)}><option value="">Todas las señales</option><option value="Interesante">Interesante · oportunidad</option><option value="A considerar">A considerar · vigilar</option><option value="Descartado de momento">Descartado de momento</option></select></label>
        </ColumnFilterMenu>
        <ColumnFilterMenu label="Tendencia" active={active.trend} open={openColumn === "trend"} alignRight onToggle={() => onToggle("trend")} onClose={onClose} onClear={() => onClear("trend")}>
          <label className="column-filter-field">Dirección<select value={filters.trend} onChange={(event) => onChange("trend", event.target.value)}><option value="">Todas</option><option value="up">Al alza</option><option value="down">A la baja</option></select></label>
        </ColumnFilterMenu>
      </div>
    </div>
  );
}

function KPI({ label, value, note, tone = "coral", icon }: { label: string; value: string | number; note: string; tone?: "coral" | "teal" | "amber" | "ink"; icon: ReactNode }) {
  return (
    <div className="group rounded-2xl border border-card-border bg-card p-3 transition-transform duration-300 hover:-translate-y-0.5 sm:p-4">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <span className={`kpi-icon kpi-${tone}`}>{icon}</span>
      </div>
      <p className="mt-4 font-display text-[28px] font-bold tracking-[-0.06em] text-foreground sm:text-[30px]">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function ChartCard({ title, eyebrow, children, filename, rows, className = "" }: { title: string; eyebrow: string; children: ReactNode; filename: string; rows: Record<string, unknown>[]; className?: string }) {
  return (
    <section className={`break-avoid rounded-2xl border border-card-border bg-card ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-card-border px-4 py-4 sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>
          <h2 className="mt-1 font-display text-lg font-bold tracking-[-0.035em]">{title}</h2>
        </div>
        <CSVButton filename={filename} rows={rows} />
      </div>
      <div className="min-w-0 px-4 pb-4 pt-3">{children}</div>
    </section>
  );
}

function RefreshControl({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedIntervalMs, setSelectedIntervalMs] = useState(INTERVAL_OPTIONS[0].ms);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetMarketRadarQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMarketActivityQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetEmergingMarketIdeasQueryKey() });
    }, Math.max(selectedIntervalMs, 5 * 60 * 1000));
    return () => window.clearInterval(interval);
  }, [autoRefresh, selectedIntervalMs, queryClient]);

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex h-9 items-center overflow-hidden rounded-xl border border-card-border bg-card print:hidden">
        <button type="button" onClick={onRefresh} disabled={loading} className="flex h-full items-center gap-2 px-3 text-xs font-bold text-foreground transition-colors hover:bg-[hsl(var(--secondary))] disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 text-primary ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
        <div className="h-5 w-px bg-border" />
        <button type="button" onClick={() => setDropdownOpen((open) => !open)} className="flex h-full items-center px-2 text-muted-foreground transition-colors hover:bg-[hsl(var(--secondary))]" aria-label="Opciones de auto-actualización">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
        </button>
      </div>
      {dropdownOpen && (
        <div className="absolute right-0 top-11 z-40 w-64 rounded-2xl border border-card-border bg-card p-3 shadow-[0_18px_50px_rgba(20,40,50,.16)]">
          <div className="flex items-center justify-between border-b border-card-border px-2 pb-3">
            <div>
              <p className="text-sm font-bold">Auto-actualización</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{autoRefresh ? INTERVAL_OPTIONS.find((option) => option.ms === selectedIntervalMs)?.label : "Desactivada"}</p>
            </div>
            <button type="button" onClick={() => setAutoRefresh((enabled) => !enabled)} className={`relative h-6 w-11 rounded-full transition-colors ${autoRefresh ? "bg-primary" : "bg-muted"}`} aria-label="Activar auto-actualización" aria-pressed={autoRefresh}>
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-card transition-transform ${autoRefresh ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <div className="pt-2">
            <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Frecuencia</p>
            {INTERVAL_OPTIONS.map((option) => (
              <button type="button" key={option.ms} onClick={() => { setSelectedIntervalMs(option.ms); setAutoRefresh(true); setDropdownOpen(false); }} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs transition-colors hover:bg-[hsl(var(--secondary))]">
                <span>{option.label}</span>
                {option.ms === selectedIntervalMs && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ isDark, setIsDark }: { isDark: boolean; setIsDark: (value: boolean) => void }) {
  const [guideExpanded, setGuideExpanded] = useState(false);
  const [quietMode, setQuietMode] = useState(false);
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const asideRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const lockUntil = useRef(0);
  const [active, setActive] = useState("overview");
  const navItems = useMemo(() => [
    { key: "overview", label: "Vista general", icon: LayoutDashboard, target: null as string | null },
    { key: "signals", label: "Señales JB", icon: BarChart3, target: "signals" },
    { key: "recommended", label: "Recomendadas", icon: Star, target: "recommended" },
    { key: "watchlist", label: "Mi watchlist", icon: SlidersHorizontal, target: isSignedIn ? "radar-main" : "watchlist" },
    { key: "ideas", label: "Ideas emergentes", icon: Sparkles, target: "emerging-ideas" },
    ...(isSignedIn ? [{ key: "alerts", label: "Alertas", icon: BellRing, target: "watchlist" }] : []),
  ], [isSignedIn]);
  // Height of the sticky mobile bar, so sections are not hidden under it.
  const headerOffset = () => (window.matchMedia("(min-width: 1024px)").matches ? 16 : (asideRef.current?.offsetHeight ?? 0) + 12);
  const goTo = (key: string, target: string | null) => {
    setActive(key);
    lockUntil.current = Date.now() + 900;
    const element = target ? document.getElementById(target) : null;
    const top = element ? element.getBoundingClientRect().top + window.scrollY - headerOffset() : 0;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() < lockUntil.current) return;
      const line = headerOffset() + 60;
      // Signed out, the radar table is the base universe: treat it as part of "Señales JB".
      const spots = [...navItems.filter((item) => item.target).map((item) => ({ key: item.key, target: item.target! })), ...(isSignedIn ? [] : [{ key: "signals", target: "radar-main" }])];
      let current = "overview";
      let best = -Infinity;
      for (const spot of spots) {
        const element = document.getElementById(spot.target);
        if (!element) continue;
        const top = element.getBoundingClientRect().top;
        if (top <= line && top > best) { best = top; current = spot.key; }
      }
      // At the very bottom, short last sections never reach the line: pick the lowest visible one.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) {
        let lowest = -Infinity;
        for (const spot of spots) {
          const top = document.getElementById(spot.target)?.getBoundingClientRect().top;
          if (top !== undefined && top < window.innerHeight && top > lowest) { lowest = top; current = spot.key; }
        }
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [navItems, isSignedIn]);
  // On phones the tab row scrolls sideways: keep the active tab in view.
  useEffect(() => {
    const nav = navRef.current;
    const button = nav?.querySelector<HTMLElement>(`[data-nav="${active}"]`);
    if (!nav || !button || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: button.offsetLeft - nav.clientWidth / 2 + button.offsetWidth / 2, behavior: "smooth" });
  }, [active]);
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  return (
    <aside ref={asideRef} className={`sticky top-0 z-40 flex w-full flex-col border-b border-sidebar-border bg-sidebar px-5 py-3 text-sidebar-foreground shadow-sm transition-opacity duration-300 lg:fixed lg:py-6 lg:shadow-none lg:inset-y-0 lg:left-0 lg:w-[238px] lg:border-b-0 lg:border-r lg:px-4 ${quietMode ? "opacity-75" : ""}`}>
      <div className="flex items-center justify-between lg:block">
        <div className="flex items-center gap-3">
          <div className="brand-mark"><span>JB</span><i /></div>
          <div>
            <p className="font-display text-[15px] font-bold tracking-[-0.03em]">Termómetro</p>
            <p className="font-mono-app text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/55">Bursátil live</p>
          </div>
        </div>
        <button type="button" onClick={() => setQuietMode((mode) => !mode)} className="hidden rounded-lg p-2 text-sidebar-foreground/50 hover:bg-sidebar-accent lg:block" aria-label="Atenuar navegación" aria-pressed={quietMode}>
          <PanelLeftClose className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1 lg:hidden">
          {isSignedIn && ADMIN_EMAILS.has(email.toLowerCase()) && <a href={`${basePath}/admin`} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-bold text-sidebar-foreground/70 hover:bg-sidebar-accent" aria-label="Panel admin"><BarChart3 className="h-4 w-4" /></a>}
          {isSignedIn && <button type="button" onClick={() => void signOut({ redirectUrl: basePath || "/" })} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-bold text-sidebar-foreground/70 hover:bg-sidebar-accent" aria-label="Cerrar sesión"><LogOut className="h-4 w-4" /> Cerrar sesión</button>}
          <button type="button" onClick={() => setIsDark(!isDark)} className="rounded-lg p-2 text-sidebar-foreground/60 hover:bg-sidebar-accent" aria-label="Cambiar modo de color">
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="mt-7 hidden text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-foreground/40 lg:block">Radar</div>
      <nav ref={navRef} className="mt-3 flex gap-2 overflow-x-auto scrollbar-none lg:block lg:space-y-1" aria-label="Secciones">
        {navItems.map((item) => {
          const Icon = item.icon;
          return <button key={item.key} type="button" data-nav={item.key} aria-current={active === item.key ? "true" : undefined} onClick={() => goTo(item.key, item.target)} className={`sidebar-link${active === item.key ? " sidebar-link-active" : ""}`}><Icon className="h-4 w-4" /> {item.label}</button>;
        })}
      </nav>
      <div className="mt-auto hidden space-y-3 lg:block">
        <div className="rounded-2xl border border-sidebar-border bg-sidebar-accent/50 p-3">
          <div className="flex items-center gap-2 text-[11px] font-bold"><CircleHelp className="h-3.5 w-3.5 text-sidebar-primary" /> ¿Cómo leer el radar?</div>
          <p className="mt-2 text-[11px] leading-relaxed text-sidebar-foreground/55">La señal combina nivel JB, RSI y tendencia. No es una orden; es una brújula.</p>
          {guideExpanded && <p className="mt-2 border-t border-sidebar-border pt-2 text-[11px] leading-relaxed text-sidebar-foreground/55">Busca niveles bajos con RSI contenido y espera confirmación de tendencia. La paciencia también es una posición.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1"><button type="button" onClick={() => setGuideExpanded((expanded) => !expanded)} className="text-[11px] font-bold text-sidebar-primary hover:underline" aria-expanded={guideExpanded}>{guideExpanded ? "Cerrar guía" : "Abrir guía"}</button><a href={`${basePath}/metodologia`} className="text-[11px] font-bold text-sidebar-primary hover:underline">Metodología y evidencia <ArrowUpRight className="ml-0.5 inline h-3 w-3" /></a></div>
        </div>
        {isSignedIn && <div className="rounded-2xl border border-sidebar-border p-3">
          <p className="truncate text-[11px] text-sidebar-foreground/55" title={email}>{email || "Sesión iniciada"}</p>
          {ADMIN_EMAILS.has(email.toLowerCase()) && <a href={`${basePath}/admin`} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-sidebar-border px-3 py-2 text-xs font-bold text-sidebar-foreground hover:bg-sidebar-accent"><BarChart3 className="h-3.5 w-3.5" /> Panel admin</a>}
          <button type="button" onClick={() => void signOut({ redirectUrl: basePath || "/" })} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-sidebar-accent px-3 py-2 text-xs font-bold text-sidebar-foreground hover:opacity-90"><LogOut className="h-3.5 w-3.5" /> Cerrar sesión</button>
        </div>}
        <div className="flex items-center justify-between border-t border-sidebar-border pt-4">
           <span className="flex items-center gap-2 text-xs text-sidebar-foreground/55"><span className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" /> Datos Yahoo Finance</span>
          <button type="button" onClick={() => setIsDark(!isDark)} className="rounded-lg p-2 text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Cambiar modo de color">
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

function LoadingDashboard() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((item) => <SkeletonBlock key={item} className="h-[134px]" />)}</div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.42fr_.85fr]"><SkeletonBlock className="h-[300px]" /><SkeletonBlock className="h-[300px]" /></div>
      <SkeletonBlock className="h-[420px]" />
    </div>
  );
}

function InterestLinksPanel() {
  return (
    <section className="break-avoid rounded-2xl border border-card-border bg-card p-4 shadow-sm">
      <div className="border-b border-card-border pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.16em] text-accent"><Globe2 className="h-3 w-3" /> Recursos externos</div>
            <h2 className="font-display text-xl font-bold tracking-[-.03em]">Información de interés</h2>
            <p className="mt-1 max-w-[330px] text-[11px] leading-relaxed text-muted-foreground">Fuentes complementarias para ampliar el análisis del radar bursátil.</p>
          </div>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-foreground text-[#f7c96b]"><BarChart3 className="h-4 w-4" /></div>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Cada enlace se abre en una pestaña nueva</p>
      </div>

      <div className="space-y-2 py-4">
        {interestLinks.map((link) => {
          const Icon = link.icon;
          return (
            <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2.5 rounded-xl border border-card-border bg-background px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-md" aria-label={`Abrir ${link.name} en una pestaña nueva`}>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[10px] font-extrabold tracking-[-.04em] ${link.markClass}`}>{link.mark}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] font-extrabold">{link.name}</span>
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-[.1em] text-muted-foreground">{link.tag}</span>
                </span>
                <span className="mt-0.5 block truncate text-[10px] leading-relaxed text-muted-foreground">{link.description}</span>
              </span>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors group-hover:bg-accent/10 group-hover:text-accent"><Icon className="h-3.5 w-3.5" /></span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
            </a>
          );
        })}
      </div>

      <p className="rounded-xl bg-secondary/70 px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground">Las páginas enlazadas son servicios externos. JB Termómetro Bursátil no controla su contenido ni sus datos.</p>
    </section>
  );
}

function formatIdeaValue(value: number | null | undefined, suffix = "", decimals = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "No disponible";
  return `${formatNumber(value, decimals)}${suffix}`;
}

function EmergingMarketIdeasSection() {
  const ideasQuery = useGetEmergingMarketIdeas();
  const payload = ideasQuery.data;
  const ideas = (payload?.ideas ?? []).slice(0, 5);
  const stale = Boolean(payload?.stale);
  const hasPartialData = Boolean(payload?.errors?.length);

  return (
    <section id="emerging-ideas" className="break-avoid scroll-mt-6 overflow-hidden rounded-2xl border border-[#d7c79d] bg-card shadow-sm dark:border-[#6d5e38]" data-testid="section-emerging-market-ideas">
      <div className="border-b border-[#d7c79d]/70 bg-gradient-to-r from-[#f7efd8] via-card to-[#e8f2ee] px-4 py-5 dark:border-[#6d5e38] dark:from-[#332e20] dark:via-card dark:to-[#16322f] sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#c6a85b] bg-[#f5d889] text-[#634d19] shadow-[inset_0_2px_0_rgba(255,255,255,.5)] dark:border-[#9d8138] dark:bg-[#584923] dark:text-[#f7d77f]">
              <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground"><Sparkles className="h-2.5 w-2.5" /></span>
              <span className="text-xl" aria-hidden="true">✦</span>
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.16em] text-[#856b2b] dark:text-[#e4c875]"><Gem className="h-3 w-3" /> Cofres de investigación</p>
              <h2 className="mt-1 font-display text-xl font-bold tracking-[-.04em] sm:text-2xl">Ideas ETF de mercados emergentes</h2>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">Hasta 5 pistas para investigar, ordenadas con una lectura de tendencia y retorno de 200 sesiones.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start">
            {ideasQuery.isFetching && payload ? <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-bold text-accent" data-testid="status-emerging-ideas-refreshing">Actualizando…</span> : null}
            <span className="rounded-full border border-card-border bg-card/80 px-2.5 py-1 text-[10px] font-bold text-muted-foreground">{payload?.candidateUniverse.length ?? "—"} candidatos</span>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-1.5 border-t border-[#d7c79d]/70 pt-3 text-[10px] leading-relaxed text-muted-foreground dark:border-[#6d5e38] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
          <span data-testid="text-emerging-ideas-source">Fuente: {payload?.source ?? "Yahoo Finance"}</span>
          <span data-testid="text-emerging-ideas-updated">Actualizado: {payload?.updatedAt ? formatExactDateTime(payload.updatedAt) : "No disponible"}</span>
          <span>Cache servidor: 24 h{payload?.cached ? " · respuesta en caché" : ""}</span>
          {stale ? <span className="font-bold text-amber-700 dark:text-amber-300" data-testid="status-emerging-ideas-stale">Lectura retenida · puede estar desactualizada</span> : null}
        </div>
      </div>

      {stale ? <div className="flex items-start gap-2 border-b border-amber-300/70 bg-amber-50 px-4 py-3 text-[11px] leading-relaxed text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100" data-testid="status-emerging-ideas-stale-detail"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Yahoo Finance no entregó una lectura nueva. Estas ideas proceden de la última lectura válida y no son tiempo real.</span></div> : null}
      {hasPartialData ? <div className="border-b border-card-border bg-secondary/35 px-4 py-2.5 text-[10px] leading-relaxed text-muted-foreground" data-testid="status-emerging-ideas-partial">Datos parciales: {payload?.errors.join(" · ")}</div> : null}

      <div className="p-4 sm:p-6">
        {ideasQuery.isLoading && !payload ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="loading-emerging-ideas">
            {[1, 2, 3, 4, 5].map((item) => <SkeletonBlock key={item} className="h-[248px]" />)}
          </div>
        ) : ideasQuery.isError && !payload ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/5 px-5 py-8 text-center" data-testid="error-emerging-ideas">
            <ShieldAlert className="h-8 w-8 text-destructive" />
            <h3 className="mt-3 font-display text-lg font-bold">No hemos podido abrir los cofres</h3>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">La fuente de datos no respondió. No mostramos estimaciones ni rellenamos métricas ausentes.</p>
            <button type="button" onClick={() => void ideasQuery.refetch()} className="mt-4 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground" data-testid="button-retry-emerging-ideas">Reintentar</button>
          </div>
        ) : !ideas.length ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-card-border px-5 py-8 text-center" data-testid="empty-emerging-ideas">
            <Archive className="h-8 w-8 text-muted-foreground/60" />
            <h3 className="mt-3 font-display text-lg font-bold">Aún no hay ideas disponibles</h3>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">Necesitamos una lectura válida de Yahoo Finance para ordenar estas pistas. Las métricas sin fuente permanecen como «No disponible».</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="list-emerging-ideas">
            {ideas.map((idea, index) => (
              <article key={idea.ticker} className="group relative overflow-hidden rounded-2xl border border-card-border bg-background p-4 transition-all hover:-translate-y-0.5 hover:border-[#c6a85b] hover:shadow-lg dark:hover:border-[#9d8138]" data-testid={`card-emerging-idea-${idea.ticker}`}>
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#c6a85b] via-primary to-accent" />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f5d889]/55 font-display text-sm font-bold text-[#634d19] dark:bg-[#584923] dark:text-[#f7d77f]">{idea.rank ?? index + 1}</div>
                    <div className="min-w-0">
                      <a href={getYahooAdvancedChartUrl(idea.ticker)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono-app text-sm font-bold hover:text-primary" data-testid={`link-emerging-idea-${idea.ticker}`}><TickerText value={idea.ticker} /><ExternalLink className="h-3 w-3 text-muted-foreground" /></a>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={idea.name}>{idea.name}</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[9px] font-bold uppercase tracking-[.08em] text-muted-foreground">{idea.rank ? `#${idea.rank}` : "Sin rango"}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    ["Tendencia", idea.growthTrend ?? null],
                    ["Retorno 200 sesiones", formatIdeaValue(idea.return200Sessions, "%")],
                    ["Dividend yield", formatIdeaValue(idea.dividendYield, "%")],
                    ["P/E", formatIdeaValue(idea.peRatio)],
                    ["Margen beneficio", formatIdeaValue(idea.profitMargin, "%")],
                    ["Sesiones válidas", formatIdeaValue(idea.historySessions, "", 0)],
                  ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-secondary/55 px-2.5 py-2" data-testid={`metric-emerging-idea-${idea.ticker}-${String(label).toLowerCase().replaceAll(" ", "-")}`}><p className="text-[9px] font-bold uppercase tracking-[.08em] text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono-app text-[11px] font-bold text-foreground">{value ?? "No disponible"}</p></div>)}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-card-border pt-3 text-[10px] text-muted-foreground">
                  <span>{idea.score === null ? "Score: No disponible" : `Score: ${formatNumber(idea.score)}`}</span>
                  <span className="flex items-center gap-1 text-[#856b2b] dark:text-[#e4c875]"><Sparkles className="h-3 w-3" /> Para investigar</span>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="mt-4 rounded-xl border border-card-border bg-secondary/40 px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground" data-testid="disclaimer-emerging-ideas">Estas son <strong className="text-foreground">ideas para investigar</strong>, no recomendaciones ni asesoramiento financiero. El ranking no cambia las señales JB ni sustituye sus reglas de RSI/SMA. Los datos fundamentales dependen de Yahoo Finance y se muestran como «No disponible» cuando no están publicados.</div>
      </div>
    </section>
  );
}

function ActivityFeed({ activity, loading, error }: { activity: ActivityItem[]; loading: boolean; error: boolean }) {
  return (
    <section className="break-avoid rounded-2xl border border-card-border bg-card">
      <div className="flex items-start justify-between border-b border-card-border px-5 py-4">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Registro en vivo</p><h2 className="mt-1 font-display text-lg font-bold tracking-[-0.035em]">Últimos movimientos</h2></div>
        <ActivityIcon className="mt-1 h-4 w-4 text-primary" />
      </div>
      <div className="px-5 py-2">
        {loading ? [1, 2, 3, 4].map((item) => <div key={item} className="flex gap-3 border-b border-card-border py-4 last:border-0"><SkeletonBlock className="h-8 w-8 shrink-0 rounded-full" /><div className="w-full space-y-2"><SkeletonBlock className="h-3 w-3/4" /><SkeletonBlock className="h-3 w-1/2" /></div></div>) : error ? (
          <div className="flex flex-col items-center py-12 text-center"><Wifi className="h-7 w-7 text-muted-foreground/60" /><p className="mt-3 text-sm font-bold">Actividad no disponible</p><p className="mt-1 max-w-[220px] text-xs leading-relaxed text-muted-foreground">El radar principal sigue operativo. Reintentaremos en la próxima actualización.</p></div>
        ) : activity.length ? activity.slice(0, 6).map((item) => {
          const tone = signalTone(item.kind);
          return <div key={item.id} className="flex gap-3 border-b border-card-border py-4 last:border-0"><div className={`activity-icon activity-${tone}`}><Radio className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><p className="truncate text-xs font-bold">{item.title}</p><span className="shrink-0 font-mono-app text-[10px] text-muted-foreground">{formatTime(item.time)}</span></div><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground"><TickerText value={item.ticker} className="font-mono-app font-medium text-foreground" /> · {item.detail}</p></div></div>;
        }) : <div className="flex flex-col items-center py-12 text-center"><Sparkles className="h-7 w-7 text-muted-foreground/60" /><p className="mt-3 text-sm font-bold">Radar tranquilo</p><p className="mt-1 text-xs text-muted-foreground">No hay cambios de señal recientes.</p></div>}
      </div>
    </section>
  );
}

function AssetAnalysisModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const averages = [
    { label: "SMA20", value: asset.sma20, description: "Media de corto plazo" },
    { label: "SMA50", value: asset.sma50, description: "Media de referencia" },
    { label: "SMA100", value: asset.sma100, description: "Media intermedia" },
    { label: "SMA200", value: asset.sma200, description: "Media de largo plazo" },
  ];
  const positiveChange = asset.change === null ? null : asset.change >= 0;
  const hasFullTechnicalHistory = asset.level !== null;
  const history = asset.history ?? [];
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(16,28,36,.46)] p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onClick={onClose}>
    <div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-card-border bg-card p-5 shadow-2xl sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3"><TickerMark value={asset.ticker} large /><div><p className="font-mono-app text-sm font-bold"><TickerText value={asset.ticker} /> <span translate="no" className="notranslate ml-1 font-sans text-[10px] font-medium text-muted-foreground">{asset.type}</span></p><p className="mt-0.5 text-xs text-muted-foreground">{asset.name}</p></div></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary" aria-label="Cerrar detalle"><X className="h-4 w-4" /></button>
      </div>

      <a
        href={getYahooAdvancedChartUrl(asset.ticker)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 transition-colors hover:border-primary/45 hover:bg-primary/10"
        aria-label={`Abrir gráfico avanzado de Yahoo Finance para ${asset.ticker}`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><BarChart3 className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="block text-xs font-bold">Abrir gráfico avanzado en Yahoo Finance</span>
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">1D · 1Y · RSI 14 · SMA20 · SMA50 · SMA100 · SMA200</span>
          </span>
        </span>
        <ExternalLink className="h-4 w-4 shrink-0 text-primary" />
      </a>

       {!hasFullTechnicalHistory && <div className="mt-4 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"><strong className="text-foreground">Datos actuales disponibles.</strong> Yahoo Finance ha devuelto {asset.historyDays} sesiones válidas; la señal y el Nivel JB se habilitarán al completar 200 sesiones para SMA200.</div>}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
         <div className="detail-stat"><span>Última cotización</span><strong>{formatNumber(asset.price)}</strong><small>{asset.quoteUpdatedAt ? formatTime(asset.quoteUpdatedAt) : "Yahoo Finance"}</small></div>
        <div className="detail-stat"><span>Cambio diario</span><strong className={positiveChange === null ? "text-muted-foreground" : positiveChange ? "text-accent" : "text-destructive"}>{formatPercent(asset.change)}</strong></div>
        <div className="detail-stat"><span>RSI Wilder 14</span><strong>{formatNumber(asset.rsi, 1)}</strong></div>
        <div className="detail-stat"><span>Posición JB</span><strong className="text-xs leading-tight">{asset.position}</strong></div>
      </div>

      <AssetInsights ticker={asset.ticker} price={asset.price} fallbackHistory={history} dcaContent={<>
      <section className="mt-5 rounded-2xl border border-card-border bg-secondary/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold">Precio frente a medias móviles</p><p className="mt-0.5 text-[11px] text-muted-foreground">Cierres diarios de Yahoo Finance; cada lectura compara el último precio con su media.</p></div><span className="rounded-full bg-card px-2.5 py-1 font-mono-app text-[10px] text-muted-foreground">Histórico diario</span></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{averages.map((average) => {
          const difference = differenceFromAverage(asset.price, average.value);
          const above = difference === null ? null : difference >= 0;
          return <div key={average.label} className="rounded-xl border border-card-border bg-card px-3 py-2.5"><div className="flex items-start justify-between gap-3"><div><p className="font-mono-app text-xs font-bold">{average.label} <span className="font-sans font-medium text-muted-foreground">{formatNumber(average.value)}</span></p><p className="mt-0.5 text-[10px] text-muted-foreground">{average.description}</p></div><span className={`shrink-0 text-[10px] font-bold ${above === null ? "text-muted-foreground" : above ? "text-accent" : "text-destructive"}`}>{above === null ? "Pendiente" : above ? "Por encima" : "Por debajo"}</span></div><p className={`mt-2 font-mono-app text-[11px] ${above === null ? "text-muted-foreground" : above ? "text-accent" : "text-destructive"}`}>{difference === null ? `Requiere más sesiones para ${average.label}` : `${formatPercent(difference)} frente a ${average.label}`}</p></div>;
        })}</div>
      </section>

      <section className="mt-4 rounded-2xl border border-card-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold">Cómo se calcula la señal JB</p><p className="mt-0.5 text-[11px] text-muted-foreground">Explicación de la regla actual, no una recomendación de inversión.</p></div><SignalBadge value={asset.signal} /></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">1 · Zona SMA</p><p className="mt-1 font-mono-app text-lg font-bold">{asset.pointsSma === null ? "Pendiente" : `${formatNumber(asset.pointsSma, 0)} pts`}</p><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{asset.position}</p></div>
          <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">2 · RSI 14</p><p className="mt-1 font-mono-app text-lg font-bold">{asset.pointsRsi === null ? "Pendiente" : `${formatNumber(asset.pointsRsi, 1)} pts`}</p><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">RSI {formatNumber(asset.rsi, 1)} · fórmula limitada a 0–50 puntos.</p></div>
          <div className="rounded-xl bg-secondary/50 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">3 · Nivel final</p><p className={`mt-1 font-mono-app text-lg font-bold ${levelTone(asset.level)}`}>{asset.level === null ? "Pendiente" : `${asset.level} / 100`}</p><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{hasFullTechnicalHistory ? "La regla trunca la suma y aplica sus límites de seguridad." : "Se calculará al contar con SMA200."}</p></div>
        </div>
        <p className="mt-3 rounded-xl bg-primary/5 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">{signalExplanation(asset)}</p>
      </section>
      </>} />
    </div>
  </div>;
}

function MobileAssetCard({ asset, isPersonal, onSelect, onRemove }: { asset: Asset; isPersonal: boolean; onSelect: () => void; onRemove?: () => void }) {
  const positive = asset.change === null ? null : asset.change >= 0;
  return (
    <article className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onSelect} className="flex min-w-0 items-center gap-3 text-left">
          <TickerMark value={asset.ticker} />
          <span className="min-w-0">
            <TickerText value={asset.ticker} className="block font-mono-app text-[12px] font-medium" />
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{asset.name}</span>
          </span>
        </button>
        <SignalBadge value={asset.signal} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-secondary/55 px-3 py-2"><span className="block text-muted-foreground">Precio</span><strong className="mt-1 block font-mono-app text-xs">{formatNumber(asset.price)}</strong></div>
        <div className="rounded-lg bg-secondary/55 px-3 py-2"><span className="block text-muted-foreground">Cambio</span><strong className={`mt-1 block font-mono-app text-xs ${positive === null ? "text-muted-foreground" : positive ? "text-accent" : "text-destructive"}`}>{positive === null ? null : positive ? <ArrowUpRight className="mr-1 inline h-3 w-3" /> : <ArrowDownRight className="mr-1 inline h-3 w-3" />}{formatPercent(asset.change)}</strong></div>
         <div className="rounded-lg bg-secondary/55 px-3 py-2"><span className="block text-muted-foreground">RSI 14</span><strong className={`mt-1 block font-mono-app text-xs ${asset.rsi === null ? "text-muted-foreground" : isDcaRsiRange(asset.rsi) ? "text-accent" : asset.rsi > 65 ? "text-destructive" : asset.rsi < DCA_RSI_MIN ? "text-primary" : "text-foreground"}`}>{formatNumber(asset.rsi, 0)}</strong></div>
        <div className="rounded-lg bg-secondary/55 px-3 py-2"><span className="block text-muted-foreground">Nivel JB</span><strong className={`mt-1 block font-mono-app text-xs ${asset.level === null ? "text-muted-foreground" : levelTone(asset.level)}`}>{asset.level === null ? "Pendiente" : `${asset.level} / 100`}</strong></div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <MiniSparkline values={asset.sparkline} positive={positive ?? asset.trend !== "down"} />
        <div className="flex items-center gap-1">
          <button type="button" onClick={onSelect} className="rounded-lg px-2 py-1.5 text-[10px] font-bold text-muted-foreground hover:bg-secondary hover:text-foreground">Análisis</button>
          {isPersonal && onRemove ? <button type="button" onClick={onRemove} className="rounded-lg px-2 py-1.5 text-[10px] font-bold text-muted-foreground hover:bg-secondary hover:text-destructive">Quitar</button> : null}
        </div>
      </div>
    </article>
  );
}

function RadarTable({ assets, loading, baseTickers, personalTickers }: { assets: Asset[]; loading: boolean; baseTickers: Set<string>; personalTickers: Set<string> }) {
  const { isSignedIn, userId } = useAuth();
  const radarSectionRef = useRef<HTMLElement>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Todas");
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({ ...EMPTY_COLUMN_FILTERS });
  const [openColumnFilter, setOpenColumnFilter] = useState<ColumnFilterKey | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const queryClient = useQueryClient();
  const addMutation = useAddWatchlistItem();
  const removeMutation = useRemoveWatchlistItem();
  const watchlistRadarKey = useMemo(() => scopeUserQuery(getGetWatchlistRadarQueryKey(), userId), [userId]);
  const watchlistKey = useMemo(() => scopeUserQuery(getGetWatchlistQueryKey(), userId), [userId]);
  const instrumentSearch = useSearchMarketInstruments({ q: searchQuery }, { query: { queryKey: ["market-search", searchQuery], enabled: searchQuery.length >= 2, retry: false } });
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchQuery(search.trim()), 320);
    return () => window.clearTimeout(timeout);
  }, [search]);
  // Deep link from Telegram alerts: /?ticker=SCHD opens that asset's analysis.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || !assets.length) return;
    const wanted = new URLSearchParams(window.location.search).get("ticker")?.toUpperCase();
    if (!wanted) { deepLinkHandled.current = true; return; }
    // Wait until the personal radar (signed-in watchlist) has the asset.
    const match = assets.find((asset) => asset.ticker === wanted);
    if (!match) return;
    deepLinkHandled.current = true;
    setSelected(match);
    const url = new URL(window.location.href);
    url.searchParams.delete("ticker");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [assets, loading]);
  useEffect(() => {
    const section = radarSectionRef.current;
    if (!section) return;
    section.setAttribute("translate", "no");
    section.classList.add("notranslate");
  }, []);
  const columnFilterActive: Record<ColumnFilterKey, boolean> = {
    asset: Boolean(columnFilters.asset.trim()),
    price: Boolean(columnFilters.priceMin || columnFilters.priceMax),
    change: Boolean(columnFilters.changeMin || columnFilters.changeMax),
    rsi: Boolean(columnFilters.rsiMin || columnFilters.rsiMax),
    level: Boolean(columnFilters.levelMin || columnFilters.levelMax),
    signal: Boolean(columnFilters.signal),
    trend: Boolean(columnFilters.trend),
  };
  const activeColumnFilterCount = Object.values(columnFilterActive).filter(Boolean).length;
  const updateColumnFilter = (key: keyof ColumnFilters, value: string) => {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  };
  const clearColumnFilter = (column: ColumnFilterKey) => {
    setColumnFilters((current) => {
      if (column === "asset") return { ...current, asset: "" };
      if (column === "price") return { ...current, priceMin: "", priceMax: "" };
      if (column === "change") return { ...current, changeMin: "", changeMax: "" };
      if (column === "rsi") return { ...current, rsiMin: "", rsiMax: "" };
      if (column === "level") return { ...current, levelMin: "", levelMax: "" };
      if (column === "signal") return { ...current, signal: "" };
      return { ...current, trend: "" };
    });
  };
  const filtered = useMemo(() => assets.filter((asset) => {
    const globalSearch = search.toLowerCase();
    const columnSearch = columnFilters.asset.trim().toLowerCase();
    const matchesSearch = !globalSearch || `${asset.ticker} ${asset.name}`.toLowerCase().includes(globalSearch);
    const matchesAsset = !columnSearch || `${asset.ticker} ${asset.name}`.toLowerCase().includes(columnSearch);
    const matchesFilter = filter === "Todas" || signalTone(asset.signal) === filter;
    const matchesPrice = matchesNumericRange(asset.price, columnFilters.priceMin, columnFilters.priceMax);
    const matchesChange = matchesNumericRange(asset.change, columnFilters.changeMin, columnFilters.changeMax);
    const matchesRsi = matchesNumericRange(asset.rsi, columnFilters.rsiMin, columnFilters.rsiMax);
    const matchesLevel = matchesNumericRange(asset.level, columnFilters.levelMin, columnFilters.levelMax);
    const matchesSignal = !columnFilters.signal || asset.signal === columnFilters.signal;
    const matchesTrend = !columnFilters.trend || asset.trend === columnFilters.trend;
    return matchesSearch && matchesAsset && matchesFilter && matchesPrice && matchesChange && matchesRsi && matchesLevel && matchesSignal && matchesTrend;
  }), [assets, columnFilters, filter, search]);
  const removeTicker = async (ticker: string) => {
    if (!window.confirm(`¿Quitar ${ticker} de tu radar principal? Dejará de formar parte de tu seguimiento personal.`)) return;
    setSearchMessage("");
    try {
      await removeMutation.mutateAsync({ ticker });
      setSearchMessage(`${ticker} se eliminó de tu radar principal.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: watchlistRadarKey }),
        queryClient.invalidateQueries({ queryKey: watchlistKey }),
      ]);
    } catch {
      setSearchMessage(`No pudimos eliminar ${ticker}. Inténtalo de nuevo.`);
    }
  };

  return (
    <section ref={radarSectionRef} id="radar-main" translate="no" className="notranslate break-avoid min-w-0 overflow-hidden rounded-2xl border border-card-border bg-card">
      <div className="flex min-w-0 flex-col gap-4 border-b border-card-border px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Universo JB · radar principal</p><h2 className="mt-1 font-display text-lg font-bold tracking-[-0.035em]">Radar de activos</h2><p className="mt-1 text-[10px] text-muted-foreground">{isSignedIn ? "Solo muestra los activos que has elegido seguir." : "Consulta el universo base y entra para crear tu radar personal."}</p></div>
        <div className="flex flex-wrap items-center gap-2">
           <div className="relative w-full sm:w-52"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por ticker o nombre" className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary" /></div>
          <div className="flex h-8 max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-input bg-background px-1"><Filter className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />{["Todas", "positive", "neutral", "negative"].map((item) => <button type="button" key={item} onClick={() => setFilter(item)} className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold transition-colors ${filter === item ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{item === "Todas" ? "Todas" : item === "positive" ? "Compra" : item === "negative" ? "Evitar" : "Vigilar"}</button>)}</div>
        </div>
      </div>
      {searchQuery.length >= 2 && <div className="border-b border-card-border bg-[hsl(var(--secondary))]/35 px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Resultados de Yahoo Finance</p>{instrumentSearch.isFetching && <span className="text-[10px] text-muted-foreground">Buscando…</span>}</div>
        {instrumentSearch.error ? <p className="mt-2 text-[11px] text-destructive">No pudimos buscar ahora. Inténtalo de nuevo.</p> : instrumentSearch.data?.length ? <div className="mt-2 grid gap-2 md:grid-cols-2">{instrumentSearch.data.map((instrument) => {
          const inPersonalRadar = personalTickers.has(instrument.ticker);
          const inBaseRadar = baseTickers.has(instrument.ticker);
          return <div key={instrument.ticker} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-3 py-2">
            <div className="min-w-0"><p className="font-mono-app text-xs font-bold">{instrument.ticker} <span className="ml-1 font-sans text-[10px] font-medium text-muted-foreground">{instrument.type}</span></p><p className="truncate text-[10px] text-muted-foreground">{instrument.name}</p><p className={`mt-1 text-[10px] font-bold ${instrument.available ? instrument.analysisReady ? "text-accent" : "text-muted-foreground" : "text-destructive"}`}>{instrument.available ? instrument.analysisReady ? "Disponible para cálculo JB" : `Disponible con datos actuales · ${instrument.historyDays}/200 sesiones` : "No disponible en Yahoo Finance"}</p></div>
            <Show when="signed-in">{inPersonalRadar || inBaseRadar ? <span className="shrink-0 text-right text-[10px] font-bold text-accent">{inPersonalRadar ? "En tu radar" : "En radar base"}</span> : <button type="button" onClick={() => { void addMutation.mutateAsync({ data: { ticker: instrument.ticker } }).then(async () => { setSearch(""); setSearchQuery(""); setSearchMessage(`${instrument.ticker} añadido al radar principal.`); await queryClient.invalidateQueries({ queryKey: watchlistRadarKey }); await queryClient.invalidateQueries({ queryKey: watchlistKey }); }).catch((error) => setSearchMessage(error instanceof Error ? error.message.replace(/^HTTP \d+ \w+: /, "") : "No pudimos añadir el activo.")); }} disabled={addMutation.isPending} className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-bold text-primary-foreground disabled:opacity-50">Añadir</button>}</Show>
            <Show when="signed-out"><a href={`${basePath}/sign-in`} className="shrink-0 rounded-lg border border-primary/30 px-2.5 py-1.5 text-[10px] font-bold text-primary">Entrar para añadir</a></Show>
          </div>;
        })}</div> : !instrumentSearch.isFetching ? <p className="mt-2 text-[11px] text-muted-foreground">No encontramos instrumentos compatibles. Prueba otro nombre o ticker.</p> : null}
        {searchMessage && <p className="mt-2 text-[11px] font-bold text-accent">{searchMessage}</p>}
      </div>}
      <div className="border-b border-card-border bg-secondary/25 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-muted-foreground">
          <span className="font-bold uppercase tracking-[0.12em] text-foreground">Cómo leer el radar</span>
           <span><strong className="text-foreground">Nivel JB</strong>: 0–39 esperar · 40–69 vigilar · 70–100 oportunidad técnica</span>
          <span className="flex items-center gap-1.5"><i className="legend-dot legend-high" /> Compra DCA: RSI 30–40 + debajo de SMA50 o superior</span>
          <span className="flex items-center gap-1.5"><i className="legend-dot legend-low" /> Bajo</span>
          <span className="flex items-center gap-1.5"><i className="legend-dot legend-mid" /> Medio</span>
          <span className="flex items-center gap-1.5"><i className="legend-dot legend-high" /> Alto</span>
        </div>
      </div>
      <ColumnFilterToolbar filters={columnFilters} active={columnFilterActive} activeCount={activeColumnFilterCount} openColumn={openColumnFilter} onToggle={(column) => setOpenColumnFilter((current) => current === column ? null : column)} onClose={() => setOpenColumnFilter(null)} onClear={clearColumnFilter} onClearAll={() => { setColumnFilters({ ...EMPTY_COLUMN_FILTERS }); setOpenColumnFilter(null); }} onChange={updateColumnFilter} />
      <div>
           {loading ? <div className="space-y-2 p-4 sm:p-5">{[1, 2, 3, 4, 5].map((item) => <SkeletonBlock key={item} className="h-12 w-full" />)}</div> : filtered.length ? <>
            <div className="divide-y divide-card-border/70 md:hidden">{filtered.map((asset) => <MobileAssetCard key={asset.ticker} asset={asset} isPersonal={personalTickers.has(asset.ticker)} onSelect={() => setSelected(asset)} onRemove={personalTickers.has(asset.ticker) ? () => void removeTicker(asset.ticker) : undefined} />)}</div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[850px] text-left">
                  <thead><tr className="border-b border-card-border text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"><th className="px-5 py-3">Activo</th><th className="px-3 py-3">Precio</th><th className="px-3 py-3">Cambio</th><th className="px-3 py-3">RSI</th><th className="px-3 py-3">Nivel JB · 0–100</th><th className="px-3 py-3">Señal</th><th className="px-3 py-3">Tendencia</th><th className="px-5 py-3 text-right"> </th></tr></thead>
                  <tbody>{filtered.map((asset) => {
                    const positive = asset.change === null ? null : asset.change >= 0;
                    const isPersonal = personalTickers.has(asset.ticker);
                    const rsiTone = asset.rsi === null ? "text-muted-foreground" : isDcaRsiRange(asset.rsi) ? "text-accent" : asset.rsi > 65 ? "text-destructive" : asset.rsi < DCA_RSI_MIN ? "text-primary" : "text-foreground";
                    const rsiFill = asset.rsi === null ? "bg-muted-foreground/35" : isDcaRsiRange(asset.rsi) ? "bg-accent" : asset.rsi > 65 ? "bg-destructive" : asset.rsi < DCA_RSI_MIN ? "bg-primary" : "bg-[hsl(39_85%_52%)]";
                    return <tr key={asset.ticker} className="group border-b border-card-border/70 transition-colors last:border-0 hover:bg-secondary/45">
                      <td className="px-5 py-3.5"><button type="button" onClick={() => setSelected(asset)} className="flex items-center gap-3 text-left"><span className="ticker-mark">{asset.ticker.slice(0, 2)}</span><span><span className="block font-mono-app text-[12px] font-medium">{asset.ticker}</span><span className="mt-0.5 block max-w-[170px] truncate text-[11px] text-muted-foreground">{asset.name}</span></span></button></td>
                      <td className="px-3 py-3.5 font-mono-app text-[12px]">{formatNumber(asset.price)}</td>
                      <td className={`px-3 py-3.5 font-mono-app text-[12px] font-medium ${positive === null ? "text-muted-foreground" : positive ? "text-[hsl(171,42%,32%)] dark:text-[hsl(171,47%,58%)]" : "text-[hsl(2,67%,48%)] dark:text-[hsl(2,75%,65%)]"}`}>{positive === null ? null : positive ? <ArrowUpRight className="mr-1 inline h-3 w-3" /> : <ArrowDownRight className="mr-1 inline h-3 w-3" />}{formatPercent(asset.change)}</td>
                      <td className="px-3 py-3.5"><div className="flex items-center gap-2"><span className={`font-mono-app text-[12px] ${rsiTone}`}>{formatNumber(asset.rsi, 0)}</span><div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${rsiFill}`} style={{ width: `${asset.rsi === null ? 0 : Math.min(Math.max(asset.rsi, 0), 100)}%` }} /></div></div></td>
                      <td className="px-3 py-3.5">{asset.level === null ? <span className="font-mono-app text-[12px] text-muted-foreground">Pendiente</span> : <div className="flex items-center gap-2"><span className={`level-number ${levelTone(asset.level)}`}>{asset.level}</span><div className="level-track"><span className={`level-fill ${levelTone(asset.level)}`} style={{ width: `${Math.min(Math.max(asset.level, 0), 100)}%` }} /></div></div>}</td>
                      <td className="px-3 py-3.5"><SignalBadge value={asset.signal} /></td>
                      <td className="px-3 py-3.5"><MiniSparkline values={asset.sparkline} positive={positive ?? asset.trend !== "down"} /></td>
                      <td className="px-5 py-3.5 text-right"><div className="flex items-center justify-end gap-1"><button type="button" onClick={() => setSelected(asset)} className="rounded-lg p-2 text-muted-foreground opacity-0 transition-all hover:bg-secondary hover:text-foreground group-hover:opacity-100" aria-label={`Ver detalle de ${asset.ticker}`}><MoreHorizontal className="h-4 w-4" /></button>{isPersonal ? <button type="button" onClick={() => void removeTicker(asset.ticker)} className="rounded-lg p-2 text-muted-foreground transition-all hover:bg-secondary hover:text-destructive" aria-label={`Quitar ${asset.ticker} de tu radar`} title={`Quitar ${asset.ticker} de tu radar`}><X className="h-4 w-4" /></button> : null}</div></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
           </> : <div className="flex flex-col items-center px-4 py-14 text-center">{assets.length === 0 && isSignedIn ? <><Plus className="h-7 w-7 text-primary/70" /><p className="mt-3 text-sm font-bold">Tu radar está vacío</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">Busca una acción o ETF arriba para añadirlo a tu seguimiento personal.</p><span className="mt-3 rounded-lg bg-secondary px-3 py-1.5 font-mono-app text-[10px] text-muted-foreground">Ejemplo: MSFT · SPYM · QQQM</span></> : <><Search className="h-7 w-7 text-muted-foreground/50" /><p className="mt-3 text-sm font-bold">Sin coincidencias</p><p className="mt-1 text-xs text-muted-foreground">Prueba otro ticker o cambia el filtro.</p></>}</div>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-card-border px-4 py-3 text-[11px] text-muted-foreground sm:px-5"><span>{filtered.length} de {assets.length} activos visibles</span><span className="shrink-0 font-mono-app">JB / v1.0</span></div>
       {selected && <AssetAnalysisModal asset={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function PersonalWatchlist() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const watchlistKey = useMemo(() => scopeUserQuery(getGetWatchlistQueryKey(), userId), [userId]);
  const watchlistRadarKey = useMemo(() => scopeUserQuery(getGetWatchlistRadarQueryKey(), userId), [userId]);
  const deliveriesKey = useMemo(() => scopeUserQuery(getGetAlertDeliveriesQueryKey(), userId), [userId]);
  const privateQuery = { enabled: Boolean(userId) };
  const watchlistQuery = useGetWatchlist({ query: { queryKey: watchlistKey, ...privateQuery } });
  const personalRadarQuery = useGetWatchlistRadar({ query: { queryKey: watchlistRadarKey, ...privateQuery } });
  const deliveriesQuery = useGetAlertDeliveries({ query: { queryKey: deliveriesKey, ...privateQuery } });
  const addMutation = useAddWatchlistItem();
  const removeMutation = useRemoveWatchlistItem();
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const instrumentSearch = useSearchMarketInstruments({ q: searchQuery }, { query: { queryKey: ["market-search", searchQuery], enabled: searchQuery.length >= 2, retry: false } });

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchQuery(searchText.trim()), 320);
    return () => window.clearTimeout(timeout);
  }, [searchText]);

  const refreshPersonalData = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: watchlistKey }),
    queryClient.invalidateQueries({ queryKey: watchlistRadarKey }),
    queryClient.invalidateQueries({ queryKey: deliveriesKey }),
  ]);
  const listed = new Set((watchlistQuery.data ?? []).map((item) => item.ticker));
  const watchAssets = (personalRadarQuery.data?.assets ?? []) as Asset[];

  const addTicker = async (ticker: string) => {
    if (!ticker.trim()) return;
    setMessage("");
    try {
      await addMutation.mutateAsync({ data: { ticker: ticker.trim().toUpperCase() } });
      setSearchText("");
      setSearchQuery("");
      setMessage("Activo añadido a tu watchlist.");
      await refreshPersonalData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message.replace(/^HTTP \d+ \w+: /, "") : "No pudimos añadir ese ticker. Comprueba el símbolo e inténtalo de nuevo.");
    }
  };
  const removeTicker = async (ticker: string) => {
    if (!window.confirm(`¿Quitar ${ticker} de tu radar personal? Tus alertas para este activo dejarán de evaluarse.`)) return;
    setMessage("");
    try {
      await removeMutation.mutateAsync({ ticker });
      setMessage(`${ticker} se eliminó de tu radar personal.`);
      await refreshPersonalData();
    } catch {
      setMessage(`No pudimos eliminar ${ticker}. Inténtalo de nuevo.`);
    }
  };
  return (
    <section id="watchlist" translate="no" className="notranslate scroll-mt-6 rounded-2xl border border-card-border bg-card">
      <div className="flex flex-col gap-3 border-b border-card-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Preferencias personales</p><h2 className="mt-1 font-display text-lg font-bold tracking-[-0.035em]">Alertas y configuración</h2><p className="mt-1 text-[10px] text-muted-foreground">Los activos que añadas aparecen directamente en el radar principal.</p></div>
      </div>
      <div className="hidden border-b border-card-border bg-secondary/20 px-5 py-4">
        <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Busca por ticker o nombre</label>
        <div className="relative mt-2 max-w-2xl"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Ej.: VOO, Apple, Vanguard S&P 500…" className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-xs outline-none transition-colors focus:border-primary" /></div>
        {searchText.trim().length > 0 && searchText.trim().length < 2 ? <p className="mt-2 text-[11px] text-muted-foreground">Escribe al menos 2 caracteres para buscar.</p> : null}
        {instrumentSearch.isFetching ? <p className="mt-2 text-[11px] text-muted-foreground">Buscando en Yahoo Finance…</p> : null}
        {instrumentSearch.error ? <p className="mt-2 text-[11px] text-destructive">No pudimos buscar instrumentos ahora. Inténtalo de nuevo.</p> : null}
        {searchQuery.length >= 2 && !instrumentSearch.isFetching && !instrumentSearch.error && instrumentSearch.data?.length === 0 ? <p className="mt-2 text-[11px] text-muted-foreground">No encontramos ETF o acciones compatibles. Prueba con otro nombre o ticker.</p> : null}
        {instrumentSearch.data?.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{instrumentSearch.data.map((instrument) => <div key={instrument.ticker} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-3 py-2.5"><div className="min-w-0"><p className="font-mono-app text-xs font-bold">{instrument.ticker} <span className="ml-1 font-sans text-[10px] font-medium text-muted-foreground">{instrument.type}</span></p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{instrument.name}</p><p className={`mt-1 text-[10px] font-bold ${instrument.available ? "text-accent" : "text-destructive"}`}>{instrument.available ? "Disponible para cálculo JB" : "No disponible para cálculo JB"}</p></div>{listed.has(instrument.ticker) ? <span className="shrink-0 text-[10px] font-bold text-accent">En tu radar</span> : <button type="button" onClick={() => void addTicker(instrument.ticker)} disabled={addMutation.isPending} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-bold text-primary-foreground disabled:opacity-50"><Plus className="h-3 w-3" /> Añadir</button>}</div>)}</div> : null}
      </div>
      <div className="grid gap-0 xl:grid-cols-[1.1fr_.9fr]">
        <div className="hidden border-b border-card-border p-5 xl:border-b-0 xl:border-r">
          <div className="mb-3 flex items-center justify-between"><p className="text-xs font-bold">Activos de tu radar</p><span className="font-mono-app text-[10px] text-muted-foreground">{watchAssets.length} activos</span></div>
          {watchlistQuery.isLoading || personalRadarQuery.isLoading ? <div className="space-y-3">{[1, 2, 3].map((item) => <SkeletonBlock key={item} className="h-12 w-full" />)}</div> : watchAssets.length ? <div className="space-y-2">{watchAssets.map((asset) => <div key={asset.ticker} className="flex items-center justify-between gap-3 rounded-xl bg-secondary/45 px-3 py-2.5"><div className="flex min-w-0 items-center gap-3"><span className="ticker-mark">{asset.ticker.slice(0, 2)}</span><div className="min-w-0"><p className="font-mono-app text-xs font-bold">{asset.ticker} <span className="ml-1 font-sans text-[10px] font-medium text-muted-foreground">{formatNumber(asset.price)}</span></p><p className="truncate text-[10px] text-muted-foreground">{asset.signal} · Nivel JB {asset.level ?? "Pendiente"} · RSI {formatNumber(asset.rsi, 0)}</p></div></div><div className="flex items-center gap-1"><button type="button" onClick={() => setSelectedAsset(asset)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-bold text-muted-foreground hover:bg-card hover:text-foreground" aria-label={`Ver análisis de ${asset.ticker}`} title="Ver análisis JB"><MoreHorizontal className="h-3.5 w-3.5" /><span className="hidden sm:inline">Análisis</span></button><button type="button" onClick={() => void removeTicker(asset.ticker)} disabled={removeMutation.isPending} className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1.5 text-[10px] font-bold text-muted-foreground hover:border-destructive/20 hover:bg-card hover:text-destructive disabled:opacity-50" aria-label={`Eliminar ${asset.ticker} de mi radar`} title="Quitar de mi radar"><X className="h-3.5 w-3.5" /><span className="hidden sm:inline">Quitar</span></button></div></div>)}</div> : <div className="flex min-h-40 flex-col items-center justify-center text-center"><SlidersHorizontal className="h-6 w-6 text-muted-foreground/60" /><p className="mt-3 text-sm font-bold">Tu radar está vacío</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">Busca un ETF o una acción arriba para calcular su señal JB y seguirlo aquí.</p></div>}
          {personalRadarQuery.data?.errors.length ? <p className="mt-3 text-[10px] text-destructive">Datos parciales: {personalRadarQuery.data.errors.join(" · ")}</p> : null}
        </div>
        <div className="p-4 sm:p-5 xl:col-span-2">
          <TelegramAlerts userId={userId ?? "anonymous"} sampleTicker={watchAssets[0]?.ticker ?? "SCHD"} onChanged={() => void queryClient.invalidateQueries({ queryKey: deliveriesKey })} />
        </div>
      </div>
      {(message || deliveriesQuery.data?.length) && <div className="border-t border-card-border px-5 py-3"><p className={`text-[11px] ${message.includes("No pudimos") ? "text-destructive" : "text-muted-foreground"}`}>{message || "Último historial de alertas"}</p>{deliveriesQuery.data?.slice(0, 2).map((delivery) => <p key={delivery.id} className="mt-1 font-mono-app text-[10px] text-muted-foreground">{delivery.ticker} · {delivery.signal} · {alertDeliveryStatusLabel(delivery.status)}</p>)}</div>}
      {selectedAsset && <AssetAnalysisModal asset={selectedAsset} onClose={() => setSelectedAsset(null)} />}
    </section>
  );
}

function AccountControl() {
  const { signOut } = useClerk();
  return <><Show when="signed-out"><a href={`${basePath}/sign-in`} className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground"><LogIn className="h-3.5 w-3.5" /> Entrar</a></Show><Show when="signed-in"><button type="button" onClick={() => void signOut({ redirectUrl: basePath || "/" })} className="inline-flex h-9 items-center gap-2 rounded-xl border border-card-border bg-card px-3 text-xs font-bold text-muted-foreground hover:bg-secondary"><LogOut className="h-3.5 w-3.5" /> Cerrar sesión</button></Show></>;
}

function Dashboard() {
  const { isSignedIn, userId } = useAuth();
  const radarQuery = useGetMarketRadar();
  const activityQuery = useGetMarketActivity();
  const watchlistRadarKey = useMemo(() => scopeUserQuery(getGetWatchlistRadarQueryKey(), userId), [userId]);
  const personalRadarQuery = useGetWatchlistRadar({ query: { queryKey: watchlistRadarKey, enabled: Boolean(userId) } });
  const healthQuery = useHealthCheck();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(userId);
  const [isDark, setIsDark] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState("");

  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); }, [isDark]);
  useEffect(() => {
    const previous = previousUserId.current;
    if (previous && previous !== userId) {
      const previousPrivateKeys = [
        getGetWatchlistQueryKey(),
        getGetWatchlistRadarQueryKey(),
        getGetAlertPreferencesQueryKey(),
        getGetAlertDeliveriesQueryKey(),
      ].map((baseKey) => scopeUserQuery(baseKey, previous));
      void Promise.all(previousPrivateKeys.map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true }))).then(() => {
        previousPrivateKeys.forEach((queryKey) => queryClient.removeQueries({ queryKey, exact: true }));
      });
    }
    previousUserId.current = userId;
  }, [queryClient, userId]);

  const radar = radarQuery.data;
  const assets = (radar?.assets ?? []) as Asset[];
  const personalAssets = (personalRadarQuery.data?.assets ?? []) as Asset[];
  const baseTickers = useMemo(() => new Set(assets.map((asset) => asset.ticker)), [assets]);
  const personalTickers = useMemo(() => new Set(personalAssets.map((asset) => asset.ticker)), [personalAssets]);
  const addWatchMutation = useAddWatchlistItem();
  const addToWatchlist = async (ticker: string) => {
    await addWatchMutation.mutateAsync({ data: { ticker } });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: watchlistRadarKey }),
      queryClient.invalidateQueries({ queryKey: scopeUserQuery(getGetWatchlistQueryKey(), userId) }),
    ]);
  };
  const visibleAssets = useMemo(() => {
    if (!isSignedIn || !userId) return assets;
    return personalAssets;
  }, [assets, isSignedIn, personalAssets, userId]);
  const activity = (activityQuery.data ?? []) as ActivityItem[];
  const summary = useMemo(() => isSignedIn ? summarizeAssets(visibleAssets) : radar?.summary ?? summarizeAssets(visibleAssets), [isSignedIn, radar?.summary, visibleAssets]);
  const loading = radarQuery.isLoading || radarQuery.isFetching || (Boolean(isSignedIn) && personalRadarQuery.isLoading);
  const activityLoading = activityQuery.isLoading || activityQuery.isFetching;
  const radarError = Boolean(radarQuery.error || (isSignedIn && personalRadarQuery.error));
  const updated = radar?.updatedAt || radarQuery.dataUpdatedAt;
  const updatedLabel = updated ? formatTime(updated) : "—";
  const retainedRadar = Boolean(radar?.stale);
  const dataAge = formatDataAge(updated);

  const signalData = useMemo(() => [{ name: "Compra", value: summary.opportunities, color: CHART_COLORS.teal }, { name: "Vigilar", value: summary.watch, color: CHART_COLORS.amber }, { name: "Evitar", value: summary.avoid, color: CHART_COLORS.red }], [summary]);
  const rsiData = useMemo(() => visibleAssets.filter((asset) => asset.rsi !== null).map((asset) => ({ ticker: asset.ticker, rsi: asset.rsi as number })).sort((a, b) => b.rsi - a.rsi).slice(0, 7), [visibleAssets]);
  const opportunityRows = useMemo(() => visibleAssets.map((asset) => ({ ticker: asset.ticker, nombre: asset.name, rsi: asset.rsi, cambio: asset.change, nivel_jb: asset.level, señal: asset.signal })), [visibleAssets]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshNotice("");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetMarketRadarQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetMarketActivityQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetEmergingMarketIdeasQueryKey() }),
    ]);
    window.setTimeout(() => { setIsRefreshing(false); setRefreshNotice("Radar actualizado"); }, 600);
    window.setTimeout(() => setRefreshNotice(""), 3200);
  };

  return (
    <div className="min-h-[100dvh] overflow-x-clip bg-background">
      <Sidebar isDark={isDark} setIsDark={setIsDark} />
      <main className="min-h-[100dvh] min-w-0 lg:ml-[238px]">
        <div className="mx-auto min-w-0 max-w-[1480px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <header className="dashboard-reveal mb-6 flex min-w-0 flex-col gap-5 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className="eyebrow-dot" /><span className="font-mono-app text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Jornada de mercado · Madrid / NY</span></div>
              <div className="mt-4 flex items-center gap-3 sm:gap-4">
                <MarketThermometerMark />
                <h1 className="font-display text-[clamp(2rem,4.6vw,4.2rem)] font-bold leading-[.84] tracking-[-.08em]"><span className="block">TERMÓMETRO</span><span className="mt-2 block text-primary">BURSÁTIL</span></h1>
              </div>
              <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground">Lee el pulso del mercado antes de mover ficha.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${retainedRadar ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-100" : "border-card-border bg-card"}`}><span className={`h-2 w-2 rounded-full ${retainedRadar ? "bg-amber-500" : healthQuery.data ? "bg-accent live-dot" : healthQuery.isLoading ? "bg-amber-500" : "bg-destructive"}`} /><span className="font-bold">{retainedRadar ? "Última lectura disponible" : statusLabel(radar?.marketStatus)}</span><span className="text-muted-foreground">· {retainedRadar ? `${dataAge} · no es tiempo real` : updatedLabel}{radar?.cached && !retainedRadar ? " · caché" : ""}</span></div>
              <AccountControl />
              <RefreshControl loading={loading || isRefreshing} onRefresh={handleRefresh} />
              <button type="button" onClick={() => window.print()} disabled={loading} className="flex h-9 items-center gap-2 rounded-xl border border-card-border bg-card px-3 text-xs font-bold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50 print:hidden" aria-label="Exportar como PDF"><Printer className="h-3.5 w-3.5" /> <span className="hidden sm:inline">PDF</span></button>
              <button type="button" onClick={() => setIsDark(!isDark)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-card-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground print:hidden" aria-label="Cambiar modo de color">{isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}</button>
            </div>
          </header>

          {retainedRadar && <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm shadow-amber-950/5 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-100 dashboard-reveal"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" /><div className="min-w-0"><p className="text-xs font-bold">Lectura retenida · no es una lectura actual</p><p className="mt-1 text-[11px] leading-relaxed text-amber-900/75 dark:text-amber-100/75">Última lectura válida: <strong>{formatExactDateTime(updated)}</strong> · {dataAge}. Yahoo Finance no entregó una actualización nueva; los valores mostrados son históricos y pueden estar desactualizados.</p></div></div>}
          {(refreshNotice || radar?.source || radar?.errors?.length) && <div className="mb-4 flex flex-col gap-1 rounded-xl border border-card-border bg-card px-3 py-2 text-xs dashboard-reveal">{refreshNotice && <span className="flex items-center gap-2 font-bold text-accent"><Check className="h-3.5 w-3.5" /> {refreshNotice}</span>}{radar?.source && <span className="text-muted-foreground">Fuente: {radar.source} · actualización mínima cada 5 minutos.</span>}{radar?.errors?.length ? <span className={`${retainedRadar ? "text-amber-800 dark:text-amber-200" : "text-[hsl(var(--destructive))]"}`}>{retainedRadar ? "Aviso de actualización" : "Datos parciales"}: {radar.errors.join(" · ")}</span> : null}</div>}

          {radarError ? <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-8 text-center"><ShieldAlert className="mx-auto h-9 w-9 text-destructive" /><h2 className="mt-4 font-display text-xl font-bold">No hemos podido leer el radar</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">El mercado no está perdido, solo la conexión. Comprueba el servicio y vuelve a intentarlo.</p><button type="button" onClick={handleRefresh} className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-0.5">Reintentar lectura</button></div> : loading && !radar ? <LoadingDashboard /> : <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 dashboard-reveal dashboard-reveal-delay-1">
              <KPI label="Activos en radar" value={summary.total} note={isSignedIn ? "Tu seguimiento personal" : "Universo monitorizado"} tone="ink" icon={<Gauge className="h-4 w-4" />} />
              <KPI label="En oportunidad" value={summary.opportunities} note="Preparar compra · JB" tone="coral" icon={<TrendingUp className="h-4 w-4" />} />
              <KPI label="En vigilancia" value={summary.watch} note="Esperar confirmación" tone="amber" icon={<ActivityIcon className="h-4 w-4" />} />
              <KPI label="Evitar por ahora" value={summary.avoid} note="Precio o momentum exigente" tone="teal" icon={<ShieldAlert className="h-4 w-4" />} />
            </div>

            <div id="signals" className="grid grid-cols-1 scroll-mt-6 gap-5 xl:grid-cols-[1.42fr_.85fr]">
              <ChartCard title="Distribución de señales" eyebrow="La foto del momento" filename="distribucion-senales.csv" rows={signalData.map(({ name, value }) => ({ señal: name, activos: value }))} className="dashboard-reveal dashboard-reveal-delay-2">
                {visibleAssets.length ? <div className="grid items-center gap-2 sm:grid-cols-[minmax(190px,.9fr)_1.1fr]"><div className="relative h-[220px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={signalData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={66} outerRadius={94} paddingAngle={3} cornerRadius={3} stroke="none" isAnimationActive={false}>{signalData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #d9ddd8", fontSize: 12, background: "#fbfaf6" }} formatter={(value: number) => [`${value} activos`, ""]} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="font-display text-3xl font-bold tracking-[-.07em]">{summary.total}</span><span className="text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">activos</span></div></div><div className="space-y-4 px-2">{signalData.map((item) => <div key={item.name}><div className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 font-bold"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span><span className="font-mono-app text-muted-foreground">{item.value}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${summary.total ? (item.value / summary.total) * 100 : 0}%`, backgroundColor: item.color }} /></div></div>)}</div></div> : <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Aún no hay señales para visualizar.</div>}
              </ChartCard>
              <ChartCard title="Temperatura RSI" eyebrow="Extremos del radar" filename="temperatura-rsi.csv" rows={rsiData}>
                {rsiData.length ? <ResponsiveContainer width="100%" height={232}><BarChart data={rsiData} layout="vertical" margin={{ top: 5, right: 12, left: 4, bottom: 5 }}><CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="2 3" /><XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} /><YAxis dataKey="ticker" type="category" width={48} tick={{ fontSize: 10, fill: "hsl(var(--foreground))", fontFamily: "DM Mono" }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: "hsl(var(--secondary))" }} contentStyle={{ borderRadius: 12, border: "1px solid #d9ddd8", fontSize: 12, background: "#fbfaf6" }} formatter={(value: number) => [formatNumber(value, 0), "RSI"]} /><Bar dataKey="rsi" radius={[0, 5, 5, 0]} isAnimationActive={false}>{rsiData.map((item) => <Cell key={item.ticker} fill={isDcaRsiRange(item.rsi) ? CHART_COLORS.teal : item.rsi < DCA_RSI_MIN ? CHART_COLORS.coral : item.rsi > 65 ? CHART_COLORS.red : CHART_COLORS.amber} />)}</Bar></BarChart></ResponsiveContainer> : <div className="flex h-[232px] items-center justify-center text-sm text-muted-foreground">Sin lectura RSI.</div>}
              </ChartCard>
            </div>

            <RecommendedSection signedIn={Boolean(isSignedIn)} owned={personalTickers} onAdd={addToWatchlist} signInHref={`${basePath}/sign-in`} />

            <div className="grid grid-cols-1 scroll-mt-6 gap-5 xl:grid-cols-[1.5fr_.72fr]">
               <RadarTable key={userId ?? "anonymous"} assets={visibleAssets} loading={loading} baseTickers={isSignedIn ? new Set<string>() : baseTickers} personalTickers={personalTickers} />
              <div className="space-y-5">
                <ActivityFeed activity={activity} loading={activityLoading} error={Boolean(activityQuery.error)} />
                <InterestLinksPanel />
              </div>
            </div>
             <EmergingMarketIdeasSection />
               <Show when="signed-in"><PersonalWatchlist key={userId ?? "anonymous"} /></Show>
            <Show when="signed-out"><section id="watchlist" className="rounded-2xl border border-card-border bg-card px-5 py-6 text-center"><p className="font-display text-lg font-bold">Tu radar personal empieza con una cuenta</p><p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">Inicia sesión para guardar una watchlist propia y recibir alertas por WhatsApp cuando cambien tus señales JB.</p><a href={`${basePath}/sign-up`} className="mt-4 inline-flex rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground">Crear cuenta</a></section></Show>
          </div>}
          <footer className="mt-8 flex flex-col gap-2 border-t border-border pt-4 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>JB Termómetro Bursátil · Información para análisis personal. No constituye recomendación financiera.</span><span className="font-mono-app">Estado API: {healthQuery.data?.status || (healthQuery.isLoading ? "comprobando" : "no disponible")}</span></footer>
        </div>
      </main>
    </div>
  );
}

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

// Only shows the link; the API enforces access (ADMIN_EMAILS on the server).
const ADMIN_EMAILS = new Set(["jesus201@gmail.com"]);

function MethodologyRoute() {
  const [, setLocation] = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return <div className="min-h-screen bg-background text-foreground"><MethodologyPage onBack={() => setLocation("/")} /></div>;
}

function AdminRoute() {
  const [, setLocation] = useLocation();
  return <div className="min-h-screen bg-background text-foreground"><AdminPage onBack={() => setLocation("/")} signInHref={`${basePath}/sign-in?redirect_url=${encodeURIComponent(`${window.location.origin}${basePath}/admin`)}`} /></div>;
}

function Router() {
  return <ErrorBoundary resetKey={useLocation()[0]}><Switch><Route path="/" component={Dashboard} /><Route path="/admin" component={AdminRoute} /><Route path="/metodologia" component={MethodologyRoute} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route component={Dashboard} /></Switch></ErrorBoundary>;
}

function ClerkApp() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })} appearance={{ options: { logoImageUrl: `${window.location.origin}${basePath}/jb-mark.svg`, logoLinkUrl: basePath || "/" }, variables: { colorPrimary: "hsl(14 82% 54%)", colorBackground: "hsl(42 33% 97%)", colorForeground: "hsl(210 31% 15%)", fontFamily: "Manrope" } }} localization={{ signIn: { start: { title: "Bienvenido al radar JB", subtitle: "Entra para activar tu seguimiento personal" } }, signUp: { start: { title: "Crea tu radar personal", subtitle: "Guarda tus activos y recibe avisos" } } }}><QueryClientProvider client={queryClient}><TooltipProvider><Router /><Toaster /></TooltipProvider></QueryClientProvider></ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><ClerkApp /></WouterRouter>;
}

export default App;