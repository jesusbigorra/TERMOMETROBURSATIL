import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export type AuthenticatedRequest = Request & { userId?: string };

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const claimUserId = auth.sessionClaims?.userId;
  const userId = typeof claimUserId === "string" ? claimUserId : auth.userId;
  if (!userId) {
    res.status(401).json({ error: "Inicia sesión para acceder a tus datos personales." });
    return;
  }
  req.userId = userId;
  next();
}