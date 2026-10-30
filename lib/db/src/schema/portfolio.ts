import { doublePrecision, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Posiciones que cada usuario declara a mano en /portafolio. Es independiente
// de watchlist_items: el termómetro y sus alertas no leen esta tabla.
export const portfolioPositionsTable = pgTable(
  "portfolio_positions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    ticker: text("ticker").notNull(),
    units: doublePrecision("units").notNull(),
    // Costo promedio por unidad en USD. Null cuando el usuario no lo indica.
    avgCost: doublePrecision("avg_cost"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("portfolio_user_ticker_unique").on(table.userId, table.ticker),
    index("portfolio_user_idx").on(table.userId),
  ],
);

export type PortfolioPosition = typeof portfolioPositionsTable.$inferSelect;

// DDL idempotente: producción crea la tabla sola, sin drizzle push.
export const PORTFOLIO_DDL = `
CREATE TABLE IF NOT EXISTS portfolio_positions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  ticker text NOT NULL,
  units double precision NOT NULL,
  avg_cost double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_user_ticker_unique ON portfolio_positions (user_id, ticker);
CREATE INDEX IF NOT EXISTS portfolio_user_idx ON portfolio_positions (user_id);
`;
