import { clerkClient, getAuth } from "@clerk/express";
import { desc, gte, inArray, sql } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { alertDeliveriesTable, db, telegramLinksTable, watchlistItemsTable } from "@workspace/db";
import { ensureTelegramSchema } from "../lib/telegram";

// Owner-only dashboard for the termómetro: who signed up and what they do.
// ADMIN_EMAILS (comma-separated) overrides the default owner email.
const router: IRouter = Router();
const DAY_MS = 24 * 3600 * 1000;

function adminEmails(): Set<string> {
  return new Set((process.env.ADMIN_EMAILS ?? "jesus201@gmail.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Inicia sesión." });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(auth.userId);
    const emails = user.emailAddresses.filter((a) => a.verification?.status === "verified").map((a) => a.emailAddress.toLowerCase());
    const allowed = adminEmails();
    if (emails.some((email) => allowed.has(email))) {
      next();
      return;
    }
  } catch {
    res.status(503).json({ error: "No se pudo verificar tu acceso." });
    return;
  }
  res.status(403).json({ error: "Esta sección es solo para el administrador." });
}

function dayKey(ms: number): string {
  // Group by Caracas calendar day (UTC-4, no DST).
  return new Date(ms - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

function lastDays(n: number): string[] {
  const today = Date.now();
  return Array.from({ length: n }, (_, i) => dayKey(today - (n - 1 - i) * DAY_MS));
}

router.get("/admin/overview", requireAdmin, async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  await ensureTelegramSchema();

  // Clerk: up to 500 most recent users (plenty for now; the total comes from getCount).
  const page = await clerkClient.users.getUserList({ limit: 500, orderBy: "-created_at" });
  const clerkUsers = page.data;
  const totalUsers = page.totalCount ?? clerkUsers.length;
  const inventoryEmails = new Set((process.env.INVENTORY_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));

  const ids = clerkUsers.map((u) => u.id);
  const since30 = new Date(Date.now() - 30 * DAY_MS);
  const [watchCounts, links, topTickers, alertRows, totals] = await Promise.all([
    ids.length
      ? db.select({ userId: watchlistItemsTable.userId, count: sql<number>`count(*)::int` }).from(watchlistItemsTable).where(inArray(watchlistItemsTable.userId, ids)).groupBy(watchlistItemsTable.userId)
      : Promise.resolve([]),
    db.select({ userId: telegramLinksTable.userId, chatId: telegramLinksTable.chatId, linkedAt: telegramLinksTable.linkedAt }).from(telegramLinksTable),
    db.select({ ticker: watchlistItemsTable.ticker, count: sql<number>`count(*)::int` }).from(watchlistItemsTable).groupBy(watchlistItemsTable.ticker).orderBy(desc(sql`count(*)`)).limit(15),
    db
      .select({ day: sql<string>`to_char(${alertDeliveriesTable.createdAt} AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD')`, status: alertDeliveriesTable.status, count: sql<number>`count(*)::int` })
      .from(alertDeliveriesTable)
      .where(gte(alertDeliveriesTable.createdAt, since30))
      .groupBy(sql`1`, alertDeliveriesTable.status),
    db.select({ items: sql<number>`count(*)::int`, users: sql<number>`count(distinct ${watchlistItemsTable.userId})::int` }).from(watchlistItemsTable),
  ]);

  const watchByUser = new Map(watchCounts.map((row) => [row.userId, Number(row.count)]));
  const linkByUser = new Map(links.filter((l) => l.chatId).map((l) => [l.userId, l.linkedAt]));

  const users = clerkUsers.map((u) => {
    const email = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null;
    const google = u.externalAccounts.some((a) => a.provider.includes("google"));
    return {
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
      email,
      method: google ? "Google" : "Correo",
      createdAt: new Date(u.createdAt).toISOString(),
      lastSignInAt: u.lastSignInAt ? new Date(u.lastSignInAt).toISOString() : null,
      lastActiveAt: (u as { lastActiveAt?: number | null }).lastActiveAt ? new Date((u as { lastActiveAt: number }).lastActiveAt).toISOString() : null,
      watchlist: watchByUser.get(u.id) ?? 0,
      telegram: linkByUser.has(u.id),
      cashRegister: email ? inventoryEmails.has(email.toLowerCase()) : false,
    };
  });

  const days = lastDays(30);
  const signupsByDay = new Map(days.map((d) => [d, 0]));
  for (const u of clerkUsers) {
    const key = dayKey(u.createdAt);
    if (signupsByDay.has(key)) signupsByDay.set(key, (signupsByDay.get(key) ?? 0) + 1);
  }
  const alertsByDay = new Map(days.map((d) => [d, { instant: 0, digest: 0 }]));
  for (const row of alertRows) {
    const bucket = alertsByDay.get(row.day);
    if (!bucket) continue;
    if (row.status === "accepted") bucket.instant += Number(row.count);
    else if (row.status === "digest_sent" || row.status === "digest_pending") bucket.digest += Number(row.count);
  }

  const now = Date.now();
  const activeWithin = (ms: number) => users.filter((u) => {
    const last = u.lastActiveAt ?? u.lastSignInAt;
    return last !== null && now - Date.parse(last) <= ms;
  }).length;

  res.json({
    generatedAt: new Date().toISOString(),
    totals: {
      users: totalUsers,
      new7d: users.filter((u) => now - Date.parse(u.createdAt) <= 7 * DAY_MS).length,
      active7d: activeWithin(7 * DAY_MS),
      active30d: activeWithin(30 * DAY_MS),
      withWatchlist: Number(totals[0]?.users ?? 0),
      watchlistItems: Number(totals[0]?.items ?? 0),
      telegram: linkByUser.size,
    },
    signups: days.map((day) => ({ day, count: signupsByDay.get(day) ?? 0 })),
    alerts: days.map((day) => ({ day, ...(alertsByDay.get(day) ?? { instant: 0, digest: 0 }) })),
    topTickers: topTickers.map((row) => ({ ticker: row.ticker, count: Number(row.count) })),
    users,
    truncated: totalUsers > clerkUsers.length,
  });
});

export default router;
