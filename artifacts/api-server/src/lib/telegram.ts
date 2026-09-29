import { createHash, randomBytes } from "crypto";
import { pool, TELEGRAM_DDL } from "@workspace/db";
import { logger } from "./logger";

export const APP_URL = process.env.TERMOMETRO_APP_URL ?? "https://jb-termometro-bursatil.vercel.app";
export const API_URL = process.env.PUBLIC_API_URL ?? "https://jb-api-server.vercel.app";

export function telegramToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

// Secret Telegram echoes back on every webhook call, derived from the token so
// there is one less variable to configure.
export function webhookSecret(): string | null {
  const token = telegramToken();
  return token ? createHash("sha256").update(`jb-webhook:${token}`).digest("hex").slice(0, 48) : null;
}

let schemaReady: Promise<void> | null = null;
export function ensureTelegramSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool.query(TELEGRAM_DDL).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

type TelegramResult<T> = { ok: boolean; result?: T; description?: string; error_code?: number };

export async function tg<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = telegramToken();
  if (!token) throw new Error("TELEGRAM_NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const payload = (await response.json()) as TelegramResult<T>;
    if (!payload.ok) throw new Error(payload.description ?? `Telegram respondió ${response.status}`);
    return payload.result as T;
  } finally {
    clearTimeout(timer);
  }
}

let botUsername: string | null = null;
export async function getBotUsername(): Promise<string | null> {
  if (botUsername) return botUsername;
  if (process.env.TELEGRAM_BOT_USERNAME) return (botUsername = process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, ""));
  if (!telegramToken()) return null;
  try {
    const me = await tg<{ username: string }>("getMe");
    botUsername = me.username;
    return botUsername;
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "Telegram getMe failed");
    return null;
  }
}

export function newLinkCode(): string {
  return randomBytes(12).toString("base64url");
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// "Hoy" ends at midnight in Caracas (UTC-4, no daylight saving).
export function endOfTodayCaracas(now = new Date()): Date {
  const local = new Date(now.getTime() - 4 * 3600_000);
  const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 4, 0, 0);
  return new Date(next);
}

const SIGNAL_STYLE: Record<string, { emoji: string; headline: (ticker: string) => string; hint: string }> = {
  Interesante: {
    emoji: "🟢",
    headline: (ticker) => `${ticker} entró en zona interesante`,
    hint: "Buen momento para revisar tu plan DCA.",
  },
  "A considerar": {
    emoji: "🟡",
    headline: (ticker) => `${ticker} pasó a «A considerar»`,
    hint: "Vale la pena tenerlo en el radar.",
  },
  "Descartado de momento": {
    emoji: "🔴",
    headline: (ticker) => `${ticker} está caro por ahora`,
    hint: "La señal JB sugiere esperar un mejor precio.",
  },
};

export type AlertContent = {
  ticker: string;
  name?: string | null;
  signal: string;
  priorSignal?: string | null;
  level: number;
  price?: number | null;
  change?: number | null;
  test?: boolean;
};

export function formatAlert(alert: AlertContent): { text: string; reply_markup: unknown } {
  const style = SIGNAL_STYLE[alert.signal] ?? { emoji: "🌡️", headline: (t: string) => `${t}: ${alert.signal}`, hint: "" };
  const lines = [
    `${style.emoji} <b>${escapeHtml(style.headline(alert.ticker))}</b>`,
    alert.name ? `<i>${escapeHtml(alert.name)}</i>` : null,
    "",
    `🌡️ Nivel JB: <b>${alert.level}/100</b>`,
    alert.priorSignal ? `↪️ Antes: ${escapeHtml(alert.priorSignal)}` : null,
    typeof alert.price === "number"
      ? `💵 Precio: $${alert.price.toFixed(2)}${typeof alert.change === "number" ? ` (${alert.change >= 0 ? "+" : ""}${alert.change.toFixed(2)}% hoy)` : ""}`
      : null,
    "",
    style.hint || null,
    alert.test ? "\n<i>Mensaje de prueba de JB Termómetro.</i>" : null,
  ].filter((line) => line !== null);
  return {
    text: lines.join("\n").replace(/\n{3,}/g, "\n\n"),
    reply_markup: {
      inline_keyboard: [[
        { text: "📊 Ver ficha", url: `${APP_URL}/?ticker=${encodeURIComponent(alert.ticker)}` },
        { text: "🔕 Silenciar hoy", callback_data: "mute:today" },
      ]],
    },
  };
}

export async function sendAlert(chatId: string, alert: AlertContent): Promise<string> {
  const message = formatAlert(alert);
  const sent = await tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: message.text,
    parse_mode: "HTML",
    reply_markup: message.reply_markup,
    link_preview_options: { is_disabled: true },
  });
  return String(sent.message_id);
}

export async function sendText(chatId: string | number, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
}
