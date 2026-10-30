import assert from "node:assert/strict";
import test from "node:test";
import { dailyChangePercent } from "./daily-change";

const t = (day: string) => Date.parse(`${day}T15:00:00Z`) / 1000;

test("sesión en curso: compara con el cierre del día anterior, no con el de hace un año", () => {
  const dates = ["2025-10-30", "2026-10-28", "2026-10-29", "2026-10-30"];
  const closes = [100, 120, 121, 122];
  assert.equal(dailyChangePercent(122.21, dates, closes, t("2026-10-30")), 1.0);
});

test("fin de semana: la última barra es la del viernes y se compara con el jueves", () => {
  const dates = ["2026-10-28", "2026-10-29", "2026-10-30"];
  assert.equal(dailyChangePercent(110, dates, [100, 105, 110], t("2026-10-30")), 4.76);
});

test("sin barra de hoy todavía: compara con el último cierre disponible", () => {
  assert.equal(dailyChangePercent(103, ["2026-10-28", "2026-10-29"], [100, 102], t("2026-10-30")), 0.98);
});

test("datos insuficientes devuelven null", () => {
  assert.equal(dailyChangePercent(10, [], [], t("2026-10-30")), null);
  assert.equal(dailyChangePercent(10, ["2026-10-30"], [10], t("2026-10-30")), null);
});
