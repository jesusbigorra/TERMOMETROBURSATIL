import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { GetAlertDeliveriesResponse, GetAlertPreferencesResponse, SendTestAlertBody, SendTestAlertResponse, UpdateAlertPreferencesBody, UpdateAlertPreferencesResponse } from "@workspace/api-zod";
import { alertDeliveriesTable, alertPreferencesTable, db, watchlistItemsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { sendTemplate } from "../lib/alert-scheduler";

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

router.post("/alerts/test", async (req: AuthenticatedRequest, res): Promise<void> => {
  const parsed = SendTestAlertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Solicitud de prueba no válida." });
    return;
  }
  const [preference] = await db.select().from(alertPreferencesTable).where(eq(alertPreferencesTable.userId, req.userId!));
  if (!preference?.phoneE164 || !preference.consent || !preference.enabled) {
    res.status(400).json({ error: "Guarda un número, acepta el consentimiento y activa las alertas antes de enviar una prueba." });
    return;
  }
  const [watchItem] = await db.select({ ticker: watchlistItemsTable.ticker }).from(watchlistItemsTable).where(eq(watchlistItemsTable.userId, req.userId!)).limit(1);
  const ticker = watchItem?.ticker ?? "JEPQ";
  const signal = "Interesante";
  const level = 82;
  const preview = [
    "JB Termómetro Bursátil",
    "Alerta de prueba",
    `Activo: ${ticker}`,
    `Nueva señal: ${signal}`,
    `Nivel JB: ${level}/100`,
  ].join("\n");
  let status = "accepted";
  let providerMessageId: string | null = null;
  let message = "Prueba enviada a tu WhatsApp.";
  try {
    providerMessageId = await sendTemplate(preference.phoneE164, ticker, signal, level);
  } catch (error) {
    status = error instanceof Error && error.message === "CONFIGURATION_MISSING" ? "waiting_for_whatsapp_configuration" : "failed";
    message = status === "waiting_for_whatsapp_configuration"
      ? "La prueba quedó pendiente: falta configurar el número empresarial o la plantilla aprobada de WhatsApp."
      : "WhatsApp no aceptó la prueba. Revisa la configuración de WhatsApp Business.";
  }
  await db.insert(alertDeliveriesTable).values({
    id: randomUUID(),
    userId: req.userId!,
    ticker,
    signal,
    level,
    status: `test_${status}`,
    dedupeKey: `test:${req.userId}:${randomUUID()}`,
    providerMessageId,
  });
  res.json(SendTestAlertResponse.parse({ ticker, signal, level, status, message, preview }));
});

export default router;