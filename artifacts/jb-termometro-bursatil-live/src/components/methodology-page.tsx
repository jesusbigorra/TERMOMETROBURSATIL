import type { ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Flag, XCircle } from "lucide-react";

// Results of the long backtest run in September 2026 (daily Yahoo data, dividends reinvested,
// $200 per month, idle cash at 3% a year, JB signal computed with the radar's exact rules).
// Keep these numbers in sync with any new run; see CLAUDE.md "Evidence".
const WINDOWS = [
  { strategy: "Comprar dentro del mes el primer día en zona", beats: 43, median: "−0,05%", worst: "−2,4%", best: "+0,4%" },
  { strategy: "Esperar la zona hasta 3 meses", beats: 48, median: "−0,03%", worst: "−5,9%", best: "+0,7%" },
  { strategy: "Solo comprar en zona, sin límite de espera", beats: 56, median: "+0,04%", worst: "−7,9%", best: "+0,8%" },
  { strategy: "Mitad cada mes + mitad en zona", beats: 48, median: "−0,01%", worst: "−2,9%", best: "+0,3%" },
];

const ASSETS = [
  { ticker: "SPY", name: "S&P 500", since: 1994, dca: "+734%", zone: "−0,2%", after: "+12,4%", any: "+12,4%" },
  { ticker: "QQQ", name: "Nasdaq 100", since: 2000, dca: "+1.139%", zone: "0,0%", after: "+10,2%", any: "+12,7%" },
  { ticker: "DIA", name: "Dow Jones", since: 1999, dca: "+409%", zone: "0,0%", after: "+10,7%", any: "+9,3%" },
  { ticker: "IWM", name: "Russell 2000", since: 2001, dca: "+292%", zone: "+0,1%", after: "+15,7%", any: "+10,9%" },
  { ticker: "EFA", name: "Mercados desarrollados", since: 2002, dca: "+162%", zone: "−0,1%", after: "+11,5%", any: "+9,6%" },
  { ticker: "KO", name: "Coca-Cola", since: 1970, dca: "+11.085%", zone: "−0,1%", after: "+13,5%", any: "+13,7%" },
  { ticker: "JNJ", name: "Johnson & Johnson", since: 1970, dca: "+13.712%", zone: "−0,4%", after: "+13,4%", any: "+13,6%" },
  { ticker: "MSFT", name: "Microsoft", since: 1987, dca: "+24.000%", zone: "−0,4%", after: "+21,0%", any: "+26,7%" },
];

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-card-border bg-card p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function MethodologyPage({ onBack }: { onBack: () => void }) {
  return <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} className="rounded-xl border border-card-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Volver al Termómetro"><ArrowLeft className="h-4 w-4" /></button>
      <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Transparencia</p><h1 className="font-display text-xl font-bold tracking-[-0.04em] sm:text-2xl">Metodología y evidencia</h1></div>
    </div>

    <Card className="mt-6 border-primary/40 bg-primary/[.06]">
      <div className="flex items-start gap-3">
        <Flag className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="font-display text-lg font-bold tracking-[-0.02em]">Nuestro compromiso</h2>
          <p className="mt-2 text-sm leading-relaxed">Probamos la señal JB con más de 30 años de datos reales antes de decirte qué hace. <b>Comprar en las zonas de descuento no te cuesta rendimiento frente a comprar cada mes, pero tampoco lo multiplica.</b> Su valor es otro: saber que tu aporte de este mes entró por debajo de sus promedios, y no dejarte llevar por la euforia ni por el miedo.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-card p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-accent"><CheckCircle2 className="h-4 w-4" /> Lo que el Termómetro sí hace</p>
              <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
                <li>Te muestra, con reglas fijas y públicas, si un activo está caro o con descuento.</li>
                <li>Te ayuda a comprar cada mes con calma y criterio.</li>
                <li>Te avisa por Telegram solo cuando algo entra en zona de descuento.</li>
              </ul>
            </div>
            <div className="rounded-xl bg-card p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-destructive"><XCircle className="h-4 w-4" /> Lo que no promete</p>
              <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
                <li>Ganarle al mercado ni a una compra mensual disciplinada.</li>
                <li>Adivinar el piso de una caída.</li>
                <li>Que el pasado se repita. No es asesoría financiera.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Card>

    <Card className="mt-4">
      <h2 className="font-display text-lg font-bold tracking-[-0.02em]">Cómo se calcula la señal</h2>
      <div className="mt-3 grid gap-3 text-[13px] leading-relaxed text-muted-foreground sm:grid-cols-2">
        <p><b className="text-foreground">Precio frente a sus medias (hasta 50 puntos).</b> Bajo la media de 20 días: 20 puntos. Bajo la de 50: 30. Bajo la de 100: 40. Bajo la de 200: 50.</p>
        <p><b className="text-foreground">Temperatura, RSI de 14 días (hasta 50 puntos).</b> Mientras más frío está el activo, más puntos: (70 − RSI) × 1,25.</p>
        <p><b className="text-foreground">Interesante:</b> RSI entre 30 y 40 y precio bajo la media de 50 días o más abajo.</p>
        <p><b className="text-foreground">Descartado de momento:</b> RSI de 65 o más, o precio sobre todas sus medias. Todo lo demás es "A considerar".</p>
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">En el simulador y en esta prueba, "zona de descuento" es la señal Interesante o un Nivel JB de 60 o más.</p>
    </Card>

    <Card className="mt-4">
      <h2 className="font-display text-lg font-bold tracking-[-0.02em]">La prueba: 213 periodos de 10 años</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">8 ETFs y acciones con datos diarios reales, que cubren las crisis de 2000, 2008, 2020 y 2022. Cada estrategia invierte $200 al mes y la comparamos con comprar siempre el primer día hábil del mes. Dividendos reinvertidos; el dinero en espera gana 3% anual.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground"><tr className="border-b border-card-border"><th className="py-2 pr-3 font-bold">Estrategia</th><th className="px-3 py-2 text-right font-bold">Gana al DCA</th><th className="px-3 py-2 text-right font-bold">Diferencia típica</th><th className="px-3 py-2 text-right font-bold">Peor</th><th className="py-2 pl-3 text-right font-bold">Mejor</th></tr></thead>
          <tbody className="divide-y divide-card-border/70">{WINDOWS.map((row) => <tr key={row.strategy}><td className="py-2.5 pr-3 font-bold">{row.strategy}</td><td className="px-3 py-2.5 text-right font-mono-app">{row.beats}% de las veces</td><td className="px-3 py-2.5 text-right font-mono-app">{row.median}</td><td className="px-3 py-2.5 text-right font-mono-app text-muted-foreground">{row.worst}</td><td className="py-2.5 pl-3 text-right font-mono-app text-muted-foreground">{row.best}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-3 rounded-xl bg-secondary/50 px-3 py-2 text-[12px] leading-relaxed"><b>Lectura:</b> ninguna forma de esperar las zonas le gana de manera consistente a comprar cada mes. Las diferencias típicas son de centésimas de punto. Esperar demasiado puede costar hasta 8 puntos si el mercado sube sin pausa.</p>
    </Card>

    <Card className="mt-4">
      <h2 className="font-display text-lg font-bold tracking-[-0.02em]">Activo por activo, todo el historial</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground"><tr className="border-b border-card-border"><th className="py-2 pr-3 font-bold">Activo</th><th className="px-3 py-2 text-right font-bold">Desde</th><th className="px-3 py-2 text-right font-bold">DCA mensual</th><th className="px-3 py-2 text-right font-bold">Comprar en zona vs. DCA</th><th className="py-2 pl-3 text-right font-bold">12 meses tras Interesante / cualquier día</th></tr></thead>
          <tbody className="divide-y divide-card-border/70">{ASSETS.map((row) => <tr key={row.ticker}><td className="py-2.5 pr-3"><span className="font-mono-app font-bold">{row.ticker}</span> <span className="text-muted-foreground">{row.name}</span></td><td className="px-3 py-2.5 text-right font-mono-app">{row.since}</td><td className="px-3 py-2.5 text-right font-mono-app">{row.dca}</td><td className="px-3 py-2.5 text-right font-mono-app">{row.zone}</td><td className="py-2.5 pl-3 text-right font-mono-app">{row.after} / {row.any}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">Lo que construyó el patrimonio en todos los casos fue la constancia: miles por ciento en décadas comprando cada mes. Comprar en zona dejó el resultado prácticamente igual.</p>
    </Card>

    <Card className="mt-4">
      <h2 className="font-display text-lg font-bold tracking-[-0.02em]">¿Y si tengo todo el dinero de una vez?</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">Es otra situación. Un estudio de Vanguard (2012) encontró que invertir una suma completa de inmediato le ganó a repartirla en 12 meses cerca de 2 de cada 3 veces, porque el dinero pasa más tiempo invertido. Si inviertes de tu ingreso mensual, no tienes esa suma: el DCA es tu forma natural de invertir, y el Termómetro te ayuda a hacerlo con criterio. <a href="https://static.twentyoverten.com/5980d16bbfb1c93238ad9c24/rJpQmY8o7/Dollar-Cost-Averaging-Just-Means-Taking-Risk-Later-Vanguard.pdf" target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline">Leer el estudio</a></p>
    </Card>

    <p className="mt-4 px-1 text-[11px] leading-relaxed text-muted-foreground">Prueba realizada en septiembre de 2026 con precios diarios de Yahoo Finance ajustados por dividendos y splits. El RSI se calcula con un año móvil de datos. Rendimientos pasados no garantizan resultados futuros. El Termómetro es una herramienta educativa, no asesoría financiera.</p>
  </main>;
}
