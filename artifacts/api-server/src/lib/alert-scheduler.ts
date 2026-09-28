import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { alertDeliveriesTable, alertPreferencesTable, db, watchlistItemsTable } from "@workspace/db";
import { logger } from "./logger";
import { getMarketRadar } from "./market-data";

const INTERVAL_MS = 5 * 60 * 1000;

function fiveMinuteBucket(date: Date): string {
  return `${date.toISOString().slice(0, 13)}:${Math.floor(date.getUTCMinutes() / 5)}`;
}

export async function sendTemplate(phone: string, ticker: string, signal: string, level: number): Promise<string> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!phoneNumberId || !templateName) throw new Error("CONFIGURATION_MISSING");

  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("whatsapp-business", `/v23.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone.replace(/^\+/, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "es_ES" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: ticker },
            { type: "text", text: signal },
            { type: "text", text: String(level) },
          ],
        }],
      },
    }),
  });
  const body = (await response.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `WhatsApp respondió ${response.status}`);
  return body.messages?.[0]?.id ?? "";
}

export async function evaluateWhatsAppAlerts(): Promise<void> {
  const rows = await db
    .select({ item: watchlistItemsTable, preference: alertPreferencesTable })
    .from(watchlistItemsTable)
    .innerJoin(alertPreferencesTable, eq(watchlistItemsTable.userId, alertPreferencesTable.userId))
    .where(and(eq(alertPreferencesTable.enabled, true), eq(alertPreferencesTable.consent, true)));
  if (!rows.length) return;

  const radar = await getMarketRadar();
  if (radar.stale) {
    logger.warn({ errors: radar.errors }, "Skipping WhatsApp alerts because market radar is stale");
    return;
  }
  const assetByTicker = new Map(radar.assets.map((asset) => [asset.ticker, asset]));
  const now = new Date();
  for (const { item, preference } of rows) {
    const asset = assetByTicker.get(item.ticker);
    if (!asset) continue;
    if (asset.level === null) {
      await db.update(watchlistItemsTable).set({ lastSignal: asset.signal }).where(eq(watchlistItemsTable.id, item.id));
      continue;
    }
    if (!item.lastSignal || item.lastSignal === "Sin cálculo JB") {
      await db.update(watchlistItemsTable).set({ lastSignal: asset.signal }).where(eq(watchlistItemsTable.id, item.id));
      continue;
    }
    if (item.lastSignal === asset.signal) continue;
    const shouldAlert = preference.signalChanges || (preference.opportunityAlerts && asset.signal === "Interesante");
    const priorSignal = item.lastSignal;
    if (!shouldAlert) {
      await db.update(watchlistItemsTable).set({ lastSignal: asset.signal }).where(eq(watchlistItemsTable.id, item.id));
      continue;
    }

    const dedupeKey = `${item.userId}:${item.ticker}:${priorSignal}:${asset.signal}:${fiveMinuteBucket(now)}`;
    let status = "queued";
    let providerMessageId: string | null = null;
    try {
      providerMessageId = await sendTemplate(preference.phoneE164!, asset.ticker, asset.signal, asset.level);
      status = "accepted";
    } catch (error) {
      status = error instanceof Error && error.message === "CONFIGURATION_MISSING" ? "waiting_for_whatsapp_configuration" : "failed";
      logger.warn({ ticker: item.ticker, status, err: error instanceof Error ? error.message : "unknown" }, "WhatsApp alert was not sent");
    }
    try {
      await db.insert(alertDeliveriesTable).values({
        id: randomUUID(),
        userId: item.userId,
        ticker: item.ticker,
        signal: asset.signal,
        level: asset.level,
        status,
        dedupeKey,
        providerMessageId,
      });
      await db.update(watchlistItemsTable).set({ lastSignal: asset.signal }).where(eq(watchlistItemsTable.id, item.id));
    } catch (error) {
      logger.warn({ ticker: item.ticker, err: error instanceof Error ? error.message : "unknown" }, "Duplicate alert evaluation skipped");
    }
  }
}

export function startAlertScheduler(): void {
  const run = () => evaluateWhatsAppAlerts().catch((error) => logger.error({ err: error }, "Alert evaluation failed"));
  run();
  setInterval(run, INTERVAL_MS).unref();
  logger.info({ intervalMinutes: INTERVAL_MS / 60000 }, "WhatsApp alert scheduler started");
}