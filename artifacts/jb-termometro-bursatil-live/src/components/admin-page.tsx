import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, RefreshCw, Search, Send, ShieldAlert, Star, Users } from "lucide-react";

type Overview = {
  generatedAt: string;
  totals: { users: number; new7d: number; active7d: number; active30d: number; withWatchlist: number; watchlistItems: number; telegram: number };
  signups: Array<{ day: string; count: number }>;
  alerts: Array<{ day: string; instant: number; digest: number }>;
  topTickers: Array<{ ticker: string; count: number }>;
  users: Array<{
    id: string;
    name: string | null;
    email: string | null;
    method: string;
    createdAt: string;
    lastSignInAt: string | null;
    lastActiveAt: string | null;
    watchlist: number;
    telegram: boolean;
    cashRegister: boolean;
  }>;
  truncated: boolean;
};

async function fetchOverview(): Promise<Overview> {
  const response = await fetch("/api/admin/overview", { credentials: "include" });
  const body = (await response.json().catch(() => ({}))) as Overview & { error?: string };
  if (!response.ok) throw Object.assign(new Error(body.error ?? `Error ${response.status}`), { status: response.status });
  return body;
}

const dateFmt = new Intl.DateTimeFormat("es-VE", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Caracas" });
const shortDay = (day: string) => new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

function relative(iso: string | null): string {
  if (!iso) return "Nunca";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 60) return minutes <= 1 ? "Hace un momento" : `Hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `Hace ${days} ${days === 1 ? "día" : "días"}`;
  return dateFmt.format(new Date(iso));
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return <div className="rounded-2xl border border-card-border bg-card px-4 py-3.5">
    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
    <p className="mt-1 font-display text-2xl font-bold tracking-[-0.04em]">{value}</p>
    {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
  </div>;
}

// Thin bars, 4px rounded tops, 2px gaps, hover tooltip per bar.
function BarChart({ data, series, height = 120 }: {
  data: Array<{ day: string } & Record<string, number | string>>;
  series: Array<{ key: string; label: string; className: string }>;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((sum, s) => sum + Number(d[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const active = hover !== null ? data[hover] : null;
  return <div>
    {series.length > 1 && <div className="mb-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">{series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${s.className}`} />{s.label}</span>)}</div>}
    <div className="relative">
      <div className="flex items-end gap-[2px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => <div key={d.day} className="flex h-full flex-1 cursor-default flex-col justify-end" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
          {totals[i] === 0 ? <div className="h-[2px] rounded-full bg-card-border" /> : series.slice().reverse().map((s, j) => {
            const value = Number(d[s.key] ?? 0);
            if (!value) return null;
            const isTop = j === 0 || series.slice().reverse().slice(0, j).every((prev) => !Number(d[prev.key] ?? 0));
            return <div key={s.key} className={`${s.className} ${isTop ? "rounded-t" : ""} ${hover === i ? "opacity-100" : "opacity-85"} mb-[2px] last:mb-0`} style={{ height: `${(value / max) * (height - 4)}px` }} />;
          })}
        </div>)}
      </div>
      {active && <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-card-border bg-card px-2.5 py-1.5 text-[11px] shadow-md">
        <span className="font-bold">{shortDay(active.day)}</span>
        {series.map((s) => <span key={s.key} className="ml-2 text-muted-foreground">{s.label}: <b className="text-foreground">{Number(active[s.key] ?? 0)}</b></span>)}
      </div>}
    </div>
    <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground"><span>{shortDay(data[0]?.day ?? "")}</span><span>Hoy</span></div>
  </div>;
}

function downloadCsv(users: Overview["users"]) {
  const header = ["Nombre", "Correo", "Método", "Registro", "Último ingreso", "Activos en watchlist", "Telegram", "Caja"];
  const rows = users.map((u) => [u.name ?? "", u.email ?? "", u.method, u.createdAt.slice(0, 10), (u.lastActiveAt ?? u.lastSignInAt ?? "").slice(0, 10), String(u.watchlist), u.telegram ? "Sí" : "No", u.cashRegister ? "Sí" : "No"]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `usuarios-termometro-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminPage({ onBack }: { onBack: () => void }) {
  const query = useQuery({ queryKey: ["admin-overview"], queryFn: fetchOverview, retry: false, refetchOnWindowFocus: false });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "telegram" | "watchlist" | "inactive">("all");
  const data = query.data;

  const users = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    return data.users.filter((u) => {
      if (term && !`${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(term)) return false;
      if (filter === "telegram") return u.telegram;
      if (filter === "watchlist") return u.watchlist > 0;
      if (filter === "inactive") return u.watchlist === 0;
      return true;
    });
  }, [data, search, filter]);

  const status = (query.error as { status?: number } | null)?.status;
  const maxTicker = Math.max(1, ...(data?.topTickers.map((t) => t.count) ?? [1]));

  return <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="rounded-xl border border-card-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Volver al Termómetro"><ArrowLeft className="h-4 w-4" /></button>
        <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Solo administrador</p><h1 className="font-display text-xl font-bold tracking-[-0.04em]">Panel del Termómetro</h1></div>
      </div>
      {data && <div className="flex items-center gap-2">
        <button type="button" onClick={() => void query.refetch()} className="inline-flex items-center gap-1.5 rounded-xl border border-card-border px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-secondary hover:text-foreground"><RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Actualizar</button>
        <button type="button" onClick={() => downloadCsv(data.users)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"><Download className="h-3.5 w-3.5" /> Excel (CSV)</button>
      </div>}
    </div>

    {query.isLoading && <div className="mt-6 grid gap-3 sm:grid-cols-4">{[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-secondary/60" />)}</div>}
    {query.error && <div className="mt-10 flex flex-col items-center text-center"><ShieldAlert className="h-8 w-8 text-muted-foreground" /><p className="mt-3 font-bold">{status === 403 ? "Esta sección es solo para el administrador." : status === 401 ? "Inicia sesión para ver el panel." : "No pudimos cargar el panel."}</p><p className="mt-1 text-xs text-muted-foreground">{status && status < 500 ? "" : (query.error as Error).message}</p></div>}

    {data && <>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Usuarios registrados" value={data.totals.users} hint={`${data.totals.new7d} nuevos en 7 días`} />
        <Stat label="Activos esta semana" value={data.totals.active7d} hint={`${data.totals.active30d} en los últimos 30 días`} />
        <Stat label="Con watchlist" value={data.totals.withWatchlist} hint={`${data.totals.watchlistItems} activos seguidos en total`} />
        <Stat label="Con Telegram" value={data.totals.telegram} hint={data.totals.users ? `${Math.round((data.totals.telegram / data.totals.users) * 100)}% de los usuarios` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-card-border bg-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4 text-primary" /> Registros por día</h2>
          <p className="mb-4 text-[11px] text-muted-foreground">Últimos 30 días, hora de Caracas.</p>
          <BarChart data={data.signups} series={[{ key: "count", label: "Registros", className: "bg-primary" }]} />
        </section>
        <section className="rounded-2xl border border-card-border bg-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold"><Star className="h-4 w-4 text-primary" /> Lo que más sigue la comunidad</h2>
          <p className="mb-3 text-[11px] text-muted-foreground">Tickers en más watchlists.</p>
          {data.topTickers.length ? <div className="space-y-1.5">{data.topTickers.slice(0, 10).map((t) => <div key={t.ticker} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 font-mono-app font-bold" translate="no">{t.ticker}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"><span className="block h-full rounded-full bg-primary/80" style={{ width: `${(t.count / maxTicker) * 100}%` }} /></span>
            <span className="w-6 text-right font-mono-app text-muted-foreground">{t.count}</span>
          </div>)}</div> : <p className="text-xs text-muted-foreground">Nadie ha agregado activos todavía.</p>}
        </section>
      </div>

      <section className="mt-4 rounded-2xl border border-card-border bg-card p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold"><Send className="h-4 w-4 text-[#229ED9]" /> Alertas de Telegram por día</h2>
        <p className="mb-4 text-[11px] text-muted-foreground">Para vigilar que el bot no haga ruido. Las del resumen salen en un solo mensaje al cierre.</p>
        <BarChart height={90} data={data.alerts} series={[{ key: "instant", label: "Avisos inmediatos", className: "bg-primary" }, { key: "digest", label: "Cambios enviados en el resumen", className: "bg-muted-foreground/45" }]} />
      </section>

      <section className="mt-4 rounded-2xl border border-card-border bg-card">
        <div className="flex flex-col gap-3 border-b border-card-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div><h2 className="text-sm font-bold">Usuarios</h2><p className="text-[11px] text-muted-foreground">{users.length} de {data.users.length}{data.truncated ? ` (mostrando los 500 más recientes de ${data.totals.users})` : ""}</p></div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nombre o correo" className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-xs outline-none focus:border-primary sm:w-56" /></div>
            <div className="flex rounded-lg border border-card-border bg-secondary/40 p-0.5 text-[11px] font-bold">
              {([["all", "Todos"], ["watchlist", "Con watchlist"], ["telegram", "Telegram"], ["inactive", "Sin activos"]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`rounded-md px-2 py-1 ${filter === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{label}</button>)}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><tr className="border-b border-card-border"><th className="px-4 py-2.5 font-bold sm:px-5">Usuario</th><th className="px-3 py-2.5 font-bold">Registro</th><th className="px-3 py-2.5 font-bold">Último ingreso</th><th className="px-3 py-2.5 text-right font-bold">Watchlist</th><th className="px-3 py-2.5 font-bold">Telegram</th></tr></thead>
            <tbody className="divide-y divide-card-border/70">
              {users.map((u) => <tr key={u.id} className="hover:bg-secondary/30">
                <td className="px-4 py-2.5 sm:px-5"><p className="font-bold">{u.name ?? u.email ?? "Sin nombre"}{u.cashRegister && <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">CAJA</span>}</p><p className="text-[10px] text-muted-foreground">{u.name ? u.email : ""} · {u.method}</p></td>
                <td className="px-3 py-2.5 text-muted-foreground">{dateFmt.format(new Date(u.createdAt))}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{relative(u.lastActiveAt ?? u.lastSignInAt)}</td>
                <td className="px-3 py-2.5 text-right font-mono-app">{u.watchlist}</td>
                <td className="px-3 py-2.5">{u.telegram ? <span className="font-bold text-accent">Conectado</span> : <span className="text-muted-foreground">No</span>}</td>
              </tr>)}
            </tbody>
          </table>
          {!users.length && <p className="p-6 text-center text-xs text-muted-foreground">Ningún usuario coincide.</p>}
        </div>
      </section>
      <p className="mt-3 text-[10px] text-muted-foreground">Actualizado {relative(data.generatedAt).toLowerCase()}. Visitas y países: Vercel → jb-termometro-bursatil → Analytics.</p>
    </>}
  </main>;
}
