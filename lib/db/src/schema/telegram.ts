import { boolean, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// One row per app user who started linking Telegram. chat_id is filled when the
// user opens the bot with the one-time code (deep link t.me/<bot>?start=<code>).
export const telegramLinksTable = pgTable(
  "telegram_links",
  {
    userId: text("user_id").primaryKey(),
    chatId: text("chat_id"),
    telegramUsername: text("telegram_username"),
    firstName: text("first_name"),
    linkCode: text("link_code"),
    linkCodeExpiresAt: timestamp("link_code_expires_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(true),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    lastDigestDate: text("last_digest_date"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("telegram_links_code_unique").on(table.linkCode),
    uniqueIndex("telegram_links_chat_unique").on(table.chatId),
  ],
);

// Small key/value table for app-wide state (e.g. last alert run, to throttle the cron).
export const appStateTable = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TelegramLink = typeof telegramLinksTable.$inferSelect;

// Idempotent DDL so production gets the tables without a manual drizzle push.
export const TELEGRAM_DDL = `
CREATE TABLE IF NOT EXISTS telegram_links (
  user_id text PRIMARY KEY,
  chat_id text,
  telegram_username text,
  first_name text,
  link_code text,
  link_code_expires_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  muted_until timestamptz,
  linked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_links_code_unique ON telegram_links (link_code);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_links_chat_unique ON telegram_links (chat_id);
ALTER TABLE telegram_links ADD COLUMN IF NOT EXISTS last_digest_date text;
ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS pending_signal text;
ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS pending_count integer NOT NULL DEFAULT 0;
ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS last_instant_alert_at timestamptz;
CREATE TABLE IF NOT EXISTS app_state (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
