import { useState } from "react";
import { Check, Plus, Sparkles } from "lucide-react";

type Suggestion = { ticker: string; name: string; why: string };

// Starter universe: broad, liquid and widely held instruments, chosen to cover
// different strategies (core index, growth, dividends, international, defense).
const ETFS: Suggestion[] = [
  { ticker: "VOO", name: "Vanguard S&P 500", why: "Las 500 mayores empresas de EE. UU. Núcleo clásico para DCA." },
  { ticker: "VTI", name: "Vanguard Total Stock Market", why: "Todo el mercado de EE. UU., grandes y pequeñas empresas." },
  { ticker: "QQQM", name: "Invesco Nasdaq 100", why: "Las 100 mayores del Nasdaq: tecnología y crecimiento." },
  { ticker: "SCHG", name: "Schwab U.S. Large-Cap Growth", why: "Grandes empresas de crecimiento con comisión muy baja." },
  { ticker: "SCHD", name: "Schwab U.S. Dividend Equity", why: "Empresas sólidas que reparten dividendos." },
  { ticker: "VIG", name: "Vanguard Dividend Appreciation", why: "Empresas que suben su dividendo año tras año." },
  { ticker: "JEPQ", name: "JPMorgan Nasdaq Equity Premium Income", why: "Ingreso mensual alto; renuncia a parte de las subidas." },
  { ticker: "VXUS", name: "Vanguard Total International", why: "Acciones fuera de EE. UU. para diversificar país y moneda." },
  { ticker: "BND", name: "Vanguard Total Bond Market", why: "Bonos de EE. UU.: suele amortiguar las caídas de acciones." },
  { ticker: "GLDM", name: "SPDR Gold MiniShares", why: "Oro a bajo costo; refugio en crisis e inflación." },
];

const STOCKS: Suggestion[] = [
  { ticker: "MSFT", name: "Microsoft", why: "Software empresarial y nube; márgenes muy altos." },
  { ticker: "AAPL", name: "Apple", why: "Ecosistema de dispositivos y servicios con clientes muy fieles." },
  { ticker: "NVDA", name: "NVIDIA", why: "Chips que impulsan la inteligencia artificial; alta volatilidad." },
  { ticker: "GOOGL", name: "Alphabet (Google)", why: "Búsqueda, YouTube y nube; mucha caja y poca deuda." },
  { ticker: "AMZN", name: "Amazon", why: "Comercio electrónico y AWS, la mayor nube del mundo." },
  { ticker: "BRK-B", name: "Berkshire Hathaway", why: "El holding de Warren Buffett: seguros, trenes, energía." },
  { ticker: "JPM", name: "JPMorgan Chase", why: "El mayor banco de EE. UU.; referencia del sector financiero." },
  { ticker: "V", name: "Visa", why: "Cobra una comisión por cada pago con tarjeta en el mundo." },
  { ticker: "COST", name: "Costco", why: "Venta por membresía con ingresos muy estables." },
  { ticker: "KO", name: "Coca-Cola", why: "Consumo defensivo con dividendo creciente por más de 60 años." },
];

export function RecommendedSection({ signedIn, owned, onAdd, signInHref }: {
  signedIn: boolean;
  owned: Set<string>;
  onAdd: (ticker: string) => Promise<void>;
  signInHref: string;
}) {
  const [tab, setTab] = useState<"etf" | "stock">("etf");
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const list = tab === "etf" ? ETFS : STOCKS;
  const empty = signedIn && owned.size === 0;

  const add = async (ticker: string) => {
    setPending(ticker);
    setMessage("");
    try {
      await onAdd(ticker);
      setMessage(`${ticker} añadido a tu watchlist.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message.replace(/^HTTP \d+ \w+: /, "") : "No pudimos añadir el activo.");
    } finally {
      setPending(null);
    }
  };

  return <section id="recommended" className="scroll-mt-36 rounded-2xl border border-card-border bg-card lg:scroll-mt-6">
    <div className="flex flex-col gap-3 border-b border-card-border px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Para empezar</p>
        <h2 className="mt-1 flex items-center gap-2 font-display text-lg font-bold tracking-[-0.035em]"><Sparkles className="h-4 w-4 text-primary" /> Recomendadas</h2>
        <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
          {empty ? "Tu watchlist está vacía. Toca «Añadir» en las que quieras seguir y aparecerán en tu radar con su señal JB." : "Activos populares y líquidos para armar tu radar. Toca «Añadir» para seguirlos."}
        </p>
      </div>
      <div className="flex rounded-xl border border-card-border bg-secondary/40 p-0.5" role="tablist">
        {([["etf", "10 ETFs"], ["stock", "10 acciones"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
      </div>
    </div>
    <div className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
      {list.map((item) => {
        const added = owned.has(item.ticker);
        return <div key={item.ticker} className="flex items-start justify-between gap-3 rounded-xl border border-card-border bg-secondary/25 px-3 py-2.5">
          <div className="min-w-0">
            <p className="font-mono-app text-xs font-bold" translate="no">{item.ticker} <span className="ml-1 font-sans text-[10px] font-medium text-muted-foreground">{item.name}</span></p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.why}</p>
          </div>
          {!signedIn ? <a href={signInHref} className="shrink-0 rounded-lg border border-card-border px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground hover:bg-secondary">Entrar</a>
            : added ? <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent/10 px-2.5 py-1.5 text-[10px] font-bold text-accent"><Check className="h-3 w-3" /> En tu radar</span>
            : <button type="button" onClick={() => void add(item.ticker)} disabled={pending !== null} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-bold text-primary-foreground disabled:opacity-50"><Plus className="h-3 w-3" />{pending === item.ticker ? "Añadiendo…" : "Añadir"}</button>}
        </div>;
      })}
    </div>
    <div className="flex flex-col gap-1 border-t border-card-border px-4 py-3 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <span>Ejemplos para investigar, no una recomendación de compra. Revisa su ficha y su señal JB antes de decidir.</span>
      {message && <span className={message.includes("añadido") ? "font-bold text-accent" : "font-bold text-destructive"}>{message}</span>}
    </div>
  </section>;
}
