import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// TEMPORARY (remove after use): returns the brand fonts as base64 for offline rendering.
const FONT_URLS: Record<string, string> = {
  "Manrope.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/Manrope%5Bwght%5D.ttf",
  "SpaceGrotesk.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf",
  "DMMono-Regular.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/dmmono/DMMono-Regular.ttf",
  "DMMono-Medium.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/dmmono/DMMono-Medium.ttf",
};
router.get("/dev/brand-fonts", async (_req, res) => {
  const out: Record<string, string> = {};
  for (const [name, url] of Object.entries(FONT_URLS)) {
    const response = await fetch(url);
    out[name] = response.ok ? Buffer.from(await response.arrayBuffer()).toString("base64") : "";
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(out);
});

export default router;
