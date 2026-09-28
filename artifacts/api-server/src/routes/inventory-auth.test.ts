import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.ts";

test("la autenticación de compras rechaza antes de alcanzar cualquier acceso a base de datos", () => {
  let status: number | undefined;
  let body: unknown;
  let databaseAccessed = false;
  const auth = Object.assign(() => ({
      userId: null,
      sessionClaims: null,
      sessionId: null,
      tokenType: "session_token",
      orgId: null,
      orgRole: null,
      orgSlug: null,
      orgPermissions: null,
    }), { [Symbol.for("@clerk/express.auth")]: true });
  const req = { auth } as unknown as Request;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as unknown as Response;
  const next = (() => {
    databaseAccessed = true;
  }) as NextFunction;

  requireAuth(req, res, next);

  assert.equal(status, 401);
  assert.deepEqual(body, { error: "Inicia sesión para acceder a tus datos personales." });
  assert.equal(databaseAccessed, false);
});