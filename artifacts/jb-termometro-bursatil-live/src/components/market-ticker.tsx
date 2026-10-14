import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export type MarketPulse = {
  updatedAt: string;
  source: string;
  partial: boolean;
  tape: Array<{ ticker: string; name: string; price: number; change: number | null }>;
  sectors: Array<{
    key: string;
    name: string;
    etf: string;
    etfChange: number | null;
    stocks: Array<{ ticker: string; change: number | null; marketCap: number }>;
  }>;
};

export function useMarketPulse() {
  return useQuery<MarketPulse>({
    queryKey: ["market-pulse"],
    queryFn: async () => {
      const response = await fetch(`${basePath}/api/market/pulse`);
      if (!response.ok) throw new Error("pulse unavailable");
      return (await response.json()) as MarketPulse;
    },
    staleTime: 4 * 60 * 1000,
    // A partial answer means some names were missing; ask again soon.
    refetchInterval: (query) => (query.state.data?.partial ? 30_000 : 5 * 60 * 1000),
    retry: 1,
  });
}

function Item({ ticker, name, price, change }: { ticker: string; name: string; price: number; change: number | null }) {
  const up = (change ?? 0) >= 0;
  return <span className="inline-flex shrink-0 items-center gap-2 px-4 text-[12px]" translate="no">
    <b className="font-mono-app">{ticker}</b>
    <span className="hidden text-muted-foreground sm:inline">{name}</span>
    <span className="font-mono-app">{price.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    {change !== null && <span className={`inline-flex items-center font-mono-app font-bold ${up ? "text-emerald-600" : "text-red-600"}`}>{up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(change).toFixed(2)}%</span>}
  </span>;
}

// Cinta de cotizaciones con altura fija, para que la página no salte mientras carga.
export function MarketTicker() {
  const { data } = useMarketPulse();
  const items = data?.tape ?? [];
  return <div className="market-ticker h-9 w-full overflow-hidden border-b border-card-border bg-card" role="region" aria-label="Cotizaciones de referencia">
    <style>{`@keyframes jb-ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}.market-ticker .track{animation:jb-ticker 45s linear infinite}.market-ticker:hover .track{animation-play-state:paused}@media (prefers-reduced-motion:reduce){.market-ticker .track{animation:none}.market-ticker{overflow-x:auto}}`}</style>
    {items.length > 0 && <div className="track flex h-9 w-max items-center">
      {[0, 1].map((copy) => <div key={copy} className="flex items-center" aria-hidden={copy === 1 ? "true" : undefined}>{items.map((item) => <Item key={item.ticker} {...item} />)}</div>)}
    </div>}
  </div>;
}
