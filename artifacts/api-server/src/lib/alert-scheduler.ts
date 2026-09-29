import { randomUUID } from "crypto";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { alertDeliveriesTable, alertPreferencesTable, appStateTable, db, telegramLinksTable, watchlistItemsTable } from "@workspace/db";
import { logger } from "./logger";
import { getRadarForTickers, type RadarAsset } from "./market-data";
import { ensureTelegramSchema, sendAlert, sendDigest, telegramToken, type DigestChange } from "./telegram";

// Anti-noise rules (agreed with Jesús, Sept 2026):
// 1. Instant message only when an asset ENTERS "Interesante".
// 2. A new signal must hold on 2 consecutive checks (~30 min) to count.
// 3. Hysteresis: leaving Interesante needs RSI > 42 (or < 28); leaving Descartado needs RSI < 62.
// 4. Max 1 instant message per asset per day.
// 5. Everything else goes to one daily digest after the close (16:15 New York).
// 6. Max 3 instant messages per user per day; the rest go to the digest.
const CONFIRMATIONS_NEEDED = 2;
const MAX_INSTANT_PER_USER_PER_DAY = 3;
const INTERVAL_MS = 5 * 60 * 1000;
const MIN_GAP_BETWEEN_RUNS_MS = 4 * 60 * 1000;
const DIGEST_AFTER_MINUTES = 16 * 60 + 15; // 16:15 New York

export const INTERESANTE = "Interesante";
export const DESCARTADO = "Descartado de momento";

// ---------- New York market clock ----------

export function nyClock(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
    weekend: parts.weekday === "Sat" || parts.weekday === "Sun",
  };
}

// Start of the current New York day as a UTC instant (DST-safe enough for daily grouping).
function nyDayStart(now = new Date()): Date {
  const clock = nyClock(now);
  return new Date(now.getTime() - clock.minutes * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
}

export function marketWindowOpen(now = new Date()): boolean {
  const clock = nyClock(now);
  // From 9:15 to 16:45 New York: covers the session plus the digest slot.
  return !clock.weekend && clock.minutes >= 9 * 60 + 15 && clock.minutes <= 16 * 60 + 45;
}

// ---------- Signal smoothing ----------

// Applies the hysteresis buffer: keeps the confirmed signal while the asset is still near the edge.
export function smoothedSignal(confirmed: string | null, asset: Pick<RadarAsset, "signal" | "rsi" | "pointsSma">): string {
  const raw = asset.signal;
  const rsi = asset.rsi;
  if (rsi === null || !confirmed || raw === confirmed) return raw;
  if (confirmed === INTERESANTE && raw !== DESCARTADO && (asset.pointsSma ?? 0) >= 30 && rsi >= 28 && rsi <= 42) return INTERESANTE;
  if (confirmed === DESCARTADO && rsi >= 62) return DESCARTADO;
  return raw;
}

// ---------- Cron throttle ----------

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

// ---------- Main evaluation ----------

export type AlertRunSummary = {
  users: number;
  tickers: number;
  confirmed: number;
  pending: number;
  instant: number;
  toDigest: number;
  digests: number;
  seeded: number;
  failed: number;
  skipped?: string;
};

export async function evaluateAlerts(now = new Date()): Promise<AlertRunSummary> {
  const summary: AlertRunSummary = { users: 0, tickers: 0, confirmed: 0, pending: 0, instant: 0, toDigest: 0, digests: 0, seeded: 0, failed: 0 };
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
  const userIds = [...new Set(rows.map((row) => row.item.userId))];
  summary.users = userIds.length;
  summary.tickers = tickers.length;

  const clock = nyClock(now);
  const dayStart = nyDayStart(now);

  const radar = await getRadarForTickers(tickers);
  if (radar.stale) {
    logger.warn({ errors: radar.errors }, "Skipping alerts because market radar is stale");
    return { ...summary, skipped: "radar_stale" };
  }
  const assetByTicker = new Map(radar.assets.map((asset) => [asset.ticker, asset]));

  // Instant messages already sent today, per user (for the daily cap).
  const sentToday = await db
    .select({ userId: alertDeliveriesTable.userId, count: sql<number>`count(*)::int` })
    .from(alertDeliveriesTable)
    .where(and(inArray(alertDeliveriesTable.userId, userIds), eq(alertDeliveriesTable.status, "accepted"), gte(alertDeliveriesTable.createdAt, dayStart)))
    .groupBy(alertDeliveriesTable.userId);
  const instantCount = new Map(sentToday.map((row) => [row.userId, Number(row.count)]));

  for (const { item, link, preference } of rows) {
    const asset = assetByTicker.get(item.ticker);
    if (!asset) continue;
    const confirmed = item.lastSignal && item.lastSignal !== "Sin cálculo JB" ? item.lastSignal : null;

    // First time we see this asset (or no JB level yet): remember the signal quietly.
    if (asset.level === null || !confirmed) {
      await db.update(watchlistItemsTable).set({ lastSignal: asset.signal, pendingSignal: null, pendingCount: 0 }).where(eq(watchlistItemsTable.id, item.id));
      summary.seeded += 1;
      continue;
    }

    const candidate = smoothedSignal(confirmed, asset);
    if (candidate === confirmed) {
      if (item.pendingSignal) await db.update(watchlistItemsTable).set({ pendingSignal: null, pendingCount: 0 }).where(eq(watchlistItemsTable.id, item.id));
      continue;
    }

    // Needs to repeat on consecutive checks before it counts.
    const count = item.pendingSignal === candidate ? item.pendingCount + 1 : 1;
    if (count < CONFIRMATIONS_NEEDED) {
      await db.update(watchlistItemsTable).set({ pendingSignal: candidate, pendingCount: count }).where(eq(watchlistItemsTable.id, item.id));
      summary.pending += 1;
      continue;
    }

    // Confirmed change.
    summary.confirmed += 1;
    const muted = link.mutedUntil !== null && link.mutedUntil > now;
    const instantWanted = preference?.opportunityAlerts ?? true;
    const alreadyToday = item.lastInstantAlertAt !== null && item.lastInstantAlertAt >= dayStart;
    const userCount = instantCount.get(item.userId) ?? 0;
    const sendNow =
      candidate === INTERESANTE && instantWanted && !muted && !alreadyToday && userCount < MAX_INSTANT_PER_USER_PER_DAY;

    const deliveryId = randomUUID();
    const inserted = await db
      .insert(alertDeliveriesTable)
      .values({
        id: deliveryId,
        userId: item.userId,
        ticker: item.ticker,
        signal: candidate,
        level: asset.level,
        status: sendNow ? "sending" : "digest_pending",
        dedupeKey: `${item.userId}:${item.ticker}:${confirmed}:${candidate}:${clock.date}:${now.getTime()}`,
        providerMessageId: confirmed, // prior signal, shown in the digest
      })
      .onConflictDoNothing()
      .returning({ id: alertDeliveriesTable.id });

    let instantSent = false;
    if (inserted.length && sendNow) {
      try {
        const messageId = await sendAlert(link.chatId!, {
          ticker: asset.ticker,
          name: asset.name,
          signal: candidate,
          priorSignal: confirmed,
          level: asset.level,
          price: asset.price,
          change: asset.change,
        });
        instantSent = true;
        instantCount.set(item.userId, userCount + 1);
        summary.instant += 1;
        await db.update(alertDeliveriesTable).set({ status: "accepted", providerMessageId: messageId }).where(eq(alertDeliveriesTable.id, deliveryId));
      } catch (error) {
        summary.failed += 1;
        const reason = error instanceof Error ? error.message : "unknown";
        logger.warn({ ticker: item.ticker, err: reason }, "Telegram alert was not sent");
        await db.update(alertDeliveriesTable).set({ status: "digest_pending" }).where(eq(alertDeliveriesTable.id, deliveryId));
        if (/blocked|chat not found|deactivated/i.test(reason)) {
          await db.update(telegramLinksTable).set({ chatId: null }).where(eq(telegramLinksTable.userId, item.userId));
        }
      }
    } else if (inserted.length) {
      summary.toDigest += 1;
    }

    await db
      .update(watchlistItemsTable)
      .set({ lastSignal: candidate, pendingSignal: null, pendingCount: 0, ...(instantSent ? { lastInstantAlertAt: now } : {}) })
      .where(eq(watchlistItemsTable.id, item.id));
  }

  // Daily digest after the close.
  if (clock.minutes >= DIGEST_AFTER_MINUTES) {
    const links = new Map(rows.map((row) => [row.item.userId, row]));
    for (const { link, preference } of links.values()) {
      if (link.lastDigestDate === clock.date) continue;
      const wantsDigest = preference?.signalChanges ?? true;
      const muted = link.mutedUntil !== null && link.mutedUntil > now;
      await db.update(telegramLinksTable).set({ lastDigestDate: clock.date }).where(eq(telegramLinksTable.userId, link.userId));
      if (!wantsDigest || muted) continue;
      const sent = await sendDailyDigest(link.userId, link.chatId!, now, true).catch((error) => {
        logger.warn({ err: error instanceof Error ? error.message : "unknown" }, "Digest failed");
        return false;
      });
      if (sent) summary.digests += 1;
    }
  }
  return summary;
}

// Collects today's confirmed changes for one user. With `final`, marks them as sent.
export async function sendDailyDigest(userId: string, chatId: string, now = new Date(), final = false): Promise<boolean> {
  const rows = await db
    .select()
    .from(alertDeliveriesTable)
    .where(and(eq(alertDeliveriesTable.userId, userId), gte(alertDeliveriesTable.createdAt, nyDayStart(now)), inArray(alertDeliveriesTable.status, ["accepted", "digest_pending"])));
  const pending = rows.filter((row) => row.status === "digest_pending");
  if (final && !pending.length) return false;
  const changes: DigestChange[] = rows.map((row) => ({
    ticker: row.ticker,
    signal: row.signal,
    priorSignal: row.status === "accepted" ? null : row.providerMessageId,
    level: row.level,
    alreadyNotified: row.status === "accepted",
  }));
  await sendDigest(chatId, changes, { final });
  if (final && pending.length) {
    await db.update(alertDeliveriesTable).set({ status: "digest_sent" }).where(inArray(alertDeliveriesTable.id, pending.map((row) => row.id)));
  }
  return true;
}

// Only used by the long-running server (local/dev). On Vercel the cron endpoint drives it.
export function startAlertScheduler(): void {
  const run = () => evaluateAlerts().catch((error) => logger.error({ err: error }, "Alert evaluation failed"));
  run();
  setInterval(run, INTERVAL_MS).unref();
  logger.info({ intervalMinutes: INTERVAL_MS / 60000 }, "Alert scheduler started");
}
