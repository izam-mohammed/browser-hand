// Bundles the extension into dist/, the folder to load unpacked.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

const common = { outdir: "dist", entryNames: "[name]", bundle: true, target: "chrome120", logLevel: "info" };

// The service worker and the claim page load as modules.
await build({ ...common, entryPoints: ["src/background.ts", "src/claim.ts"], format: "esm" });

// Content scripts run as classic scripts, so no top-level import or export.
await build({ ...common, entryPoints: ["src/page/content.ts", "src/page/main-world.ts"], format: "iife" });

for (const file of ["manifest.json", "claim.html"]) cpSync(file, `dist/${file}`);
