import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, CheckCircle2, Send } from "lucide-react";

type TelegramStatus = {
  configured: boolean;
  botUsername: string | null;
  linked: boolean;
  telegramName: string | null;
  enabled: boolean;
  mutedUntil: string | null;
  signalChanges: boolean;
  opportunityAlerts: boolean;
  lastRun: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Error ${response.status}`);
  return body;
}

function TelegramLogo({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#229ED9" /><path fill="#fff" d="M5.4 11.8l11.1-4.3c.5-.2 1 .1.8.9l-1.9 8.9c-.1.6-.5.8-1 .5l-2.8-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-2.9 5.2-4.7c.2-.2 0-.3-.3-.1l-6.4 4-2.8-.9c-.6-.2-.6-.6.1-.9z" /></svg>;
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-secondary/50 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
    <span><span className="block text-xs font-bold">{label}</span>{hint && <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{hint}</span>}</span>
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  </label>;
}

export function TelegramAlerts({ userId, sampleTicker, onChanged }: { userId: string; sampleTicker: string; onChanged?: () => void }) {
  const queryClient = useQueryClient();
  const statusKey = ["telegram-status", userId];
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => api<TelegramStatus>("/telegram/status"),
    refetchInterval: waiting ? 3000 : false,
    refetchOnWindowFocus: true,
  });
  const data = status.data;
  const needsLink = Boolean(data?.configured && !data.linked);

  // Pre-create the one-time link so the button is a real <a> (iOS blocks window.open after an await).
  const link = useQuery({
    queryKey: ["telegram-link", userId],
    queryFn: () => api<{ url: string; botUsername: string }>("/telegram/link", { method: "POST" }),
    enabled: needsLink,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (data?.linked && waiting) {
      setWaiting(false);
      setMessage({ text: "¡Conectado! Te enviamos un saludo por Telegram 👋", tone: "ok" });
      onChanged?.();
    }
  }, [data?.linked, waiting, onChanged]);

  useEffect(() => {
    if (!waiting) return;
    const timeout = window.setTimeout(() => setWaiting(false), 3 * 60 * 1000);
    return () => window.clearTimeout(timeout);
  }, [waiting]);

  const update = async (patch: Record<string, boolean>, key: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const next = await api<TelegramStatus>("/telegram/settings", { method: "PATCH", body: JSON.stringify(patch) });
      queryClient.setQueryData(statusKey, next);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "No pudimos guardar.", tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy("test");
    setMessage(null);
    try {
      const result = await api<{ message: string }>("/telegram/test", { method: "POST" });
      setMessage({ text: result.message, tone: "ok" });
      onChanged?.();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "No pudimos enviar la prueba.", tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("¿Desconectar Telegram? Dejarás de recibir alertas.")) return;
    setBusy("unlink");
    try {
      const next = await api<TelegramStatus>("/telegram/link", { method: "DELETE" });
      queryClient.setQueryData(statusKey, next);
      void queryClient.invalidateQueries({ queryKey: ["telegram-link", userId] });
      setMessage({ text: "Telegram desconectado.", tone: "ok" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "No pudimos desconectar.", tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const mutedUntil = data?.mutedUntil ? new Date(data.mutedUntil) : null;

  return <div>
    <div className="flex items-start gap-3">
      <TelegramLogo className="h-9 w-9 shrink-0" />
      <div>
        <p className="text-sm font-bold">Alertas por Telegram</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">Te avisamos al instante cuando cambie la señal JB de tu watchlist. Gratis y sin compartir tu número.</p>
      </div>
    </div>

    {status.isLoading ? <div className="mt-4 h-24 animate-pulse rounded-xl bg-secondary/50" />
      : status.error ? <p className="mt-4 text-[11px] text-destructive">No pudimos cargar tus alertas. Recarga la página.</p>
      : !data?.configured ? <div className="mt-4 rounded-xl border border-dashed border-card-border p-4 text-center text-[11px] text-muted-foreground">Estamos encendiendo el bot. Muy pronto podrás conectarlo aquí. 🔧</div>
      : !data.linked ? <div className="mt-4 space-y-3">
        <ol className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <li><b className="text-foreground">1.</b> Toca «Conectar Telegram».</li>
          <li><b className="text-foreground">2.</b> En Telegram, toca <b className="text-foreground">Iniciar</b>.</li>
          <li><b className="text-foreground">3.</b> Listo. Vuelve aquí y verás tu cuenta conectada.</li>
        </ol>
        {link.data ? <a href={link.data.url} target="_blank" rel="noopener noreferrer" onClick={() => { setWaiting(true); setMessage(null); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#229ED9] px-4 py-3 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90">
          <Send className="h-4 w-4" /> Conectar Telegram
        </a> : <button type="button" disabled className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#229ED9]/60 px-4 py-3 text-sm font-bold text-white">{link.error ? "Telegram no responde, reintenta en un minuto" : "Preparando enlace…"}</button>}
        {waiting && <p className="text-center text-[11px] font-bold text-muted-foreground">Esperando que toques «Iniciar» en Telegram…</p>}
      </div>
      : <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-accent/10 px-3 py-2.5">
          <span className="flex items-center gap-2 text-xs font-bold text-accent"><CheckCircle2 className="h-4 w-4" /> Conectado{data.telegramName ? ` como ${data.telegramName}` : ""}</span>
          <button type="button" onClick={() => void disconnect()} disabled={busy !== null} className="text-[10px] font-bold text-muted-foreground hover:text-destructive">Desconectar</button>
        </div>
        {mutedUntil && <div className="flex items-center justify-between gap-3 rounded-xl border border-card-border px-3 py-2.5 text-[11px]">
          <span className="flex items-center gap-2 text-muted-foreground"><BellOff className="h-3.5 w-3.5" /> Silenciado hasta mañana</span>
          <button type="button" onClick={() => void update({ unmute: true }, "unmute")} className="font-bold text-primary">Reactivar</button>
        </div>}
        <div className="divide-y divide-card-border rounded-xl border border-card-border">
          <Toggle checked={data.enabled} onChange={(value) => void update({ enabled: value }, "enabled")} label="Recibir alertas" disabled={busy !== null} />
          <Toggle checked={data.signalChanges} onChange={(value) => void update({ signalChanges: value }, "signal")} label="Cualquier cambio de señal" hint="Ej.: de «A considerar» a «Descartado de momento»." disabled={busy !== null || !data.enabled} />
          <Toggle checked={data.opportunityAlerts} onChange={(value) => void update({ opportunityAlerts: value }, "opp")} label="Solo oportunidades" hint="Cuando un activo entra en zona «Interesante»." disabled={busy !== null || !data.enabled} />
        </div>
        <button type="button" onClick={() => void sendTest()} disabled={busy !== null} className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs font-bold text-primary transition-colors hover:bg-primary/15 disabled:opacity-50">
          <BellRing className="h-3.5 w-3.5" /> {busy === "test" ? "Enviando…" : "Enviarme un mensaje de prueba"}
        </button>
        <p className="text-[10px] leading-relaxed text-muted-foreground">Revisamos el mercado cada 15 minutos con Wall Street abierto. En Telegram puedes escribir /radar para ver tus señales al momento.</p>
      </div>}

    {message && <p className={`mt-3 text-[11px] font-bold ${message.tone === "ok" ? "text-accent" : "text-destructive"}`}>{message.text}</p>}

    <div className="mt-4 rounded-2xl bg-[#e6ebee] p-3 dark:bg-[#17212b]">
      <p className="mb-2 text-center text-[9px] font-bold uppercase tracking-[0.14em] text-[#6d7f8f]">Así se ve un aviso</p>
      <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[12px] leading-relaxed text-[#0f1419] shadow-sm dark:bg-[#182533] dark:text-[#f5f5f5]">
        <p><b>🟢 {sampleTicker} entró en zona interesante</b></p>
        <p className="mt-1.5">🌡️ Nivel JB: <b>78/100</b></p>
        <p>↪️ Antes: A considerar</p>
        <p className="mt-1.5">Buen momento para revisar tu plan DCA.</p>
      </div>
      <div className="mt-1 grid max-w-[92%] grid-cols-2 gap-1 text-[11px] font-bold text-white">
        <span className="rounded-lg bg-[#6d8ba1]/80 py-1.5 text-center dark:bg-[#2b5278]">📊 Ver ficha</span>
        <span className="rounded-lg bg-[#6d8ba1]/80 py-1.5 text-center dark:bg-[#2b5278]">🔕 Silenciar hoy</span>
      </div>
    </div>
  </div>;
}
