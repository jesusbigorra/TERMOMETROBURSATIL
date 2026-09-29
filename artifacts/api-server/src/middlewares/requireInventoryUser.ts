import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./requireAuth";

// Only the people listed in INVENTORY_ALLOWED_EMAILS (comma-separated) can use
// the inventory and cash register. Anyone else who signs in gets a 403.
const CACHE_MS = 10 * 60 * 1000;
const emailCache = new Map<string, { emails: string[]; at: number }>();

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.INVENTORY_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function emailsFor(clerkUserId: string): Promise<string[]> {
  const cached = emailCache.get(clerkUserId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.emails;
  const user = await clerkClient.users.getUser(clerkUserId);
  const emails = user.emailAddresses
    .filter((address) => address.verification?.status === "verified")
    .map((address) => address.emailAddress.toLowerCase());
  emailCache.set(clerkUserId, { emails, at: Date.now() });
  return emails;
}

export async function requireInventoryUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Inicia sesión para usar la caja." });
    return;
  }
  const claimUserId = auth.sessionClaims?.userId;
  req.userId = typeof claimUserId === "string" ? claimUserId : auth.userId;
  const allowed = allowedEmails();
  try {
    const emails = await emailsFor(auth.userId);
    if (allowed.size > 0 && emails.some((email) => allowed.has(email))) {
      next();
      return;
    }
  } catch (error) {
    req.log?.error({ err: error }, "Could not verify inventory user");
    res.status(503).json({ error: "No se pudo verificar tu acceso. Intenta de nuevo." });
    return;
  }
  res.status(403).json({ error: "Tu cuenta no tiene acceso a esta caja." });
}
