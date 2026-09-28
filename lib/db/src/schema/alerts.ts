import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alertPreferencesTable = pgTable(
  "alert_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    phoneE164: text("phone_e164"),
    consent: boolean("consent").notNull().default(false),
    enabled: boolean("enabled").notNull().default(false),
    signalChanges: boolean("signal_changes").notNull().default(true),
    opportunityAlerts: boolean("opportunity_alerts").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("alert_preferences_user_unique").on(table.userId)],
);

export const alertDeliveriesTable = pgTable(
  "alert_deliveries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    ticker: text("ticker").notNull(),
    signal: text("signal").notNull(),
    level: integer("level").notNull(),
    status: text("status").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    providerMessageId: text("provider_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_delivery_dedupe_unique").on(table.dedupeKey),
    index("alert_deliveries_user_idx").on(table.userId, table.createdAt),
  ],
);

export const insertAlertPreferenceSchema = createInsertSchema(alertPreferencesTable).omit({
  id: true,
  updatedAt: true,
});
export const insertAlertDeliverySchema = createInsertSchema(alertDeliveriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAlertPreference = z.infer<typeof insertAlertPreferenceSchema>;
export type AlertPreference = typeof alertPreferencesTable.$inferSelect;
export type AlertDelivery = typeof alertDeliveriesTable.$inferSelect;