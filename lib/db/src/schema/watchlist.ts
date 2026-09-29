import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const watchlistItemsTable = pgTable(
  "watchlist_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    ticker: text("ticker").notNull(),
    lastSignal: text("last_signal"),
    // Anti-noise alerts: a new signal must repeat on 2 checks before it counts.
    pendingSignal: text("pending_signal"),
    pendingCount: integer("pending_count").notNull().default(0),
    lastInstantAlertAt: timestamp("last_instant_alert_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("watchlist_user_ticker_unique").on(table.userId, table.ticker),
    index("watchlist_user_idx").on(table.userId),
  ],
);

export const insertWatchlistItemSchema = createInsertSchema(watchlistItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;
export type WatchlistItem = typeof watchlistItemsTable.$inferSelect;