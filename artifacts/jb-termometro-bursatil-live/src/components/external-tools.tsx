import { useState } from "react";
import type { ExternalTool } from "@/data/external-tools";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Logo oficial si existe en public/tools; si no (o si falla la carga), las iniciales.
function ToolLogo({ tool }: { tool: ExternalTool }) {
  const [failed, setFailed] = useState(false);
  const src = tool.logo ?? `/tools/${tool.slug}.png`;
  if (!failed) {
    return <img src={`${basePath}${src}`} alt={`Logo de ${tool.name}`} onError={() => setFailed(true)} className="h-10 w-auto max-w-[8rem] shrink-0 rounded-lg border border-card-border bg-white object-contain px-2 py-1" />;
  }
  return <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-foreground text-xs font-extrabold tracking-[-0.04em] text-[#f7c96b]">{tool.mark}</span>;
}

export function ExternalTools({ title, tools, ticker, note }: { title: string; tools: ExternalTool[]; ticker: string; note?: string }) {
  return <section className="mt-4 rounded-2xl border border-card-border bg-secondary/40 p-3">
    <p className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{title}</p>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {tools.map((tool) => <a key={tool.slug} href={tool.href(ticker)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-3 transition-colors hover:border-primary">
        <ToolLogo tool={tool} />
        <span className="min-w-0">
          <span translate="no" className="notranslate block text-sm font-bold">{tool.name}</span>
          <span className="block text-[11px] leading-snug text-muted-foreground">{tool.summary}</span>
          <span className="mt-1 block text-[11px] font-bold text-primary">{tool.cta} ↗</span>
        </span>
      </a>)}
    </div>
    <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{note ?? "Sitio de un tercero, sin relación comercial con JB Termómetro. Información educativa, no asesoría de inversión."}</p>
  </section>;
}
