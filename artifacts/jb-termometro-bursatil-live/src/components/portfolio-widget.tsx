import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { ArrowRight, Wallet } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type Position = { ticker: string; units: number; name: string; price: number | null; change: number | null };
type PortfolioResponse = { positions: Position[] };

const num = (value: number, digits = 2) => value.toLocaleString("es-VE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const usd = (value: number) => `$${num(value)}`;
const signedUsd = (value: number) => `${value >= 0 ? "+" : "−"}${usd(Math.abs(value))}`;
const signedPct = (value: number) => `${value >= 0 ? "+" : ""}${num(value * 100)}%`;
const tone = (value: number) => (value >= 0 ? "text-emerald-600" : "text-destructive");

// Resumen del portafolio para el dashboard. Lee la misma ruta que /portafolio y comparte su caché.
// Solo aparece con la sesión iniciada; el radar y la watchlist no dependen de este componente.
export function PortfolioWidget() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const query = useQuery({
    queryKey: ["portfolio"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch("/api/portfolio", { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(`Error ${response.status}`);
      return (await response.json()) as PortfolioResponse;
    },
    enabled: isLoaded && Boolean(isSignedIn),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const summary = useMemo(() => {
    const rows = (query.data?.positions ?? []).flatMap((p) => {
      if (p.price === null) return [];
      const value = p.price * p.units;
      const move = p.change === null ? 0 : value - value / (1 + p.change / 100);
      return [{ ticker: p.ticker, name: p.name, value, move, change: p.change }];
    });
    const total = rows.reduce((sum, r) => sum + r.value, 0);
    const move = rows.reduce((sum, r) => sum + r.move, 0);
    const before = total - move;
    const movers = [...rows].filter((r) => r.change !== null).sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
    return { total, move, pct: before > 0 ? move / before : null, movers: movers.slice(0, 4), extra: Math.max(0, rows.length - 4) };
  }, [query.data]);

  if (!isLoaded || !isSignedIn || query.isError) return null;
  if (query.isLoading) return <section className="h-40 animate-pulse rounded-2xl border border-card-border bg-card" aria-hidden="true" />;

  const positions = query.data?.positions ?? [];
  if (!positions.length) {
    return <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-card-border bg-card p-5">
      <div className="flex items-center gap-3"><Wallet className="h-5 w-5 text-primary" /><div><h2 className="font-display text-base font-bold tracking-[-0.02em]">Mi portafolio</h2><p className="text-xs text-muted-foreground">Anota tus acciones y ETF y míralos con riesgo y reparto.</p></div></div>
      <a href={`${basePath}/portafolio`} className="inline-flex items-center gap-1.5 text-xs font-bold text-primary">Añadir posiciones <ArrowRight className="h-3.5 w-3.5" /></a>
    </section>;
  }

  const maxMove = Math.max(...summary.movers.map((r) => Math.abs(r.move)), 0.01);
  return <section className="rounded-2xl border border-card-border bg-card p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="font-display text-base font-bold tracking-[-0.02em]">Mi portafolio</h2>
        <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Hoy</p>
        <p className={`font-display text-3xl font-bold tracking-[-0.04em] ${tone(summary.move)}`}>{signedUsd(summary.move)}</p>
        {summary.pct !== null && <p className={`text-sm font-semibold ${tone(summary.move)}`}>{signedPct(summary.pct)}</p>}
      </div>
      <div className="text-right">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Valor total</p>
        <p className="font-display text-3xl font-bold tracking-[-0.04em]">{usd(summary.total)}</p>
        <p className="text-[11px] text-muted-foreground">Valores orientativos</p>
      </div>
    </div>
    {summary.movers.length > 0 && <div className="mt-5 border-t border-card-border pt-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Los que más se movieron hoy</p>
      <ul className="mt-3 space-y-2.5">
        {summary.movers.map((r) => <li key={r.ticker} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-sm">
          <span className="font-bold">{r.ticker}</span>
          <span className="h-2 rounded-full bg-secondary" aria-hidden="true"><span className={`block h-2 rounded-full ${r.move >= 0 ? "bg-emerald-600/80" : "bg-destructive/70"}`} style={{ width: `${Math.max(6, (Math.abs(r.move) / maxMove) * 100)}%` }} /></span>
          <span className={`text-right text-xs font-semibold tabular-nums ${tone(r.move)}`}>{r.change !== null && `${r.change >= 0 ? "+" : ""}${num(r.change)}%`} · {signedUsd(r.move)}</span>
        </li>)}
      </ul>
    </div>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-card-border pt-3 text-xs">
      <span className="text-muted-foreground">{summary.extra > 0 ? `${summary.extra} ${summary.extra === 1 ? "posición más" : "posiciones más"} en este portafolio.` : `${positions.length} ${positions.length === 1 ? "posición" : "posiciones"}.`}</span>
      <a href={`${basePath}/portafolio`} className="inline-flex items-center gap-1.5 font-bold text-primary">Ver mi portafolio <ArrowRight className="h-3.5 w-3.5" /></a>
    </div>
  </section>;
}
