// Build for Vercel using the Build Output API (v3).
// Bundles the Express app into a single Node.js serverless function that
// handles every request. Workspace packages (@workspace/*) export raw
// TypeScript, so everything is bundled with esbuild instead of relying on
// Vercel's per-file transpilation.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(artifactDir, ".vercel/output");
const funcDir = path.resolve(outputDir, "functions/api.func");

await rm(outputDir, { recursive: true, force: true });
await mkdir(funcDir, { recursive: true });
await mkdir(path.resolve(outputDir, "static"), { recursive: true });

await esbuild({
  entryPoints: { index: path.resolve(artifactDir, "src/vercel-entry.ts") },
  platform: "node",
  target: "node22",
  bundle: true,
  format: "esm",
  outdir: funcDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  // Only truly native / optional modules stay external.
  external: [
    "*.node",
    "pg-native",
    "pino-pretty",
    "bufferutil",
    "utf-8-validate",
    "canvas",
    "sharp",
  ],
  sourcemap: "linked",
  plugins: [esbuildPluginPino({ transports: [] })],
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
});

await writeFile(
  path.resolve(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 60,
    },
    null,
    2,
  ),
);

await writeFile(
  path.resolve(outputDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [{ src: "/(.*)", dest: "/api" }],
    },
    null,
    2,
  ),
);

console.log("Vercel build output written to", outputDir);
