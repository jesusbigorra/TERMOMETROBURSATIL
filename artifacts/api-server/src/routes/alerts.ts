import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { GetAlertDeliveriesResponse, GetAlertPreferencesResponse, UpdateAlertPreferencesBody, UpdateAlertPreferencesResponse } from "@workspace/api-zod";
import { alertDeliveriesTable, alertPreferencesTable, db } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);
const EMPTY = { phoneE164: null, consent: false, enabled: false, signalChanges: true, opportunityAlerts: true };

function phoneIsValid(value: string | null): boolean {
  return value === null || /^\+[1-9]\d{7,14}$/.test(value);
}

router.get("/alerts/preferences", async (req: AuthenticatedRequest, res): Promise<void> => {
  const [preferences] = await db.select().from(alertPreferencesTable).where(eq(alertPreferencesTable.userId, req.userId!));
  const payload = preferences
    ? { phoneE164: preferences.phoneE164, consent: preferences.consent, enabled: preferences.enabled, signalChanges: preferences.signalChanges, opportunityAlerts: preferences.opportunityAlerts, updatedAt: preferences.updatedAt.toISOString() }
    : { ...EMPTY, updatedAt: new Date(0).toISOString() };
  res.json(GetAlertPreferencesResponse.parse(payload));
});

router.put("/alerts/preferences", async (req: AuthenticatedRequest, res): Promise<void> => {
  const parsed = UpdateAlertPreferencesBody.safeParse(req.body);
  if (!parsed.success || !phoneIsValid(parsed.success ? parsed.data.phoneE164 : null)) {
    res.status(400).json({ error: "Usa un número internacional, por ejemplo +34600111222." });
    return;
  }
  const data = parsed.data;
  if (data.enabled && (!data.phoneE164 || !data.consent)) {
    res.status(400).json({ error: "Para activar alertas, añade un número y acepta recibir mensajes." });
    return;
  }
  const [existing] = await db.select().from(alertPreferencesTable).where(eq(alertPreferencesTable.userId, req.userId!));
  const [saved] = existing
    ? await db.update(alertPreferencesTable).set(data).where(eq(alertPreferencesTable.userId, req.userId!)).returning()
    : await db.insert(alertPreferencesTable).values({ id: randomUUID(), userId: req.userId!, ...data }).returning();
  res.json(UpdateAlertPreferencesResponse.parse({ phoneE164: saved.phoneE164, consent: saved.consent, enabled: saved.enabled, signalChanges: saved.signalChanges, opportunityAlerts: saved.opportunityAlerts, updatedAt: saved.updatedAt.toISOString() }));
});

router.get("/alerts/deliveries", async (req: AuthenticatedRequest, res): Promise<void> => {
  const rows = await db.select().from(alertDeliveriesTable).where(eq(alertDeliveriesTable.userId, req.userId!)).orderBy(desc(alertDeliveriesTable.createdAt)).limit(12);
  res.json(GetAlertDeliveriesResponse.parse(rows.map((row) => ({ id: row.id, ticker: row.ticker, signal: row.signal, level: row.level, status: row.status, createdAt: row.createdAt.toISOString() }))));
});

export default router;