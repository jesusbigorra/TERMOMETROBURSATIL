import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { alertPreferencesTable, db, telegramLinksTable, watchlistItemsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { claimAlertRun, evaluateAlerts, lastAlertRun, marketWindowOpen, sendDailyDigest, SEEDED } from "../lib/alert-scheduler";
import { getRadarForTickers } from "../lib/market-data";
import { logger } from "../lib/logger";
import {
  API_URL,
  APP_URL,
  endOfTodayCaracas,
  ensureTelegramSchema,
  escapeHtml,
  getBotUsername,
  newLinkCode,
  sendAlert,
  sendText,
  telegramToken,
  tg,
  webhookSecret,
} from "../lib/telegram";

const router: IRouter = Router();
const LINK_CODE_TTL_MS = 15 * 60 * 1000;
const WEBHOOK_URL = `${API_URL}/api/telegram/webhook`;
const OPEN_APP_BUTTON = { inline_keyboard: [[{ text: "🌡️ Abrir Termómetro", url: APP_URL }]] };

// Registers the webhook and the command menu once per server instance.
let webhookChecked: Promise<void> | null = null;
function ensureWebhook(): Promise<void> {
  if (!telegramToken()) return Promise.resolve();
  if (!webhookChecked) {
    webhookChecked = (async () => {
      const info = await tg<{ url: string }>("getWebhookInfo");
      if (info.url !== WEBHOOK_URL) {
        await tg("setWebhook", {
          url: WEBHOOK_URL,
          secret_token: webhookSecret(),
          allowed_updates: ["message", "callback_query"],
          drop_pending_updates: true,
        });
        logger.info({ url: WEBHOOK_URL }, "Telegram webhook registered");
      }
      await tg("setMyCommands", {
        commands: [
          { command: "radar", description: "Señales de tu watchlist ahora" },
          { command: "resumen", description: "Cambios de hoy hasta ahora" },
          { command: "prueba", description: "Envíame un aviso de prueba" },
          { command: "silenciar", description: "Sin avisos hasta mañana" },
          { command: "activar", description: "Volver a recibir avisos" },
          { command: "desconectar", description: "Dejar de recibir alertas" },
        ],
      });
    })().catch((error) => {
      webhookChecked = null;
      logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "Telegram webhook setup failed");
    });
  }
  return webhookChecked;
}

async function statusFor(userId: string) {
  await ensureTelegramSchema();
  const [link] = await db.select().from(telegramLinksTable).where(eq(telegramLinksTable.userId, userId));
  const [preference] = await db.select().from(alertPreferencesTable).where(eq(alertPreferencesTable.userId, userId));
  const now = new Date();
  return {
    configured: Boolean(telegramToken()),
    botUsername: await getBotUsername(),
    linked: Boolean(link?.chatId),
    telegramName: link?.telegramUsername ? `@${link.telegramUsername}` : link?.firstName ?? null,
    enabled: link?.enabled ?? true,
    mutedUntil: link?.mutedUntil && link.mutedUntil > now ? link.mutedUntil.toISOString() : null,
    signalChanges: preference?.signalChanges ?? true,
    opportunityAlerts: preference?.opportunityAlerts ?? true,
    lastRun: await lastAlertRun().catch(() => null),
  };
}

// ---------- App endpoints (signed-in users) ----------

router.get("/telegram/status", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  await ensureWebhook();
  res.json(await statusFor(req.userId!));
});

router.post("/telegram/link", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  if (!telegramToken()) {
    res.status(503).json({ error: "El bot de Telegram aún no está configurado." });
    return;
  }
  await ensureTelegramSchema();
  await ensureWebhook();
  const bot = await getBotUsername();
  if (!bot) {
    res.status(503).json({ error: "No pudimos contactar a Telegram. Inténtalo en un minuto." });
    return;
  }
  const code = newLinkCode();
  const expires = new Date(Date.now() + LINK_CODE_TTL_MS);
  await db
    .insert(telegramLinksTable)
    .values({ userId: req.userId!, linkCode: code, linkCodeExpiresAt: expires })
    .onConflictDoUpdate({ target: telegramLinksTable.userId, set: { linkCode: code, linkCodeExpiresAt: expires } });
  res.json({ url: `https://t.me/${bot}?start=${code}`, botUsername: bot, expiresAt: expires.toISOString() });
});

router.patch("/telegram/settings", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  await ensureTelegramSchema();
  const body = (req.body ?? {}) as { enabled?: unknown; unmute?: unknown; signalChanges?: unknown; opportunityAlerts?: unknown };
  const linkPatch: Partial<typeof telegramLinksTable.$inferInsert> = {};
  if (typeof body.enabled === "boolean") linkPatch.enabled = body.enabled;
  if (body.unmute === true) linkPatch.mutedUntil = null;
  if (Object.keys(linkPatch).length) {
    await db.update(telegramLinksTable).set(linkPatch).where(eq(telegramLinksTable.userId, req.userId!));
  }
  const prefPatch: { signalChanges?: boolean; opportunityAlerts?: boolean } = {};
  if (typeof body.signalChanges === "boolean") prefPatch.signalChanges = body.signalChanges;
  if (typeof body.opportunityAlerts === "boolean") prefPatch.opportunityAlerts = body.opportunityAlerts;
  if (Object.keys(prefPatch).length) {
    await db
      .insert(alertPreferencesTable)
      .values({ id: randomUUID(), userId: req.userId!, ...prefPatch })
      .onConflictDoUpdate({ target: alertPreferencesTable.userId, set: prefPatch });
  }
  res.json(await statusFor(req.userId!));
});

router.delete("/telegram/link", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  await ensureTelegramSchema();
  const [link] = await db.select().from(telegramLinksTable).where(eq(telegramLinksTable.userId, req.userId!));
  await db.delete(telegramLinksTable).where(eq(telegramLinksTable.userId, req.userId!));
  if (link?.chatId) {
    await sendText(link.chatId, "👋 Desconectaste tu cuenta. Ya no te enviaré alertas.", { reply_markup: OPEN_APP_BUTTON }).catch(() => undefined);
  }
  res.json(await statusFor(req.userId!));
});

router.post("/telegram/test", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  await ensureTelegramSchema();
  const [link] = await db.select().from(telegramLinksTable).where(eq(telegramLinksTable.userId, req.userId!));
  if (!link?.chatId) {
    res.status(400).json({ error: "Primero conecta tu Telegram." });
    return;
  }
  try {
    await sendTestAlert(req.userId!, link.chatId);
    res.json({ ok: true, message: "Listo, revisa tu Telegram 📲" });
  } catch (error) {
    res.status(502).json({ error: `Telegram no aceptó el mensaje: ${error instanceof Error ? error.message : "error"}` });
  }
});

// Real data for the most recent watchlist asset, marked as a test.
async function sendTestAlert(userId: string, chatId: string): Promise<void> {
  const [item] = await db.select({ ticker: watchlistItemsTable.ticker }).from(watchlistItemsTable).where(eq(watchlistItemsTable.userId, userId)).orderBy(desc(watchlistItemsTable.createdAt)).limit(1);
  const ticker = item?.ticker ?? "VOO";
  const radar = await getRadarForTickers([ticker]).catch(() => null);
  const asset = radar?.assets[0];
  await sendAlert(chatId, {
    ticker,
    name: asset?.name,
    signal: asset?.signal ?? "Interesante",
    level: asset?.level ?? 80,
    price: asset?.price,
    change: asset?.change,
    test: true,
  });
}

// ---------- Scheduler (called every ~15 min by GitHub Actions) ----------

router.get("/cron/alerts", async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!telegramToken()) {
    res.json({ ok: true, skipped: "telegram_not_configured" });
    return;
  }
  await ensureWebhook();
  if (!marketWindowOpen() && req.query.anytime !== "1") {
    res.json({ ok: true, skipped: "market_closed", lastRun: await lastAlertRun().catch(() => null) });
    return;
  }
  if (!(await claimAlertRun())) {
    res.json({ ok: true, skipped: "ran_recently", lastRun: await lastAlertRun().catch(() => null) });
    return;
  }
  try {
    res.json({ ok: true, ...(await evaluateAlerts()) });
  } catch (error) {
    logger.error({ err: error }, "Alert evaluation failed");
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "error" });
  }
});

// ---------- Telegram webhook ----------

type TgUser = { id: number; username?: string; first_name?: string };
type TgUpdate = {
  message?: { chat: { id: number; type: string }; from?: TgUser; text?: string };
  callback_query?: { id: string; data?: string; from: TgUser; message?: { chat: { id: number } } };
};

const HELP = [
  "Soy el bot de <b>JB Termómetro Bursátil</b> 🌡️",
  "",
  "Te aviso cuando cambia la señal JB de los activos de tu watchlist.",
  "",
  "Para no llenarte de mensajes:",
  "• Aviso inmediato solo cuando un activo entra en zona 🟢 Interesante (confirmado en 2 revisiones, máximo 1 por activo al día).",
  "• El resto de cambios llega en un resumen al cierre de Wall Street.",
  "",
  "/radar · señales de tu watchlist ahora",
  "/resumen · cambios de hoy hasta ahora",
  "/prueba · envíame un aviso de prueba",
  "/silenciar · sin avisos hasta mañana",
  "/activar · volver a recibir avisos",
  "/desconectar · dejar de recibir alertas",
].join("\n");

const SIGNAL_EMOJI: Record<string, string> = { Interesante: "🟢", "A considerar": "🟡", "Descartado de momento": "🔴" };

async function linkedUser(chatId: string) {
  const [link] = await db.select().from(telegramLinksTable).where(eq(telegramLinksTable.chatId, chatId));
  return link ?? null;
}

async function handleStart(chatId: string, from: TgUser | undefined, code: string | undefined): Promise<void> {
  if (!code) {
    const existing = await linkedUser(chatId);
    await sendText(chatId, existing ? `¡Hola de nuevo${from?.first_name ? `, ${escapeHtml(from.first_name)}` : ""}! 👋\n\n${HELP}` : `¡Hola${from?.first_name ? `, ${escapeHtml(from.first_name)}` : ""}! 👋\n\nPara recibir alertas, entra al Termómetro, ve a <b>Alertas</b> y toca <b>Conectar Telegram</b>.`, { reply_markup: OPEN_APP_BUTTON });
    return;
  }
  const [pending] = await db.select().from(telegramLinksTable).where(eq(telegramLinksTable.linkCode, code));
  if (!pending || !pending.linkCodeExpiresAt || pending.linkCodeExpiresAt < new Date()) {
    await sendText(chatId, "⌛ Ese enlace ya venció. Vuelve al Termómetro y toca <b>Conectar Telegram</b> otra vez.", { reply_markup: OPEN_APP_BUTTON });
    return;
  }
  // A Telegram chat can only belong to one app account.
  await db.update(telegramLinksTable).set({ chatId: null }).where(eq(telegramLinksTable.chatId, chatId));
  await db
    .update(telegramLinksTable)
    .set({
      chatId,
      telegramUsername: from?.username ?? null,
      firstName: from?.first_name ?? null,
      linkCode: null,
      linkCodeExpiresAt: null,
      enabled: true,
      mutedUntil: null,
      linkedAt: new Date(),
    })
    .where(eq(telegramLinksTable.userId, pending.userId));
  // Start fresh: the next check records current signals without sending old changes.
  await db.update(watchlistItemsTable).set({ lastSignal: SEEDED, pendingSignal: null, pendingCount: 0 }).where(eq(watchlistItemsTable.userId, pending.userId));
  const items = await db.select({ ticker: watchlistItemsTable.ticker }).from(watchlistItemsTable).where(eq(watchlistItemsTable.userId, pending.userId));
  const watching = items.length
    ? `Estoy vigilando ${items.length} ${items.length === 1 ? "activo" : "activos"} de tu watchlist: ${items.map((i) => i.ticker).join(", ")}.`
    : "Tu watchlist está vacía. Añade activos en el Termómetro (por ejemplo desde <b>Recomendadas</b>) y te avisaré cuando cambie su señal.";
  await sendText(chatId, [
    `✅ <b>¡Listo${from?.first_name ? `, ${escapeHtml(from.first_name)}` : ""}!</b> Tu cuenta quedó conectada.`,
    "",
    watching,
    "",
    "Reviso el mercado cada 15 minutos mientras Wall Street está abierto. Escribe /radar cuando quieras ver cómo van.",
  ].join("\n"), { reply_markup: OPEN_APP_BUTTON });
}

async function handleRadar(chatId: string): Promise<void> {
  const link = await linkedUser(chatId);
  if (!link) {
    await sendText(chatId, "Aún no conectas tu cuenta. Entra al Termómetro → <b>Alertas</b> → <b>Conectar Telegram</b>.", { reply_markup: OPEN_APP_BUTTON });
    return;
  }
  const items = await db.select({ ticker: watchlistItemsTable.ticker }).from(watchlistItemsTable).where(eq(watchlistItemsTable.userId, link.userId));
  if (!items.length) {
    await sendText(chatId, "Tu watchlist está vacía. Añade activos en el Termómetro y te cuento cómo van.", { reply_markup: OPEN_APP_BUTTON });
    return;
  }
  const radar = await getRadarForTickers(items.map((i) => i.ticker));
  const order: Record<string, number> = { Interesante: 0, "A considerar": 1, "Descartado de momento": 2 };
  const lines = radar.assets
    .slice()
    .sort((a, b) => (order[a.signal] ?? 3) - (order[b.signal] ?? 3) || (b.level ?? 0) - (a.level ?? 0))
    .map((a) => `${SIGNAL_EMOJI[a.signal] ?? "⚪"} <b>${escapeHtml(a.ticker)}</b> · ${a.level ?? "–"}/100 · ${escapeHtml(a.signal)}`);
  const muted = link.mutedUntil && link.mutedUntil > new Date() ? "\n\n🔕 Avisos silenciados hasta mañana. /activar para reanudar." : "";
  await sendText(chatId, `🌡️ <b>Tu radar ahora</b>\n\n${lines.join("\n")}${muted}`, { reply_markup: OPEN_APP_BUTTON });
}

async function mute(chatId: string): Promise<string> {
  const link = await linkedUser(chatId);
  if (!link) return "Aún no conectas tu cuenta.";
  await db.update(telegramLinksTable).set({ mutedUntil: endOfTodayCaracas() }).where(eq(telegramLinksTable.userId, link.userId));
  return "🔕 Listo, sin avisos hasta mañana. Descansa 🌙";
}

router.post("/telegram/webhook", async (req: Request, res: Response): Promise<void> => {
  const secret = webhookSecret();
  if (!secret || req.get("x-telegram-bot-api-secret-token") !== secret) {
    res.status(401).json({ ok: false });
    return;
  }
  const update = (req.body ?? {}) as TgUpdate;
  try {
    await ensureTelegramSchema();
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = String(query.message?.chat.id ?? query.from.id);
      const text = query.data === "mute:today" ? await mute(chatId) : "👍";
      await tg("answerCallbackQuery", { callback_query_id: query.id, text });
    } else if (update.message?.text && update.message.chat.type === "private") {
      const chatId = String(update.message.chat.id);
      const [command, arg] = update.message.text.trim().split(/\s+/, 2);
      const name = command.toLowerCase().replace(/@\w+$/, "");
      if (name === "/start") await handleStart(chatId, update.message.from, arg);
      else if (name === "/radar" || name === "/estado") await handleRadar(chatId);
      else if (name === "/prueba" || name === "/resumen") {
        const link = await linkedUser(chatId);
        if (!link) await sendText(chatId, "Aún no conectas tu cuenta. Entra al Termómetro → <b>Alertas</b> → <b>Conectar Telegram</b>.", { reply_markup: OPEN_APP_BUTTON });
        else if (name === "/prueba") await sendTestAlert(link.userId, chatId);
        else await sendDailyDigest(link.userId, chatId, new Date(), false);
      }
      else if (name === "/silenciar") await sendText(chatId, await mute(chatId));
      else if (name === "/activar") {
        const link = await linkedUser(chatId);
        if (link) await db.update(telegramLinksTable).set({ mutedUntil: null, enabled: true }).where(eq(telegramLinksTable.userId, link.userId));
        await sendText(chatId, link ? "🔔 ¡Avisos activados de nuevo!" : "Aún no conectas tu cuenta.", link ? {} : { reply_markup: OPEN_APP_BUTTON });
      } else if (name === "/desconectar") {
        const link = await linkedUser(chatId);
        if (link) await db.delete(telegramLinksTable).where(eq(telegramLinksTable.userId, link.userId));
        await sendText(chatId, "👋 Listo, ya no te enviaré alertas. Puedes volver a conectarte desde el Termómetro cuando quieras.", { reply_markup: OPEN_APP_BUTTON });
      } else await sendText(chatId, HELP, { reply_markup: OPEN_APP_BUTTON });
    }
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "Telegram webhook update failed");
  }
  // Always 200 so Telegram does not retry the same update forever.
  res.json({ ok: true });
});

export default router;
