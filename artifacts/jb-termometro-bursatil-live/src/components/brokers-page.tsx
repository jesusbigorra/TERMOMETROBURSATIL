import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ExternalLink, Landmark, LogIn, MapPin, ShieldCheck } from "lucide-react";
import { BROKERS, REVIEWED_ON, type Broker, type BrokerRegion } from "@/data/brokers";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const FILTERS: Array<"Todos" | BrokerRegion> = ["Todos", "EE. UU.", "Europa", "Global"];

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-card-border bg-card p-5 sm:p-6 ${className}`}>{children}</section>;
}

function SectionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{icon}{children}</h3>;
}

// Muestra el logo oficial si existe en public/brokers; si no, las iniciales del broker.
function BrokerLogo({ broker }: { broker: Broker }) {
  const [failed, setFailed] = useState(false);
  if (broker.logo && !failed) {
    return <img src={`${basePath}${broker.logo}`} alt={`Logo de ${broker.name}`} onError={() => setFailed(true)} className="h-12 w-12 shrink-0 rounded-xl border border-card-border bg-white object-contain p-1.5" />;
  }
  return <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-foreground text-sm font-extrabold tracking-[-0.04em] text-[#f7c96b]">{broker.mark}</span>;
}

function BrokerCard({ broker }: { broker: Broker }) {
  return <article id={broker.slug} className="flex flex-col rounded-2xl border border-card-border bg-card p-5 shadow-sm">
    <header className="flex items-start gap-3">
      <BrokerLogo broker={broker} />
      <div className="min-w-0">
        <h2 className="font-display text-lg font-bold tracking-[-0.02em]">{broker.name}</h2>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{broker.summary}</p>
      </div>
    </header>
    <div className="mt-3 flex flex-wrap gap-1.5">
      {broker.regions.map((region) => <span key={region} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{region}</span>)}
    </div>

    <div className="mt-4">
      <SectionLabel icon={<MapPin className="h-3.5 w-3.5" />}>Zona</SectionLabel>
      <p className="mt-1.5 text-[12.5px] leading-relaxed">{broker.zone}</p>
    </div>

    <div className="mt-4">
      <SectionLabel icon={<Landmark className="h-3.5 w-3.5" />}>Regulación</SectionLabel>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed marker:text-muted-foreground">
        {broker.regulators.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>

    <div className="mt-4 rounded-xl border border-accent/30 bg-accent/[.07] p-3">
      <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-accent"><ShieldCheck className="h-3.5 w-3.5" />Capital resguardado</h3>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed marker:text-accent">
        {broker.protection.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>

    <p className="mt-3 rounded-xl bg-secondary/60 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground"><b className="text-foreground">Ten en cuenta:</b> {broker.caveat}</p>

    <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
      <a href={broker.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90" aria-label={`Abrir el sitio oficial de ${broker.name} en una pestaña nueva`}>Sitio oficial <ExternalLink className="h-3.5 w-3.5" /></a>
      {broker.login && <a href={broker.login.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-card-border px-3.5 py-2 text-xs font-bold hover:bg-secondary" aria-label={`${broker.login.label} en ${broker.name}, en una pestaña nueva`}><LogIn className="h-3.5 w-3.5" /> {broker.login.label}</a>}
    </div>
    <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">Fuente: {broker.sources.map((source, index) => <span key={source.url}>{index > 0 && " · "}<a href={source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-foreground">{source.label}</a></span>)}</p>
  </article>;
}

export function BrokersPage({ onBack }: { onBack: () => void }) {
  const [region, setRegion] = useState<"Todos" | BrokerRegion>("Todos");
  const visible = useMemo(() => BROKERS.filter((broker) => region === "Todos" || broker.regions.includes(region)), [region]);
  return <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} className="rounded-xl border border-card-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Volver al Termómetro"><ArrowLeft className="h-4 w-4" /></button>
      <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Directorio</p><h1 className="font-display text-xl font-bold tracking-[-0.04em] sm:text-2xl">Brokers</h1></div>
    </div>

    <Card className="mt-6 border-primary/40 bg-primary/[.06]">
      <div className="flex items-start gap-3">
        <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="font-display text-lg font-bold tracking-[-0.02em]">Dónde puedes invertir, y quién respalda tu dinero</h2>
          <p className="mt-2 text-sm leading-relaxed">Para cada broker ves quién lo regula, en qué zona opera y cuánto capital resguarda el esquema de protección. Los datos salen de la página oficial de cada uno y se revisaron el {REVIEWED_ON}.</p>
          <div className="mt-4 rounded-xl bg-card p-3">
            <p className="text-xs font-bold">Cómo leer la protección</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">Esquemas como SIPC (EE. UU.), FSCS (Reino Unido) o los fondos de compensación europeos responden si el broker falla y no puede devolverte tus activos. Ninguno cubre pérdidas por la caída de los precios. Los límites son por cliente y cambian según la entidad y el tipo de producto.</p>
          </div>
        </div>
      </div>
    </Card>

    <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por zona">
      {FILTERS.map((item) => <button key={item} type="button" onClick={() => setRegion(item)} aria-pressed={region === item} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${region === item ? "border-primary bg-primary text-primary-foreground" : "border-card-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>{item}</button>)}
      <span className="ml-1 text-[11px] text-muted-foreground">{visible.length} de {BROKERS.length} brokers</span>
    </div>

    <div className="mt-4 grid gap-4 md:grid-cols-2">
      {visible.map((broker) => <BrokerCard key={broker.slug} broker={broker} />)}
    </div>

    <Card className="mt-6">
      <h2 className="font-display text-base font-bold tracking-[-0.02em]">Antes de abrir una cuenta</h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[12.5px] leading-relaxed text-muted-foreground">
        <li>Confirma en el sitio del broker si atiende a residentes de tu país. La disponibilidad, las comisiones y las condiciones cambian.</li>
        <li>Verifica la licencia en el registro del propio regulador y compárala con lo que informa el broker.</li>
        <li>El orden de la lista no es un ranking ni una recomendación.</li>
        <li>El Termómetro no es un broker y no custodia dinero. Esta página es información de referencia y no constituye asesoría financiera.</li>
      </ul>
    </Card>
  </main>;
}
