import { randomUUID } from "crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { alertDeliveriesTable, alertPreferencesTable, appStateTable, db, telegramLinksTable, watchlistItemsTable } from "@workspace/db";
import { logger } from "./logger";
import { getRadarForTickers } from "./market-data";
import { ensureTelegramSchema, sendAlert, telegramToken } from "./telegram";

const INTERVAL_MS = 5 * 60 * 1000;
const MIN_GAP_BETWEEN_RUNS_MS = 4 * 60 * 1000;

function fiveMinuteBucket(date: Date): string {
  return `${date.toISOString().slice(0, 13)}:${Math.floor(date.getUTCMinutes() / 5)}`;
}

// Atomically claims the next run so a public cron URL cannot be spammed.
export async function claimAlertRun(now = new Date()): Promise<boolean> {
  await ensureTelegramSchema();
  const threshold = new Date(now.getTime() - MIN_GAP_BETWEEN_RUNS_MS).toISOString();
  const result = await db.execute(sql`
    INSERT INTO app_state (key, value, updated_at) VALUES ('alerts_last_run', ${now.toISOString()}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE app_state.value < ${threshold}
    RETURNING key`);
  return (result.rows?.length ?? 0) > 0;
}

export async function lastAlertRun(): Promise<string | null> {
  await ensureTelegramSchema();
  const [row] = await db.select().from(appStateTable).where(eq(appStateTable.key, "alerts_last_run"));
  return row?.value ?? null;
}

export type AlertRunSummary = { users: number; tickers: number; sent: number; seeded: number; muted: number; failed: number; skipped?: string };

export async function evaluateAlerts(): Promise<AlertRunSummary> {
  const summary: AlertRunSummary = { users: 0, tickers: 0, sent: 0, seeded: 0, muted: 0, failed: 0 };
  if (!telegramToken()) return { ...summary, skipped: "telegram_not_configured" };
  await ensureTelegramSchema();

  const rows = await db
    .select({ item: watchlistItemsTable, link: telegramLinksTable, preference: alertPreferencesTable })
    .from(watchlistItemsTable)
    .innerJoin(telegramLinksTable, eq(watchlistItemsTable.userId, telegramLinksTable.userId))
    .leftJoin(alertPreferencesTable, eq(watchlistItemsTable.userId, alertPreferencesTable.userId))
    .where(and(isNotNull(telegramLinksTable.chatId), eq(telegramLinksTable.enabled, true)));
  if (!rows.length) return summary;

  const tickers = [...new Set(rows.map((row) => row.item.ticker))];
  summary.users = new Set(rows.map((row) => row.item.userId)).size;
  summary.tickers = tickers.length;

  const radar = await getRadarForTickers(tickers);
  if (radar.stale) {
    logger.warn({ errors: radar.errors }, "Skipping alerts because market radar is stale");
    return { ...summary, skipped: "radar_stale" };
  }
  const assetByTicker = new Map(radar.assets.map((asset) => [asset.ticker, asset]));
  const now = new Date();
  const setLastSignal = (id: string, signal: string) =>
    db.update(watchlistItemsTable).set({ lastSignal: signal }).where(eq(watchlistItemsTable.id, id));

  for (const { item, link, preference } of rows) {
    const asset = assetByTicker.get(item.ticker);
    if (!asset) continue;
    // First time we see this asset (or no JB level yet): remember the signal quietly.
    if (asset.level === null || !item.lastSignal || item.lastSignal === "Sin cálculo JB") {
      if (item.lastSignal !== asset.signal) await setLastSignal(item.id, asset.signal);
      summary.seeded += 1;
      continue;
    }
    if (item.lastSignal === asset.signal) continue;

    const signalChanges = preference?.signalChanges ?? true;
    const opportunityAlerts = preference?.opportunityAlerts ?? true;
    const wanted = signalChanges || (opportunityAlerts && asset.signal === "Interesante");
    const muted = link.mutedUntil !== null && link.mutedUntil > now;
    const priorSignal = item.lastSignal;
    if (!wanted || muted) {
      if (muted) summary.muted += 1;
      await setLastSignal(item.id, asset.signal);
      continue;
    }

    const deliveryId = randomUUID();
    const dedupeKey = `${item.userId}:${item.ticker}:${priorSignal}:${asset.signal}:${fiveMinuteBucket(now)}`;
    const inserted = await db
      .insert(alertDeliveriesTable)
      .values({ id: deliveryId, userId: item.userId, ticker: item.ticker, signal: asset.signal, level: asset.level, status: "sending", dedupeKey })
      .onConflictDoNothing()
      .returning({ id: alertDeliveriesTable.id });
    if (!inserted.length) continue;

    let status = "accepted";
    let providerMessageId: string | null = null;
    try {
      providerMessageId = await sendAlert(link.chatId!, {
        ticker: asset.ticker,
        name: asset.name,
        signal: asset.signal,
        priorSignal,
        level: asset.level,
        price: asset.price,
        change: asset.change,
      });
      summary.sent += 1;
    } catch (error) {
      status = "failed";
      summary.failed += 1;
      const reason = error instanceof Error ? error.message : "unknown";
      logger.warn({ ticker: item.ticker, err: reason }, "Telegram alert was not sent");
      // The user blocked the bot: stop trying until they reconnect.
      if (/blocked|chat not found|deactivated/i.test(reason)) {
        await db.update(telegramLinksTable).set({ chatId: null }).where(eq(telegramLinksTable.userId, item.userId));
      }
    }
    await db.update(alertDeliveriesTable).set({ status, providerMessageId }).where(eq(alertDeliveriesTable.id, deliveryId));
    await setLastSignal(item.id, asset.signal);
  }
  return summary;
}

// Only used by the long-running server (local/dev). On Vercel the cron endpoint drives it.
export function startAlertScheduler(): void {
  const run = () => evaluateAlerts().catch((error) => logger.error({ err: error }, "Alert evaluation failed"));
  run();
  setInterval(run, INTERVAL_MS).unref();
  logger.info({ intervalMinutes: INTERVAL_MS / 60000 }, "Alert scheduler started");
}
