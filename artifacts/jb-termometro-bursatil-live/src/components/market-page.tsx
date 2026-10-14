import { useMemo, type ReactNode } from "react";
import { ArrowLeft, CalendarDays, ExternalLink } from "lucide-react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { CALENDAR_REVIEWED_ON, CALENDAR_SOURCES, ECONOMIC_EVENTS, KIND_LABEL, type EconomicEvent } from "@/data/economic-calendar";
import { MarketTicker, useMarketPulse, type MarketPulse } from "@/components/market-ticker";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-card-border bg-card p-5 sm:p-6 ${className}`}>{children}</section>;
}

// Verde para subidas y rojo para bajadas; la intensidad llega a su máximo en ±3 %.
function tileColor(change: number | null): string {
  if (change === null) return "#cbd5e1";
  const strength = Math.min(Math.abs(change) / 3, 1);
  const light = 88 - strength * 42;
  return change >= 0 ? `hsl(145 55% ${light}%)` : `hsl(2 65% ${light}%)`;
}

type TileProps = { x?: number; y?: number; width?: number; height?: number; depth?: number; index?: number; name?: string; change?: number | null; sector?: string };

function Tile({ x = 0, y = 0, width = 0, height = 0, depth = 0, index = 0, name = "", change = null, sector = "" }: TileProps) {
  if (depth !== 2) return <g />;
  const showText = width > 34 && height > 26;
  return <g>
    <rect x={x} y={y} width={width} height={height} fill={tileColor(change)} stroke="#ffffff" strokeWidth={1} />
    {showText && <text x={x + width / 2} y={y + height / 2 - (height > 40 ? 2 : -3)} textAnchor="middle" fontSize={width > 70 ? 13 : 10} fontWeight={700} fill="#0f172a">{name}</text>}
    {index === 0 && sector && width > 60 && height > 18 && <g>
      <rect x={x + 2} y={y + 2} width={Math.min(width - 4, sector.length * 6 + 10)} height={14} rx={3} fill="#ffffff" opacity={0.85} />
      <text x={x + 7} y={y + 12} fontSize={9} fontWeight={700} fill="#0f172a" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{sector}</text>
    </g>}
    {showText && height > 40 && change !== null && <text x={x + width / 2} y={y + height / 2 + 13} textAnchor="middle" fontSize={10} fill="#0f172a">{`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</text>}
  </g>;
}

type TipPayload = { payload?: { name?: string; change?: number | null; sector?: string; size?: number; children?: unknown[] } };

function HeatTooltip({ active, payload }: { active?: boolean; payload?: TipPayload[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row || row.children) return null;
  const cap = row.size ? `${(row.size / 1e9).toLocaleString("es-VE", { maximumFractionDigits: 0 })} mil millones US$` : "n. d.";
  return <div className="rounded-xl border border-card-border bg-card px-3 py-2 text-[12px] shadow-md">
    <p className="font-bold" translate="no">{row.name}</p>
    <p className="text-muted-foreground">{row.sector}</p>
    <p className="mt-1">Variación: <b>{row.change === null || row.change === undefined ? "n. d." : `${row.change >= 0 ? "+" : ""}${row.change.toFixed(2)}%`}</b></p>
    <p>Capitalización: <b>{cap}</b></p>
  </div>;
}

function Heatmap({ pulse }: { pulse: MarketPulse }) {
  const data = useMemo(() => pulse.sectors
    .filter((sector) => sector.stocks.length)
    .map((sector) => ({
      name: sector.name,
      children: sector.stocks.map((stock) => ({ name: stock.ticker, size: stock.marketCap, change: stock.change, sector: sector.name })),
    })), [pulse]);
  return <>
    <div className="h-[460px] w-full sm:h-[540px]" role="img" aria-label="Mapa de calor de los mayores componentes del S&P 500 por sector, coloreado por variación del día">
      <ResponsiveContainer width="100%" height="100%">
        <Treemap data={data} dataKey="size" nameKey="name" aspectRatio={1.4} isAnimationActive={false} content={<Tile />}>
          <Tooltip content={<HeatTooltip />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm" style={{ background: tileColor(-3) }} /> −3 % o más</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm" style={{ background: tileColor(0) }} /> 0 %</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-6 rounded-sm" style={{ background: tileColor(3) }} /> +3 % o más</span>
      <span>El tamaño de cada bloque es su capitalización de mercado.</span>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {pulse.sectors.map((sector) => <div key={sector.key} className="flex items-center justify-between gap-2 rounded-xl bg-secondary/60 px-3 py-2 text-[12px]">
        <span className="truncate">{sector.name} <span className="text-muted-foreground" translate="no">({sector.etf})</span></span>
        <b className={`font-mono-app ${(sector.etfChange ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{sector.etfChange === null ? "n. d." : `${sector.etfChange >= 0 ? "+" : ""}${sector.etfChange.toFixed(2)}%`}</b>
      </div>)}
    </div>
  </>;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function parseDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function relative(date: Date, today: Date): string {
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  return `En ${days} días`;
}

function Calendar() {
  const today = useMemo(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }, []);
  const groups = useMemo(() => {
    const upcoming = ECONOMIC_EVENTS.filter((event) => parseDay(event.date) >= today);
    const byMonth = new Map<string, EconomicEvent[]>();
    for (const event of upcoming) {
      const date = parseDay(event.date);
      const key = `${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
      byMonth.set(key, [...(byMonth.get(key) ?? []), event]);
    }
    return [...byMonth.entries()];
  }, [today]);
  if (!groups.length) return <p className="text-sm text-muted-foreground">No quedan eventos cargados. El calendario se actualiza cuando los organismos publican las fechas siguientes.</p>;
  return <div className="max-h-[640px] space-y-5 overflow-y-auto pr-1">
    {groups.map(([month, events]) => <div key={month}>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{month}</h3>
      <ul className="space-y-2">
        {events.map((event) => {
          const date = parseDay(event.date);
          return <li key={`${event.date}-${event.title}`} className="flex gap-3 rounded-xl border border-card-border p-3">
            <div className="w-11 shrink-0 text-center">
              <p className="font-mono-app text-lg font-bold leading-none">{date.getDate()}</p>
              <p className="mt-1 text-[10px] uppercase text-muted-foreground">{WEEKDAYS[date.getDay()]}</p>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{KIND_LABEL[event.kind]}</span>
                {event.importance === "alta" && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-primary">Alta</span>}
                <span className="text-[10.5px] text-muted-foreground">{relative(date, today)}{event.time ? ` · ${event.time}` : ""}</span>
              </div>
              <p className="mt-1 text-[13px] font-bold leading-snug">{event.title}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{event.detail}</p>
            </div>
          </li>;
        })}
      </ul>
    </div>)}
  </div>;
}

export function MarketPage({ onBack }: { onBack: () => void }) {
  const { data, isLoading, isError, refetch } = useMarketPulse();
  return <>
    <MarketTicker />
    <main className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="rounded-xl border border-card-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Volver al Termómetro"><ArrowLeft className="h-4 w-4" /></button>
        <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Panorama</p><h1 className="font-display text-xl font-bold tracking-[-0.04em] sm:text-2xl">Mercado</h1></div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Card className="min-w-0">
          <h2 className="font-display text-lg font-bold tracking-[-0.02em]">Mapa de calor del S&amp;P 500</h2>
          <p className="mt-1 mb-4 text-[12.5px] leading-relaxed text-muted-foreground">Las mayores empresas de cada sector, coloreadas por su variación del día. Muestra las principales, no las 500. Faltan Meta, Visa, Mastercard, Berkshire y Nike: tienen varias clases de acciones y la fuente de datos no permite calcular bien su tamaño.</p>
          {isLoading && <div className="grid h-[460px] place-items-center rounded-xl bg-secondary/50 text-sm text-muted-foreground sm:h-[540px]">Cargando mercado...</div>}
          {isError && <div className="grid h-[460px] place-items-center rounded-xl bg-secondary/50 px-6 text-center text-sm text-muted-foreground sm:h-[540px]"><div><p>No pudimos cargar el mapa ahora.</p><button type="button" onClick={() => void refetch()} className="mt-3 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground">Reintentar</button></div></div>}
          {data && <Heatmap pulse={data} />}
          {data && <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">Fuentes: {data.source}. Actualizado {new Date(data.updatedAt).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}. {data.partial && "Faltan algunas empresas; se reintenta solo."}</p>}
        </Card>

        <Card className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-[-0.02em]"><CalendarDays className="h-5 w-5 text-primary" /> Calendario económico</h2>
          <p className="mt-1 mb-4 text-[12.5px] leading-relaxed text-muted-foreground">Próximas publicaciones de EE. UU. que suelen mover los mercados: decisiones de la Fed, empleo, inflación y PIB.</p>
          <Calendar />
          <div className="mt-4 rounded-xl bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Fechas oficiales, revisadas el {CALENDAR_REVIEWED_ON}. Las reuniones de la Fed son tentativas hasta que se confirman. No incluye pronósticos.
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">{CALENDAR_SOURCES.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground">{source.label}<ExternalLink className="h-3 w-3" /></a>)}</div>
          </div>
        </Card>
      </div>
      <p className="mt-4 px-1 text-[11px] leading-relaxed text-muted-foreground">Información de referencia con datos que pueden tener retraso. No constituye asesoría financiera.</p>
    </main>
  </>;
}
