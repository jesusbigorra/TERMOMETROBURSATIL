import app from "./app";
import { ensureTelegramSchema } from "./lib/telegram";
import { logger } from "./lib/logger";

// Runtime DDL (new watchlist/telegram columns) must exist before any route selects them.
await ensureTelegramSchema().catch((error) => logger.error({ err: error }, "Schema check failed"));

export default app;
