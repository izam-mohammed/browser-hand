// Bundles the extension into dist/, the folder to load unpacked.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { themeCss } from "./theme.mjs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

// The settings page's colours and type come from design/theme.md
// (plans/06-settings.md, Decision 8); the file is committed so a stale one
// shows in review, and test/theme.test.ts fails on it.
writeFileSync("src/options/theme.gen.css", themeCss(readFileSync("../design/theme.md", "utf8")));

const common = { outdir: "dist", entryNames: "[name]", bundle: true, target: "chrome120", logLevel: "info" };

// The service worker and the extension's pages load as modules.
await build({ ...common, entryPoints: ["src/background.ts", "src/claim.ts", "src/options/options.ts", "src/popup/popup.ts"], format: "esm" });

// Content scripts run as classic scripts, so no top-level import or export.
await build({ ...common, entryPoints: ["src/page/content.ts", "src/page/main-world.ts"], format: "iife" });

for (const file of ["manifest.json", "claim.html", "options.html", "popup.html"]) cpSync(file, `dist/${file}`);
for (const file of ["theme.gen.css", "options.css"]) cpSync(`src/options/${file}`, `dist/${file}`);
// The toolbar popup shares the settings page's tokens (plans/08-recorder-popup.md).
cpSync("src/popup/popup.css", "dist/popup.css");
cpSync("icons", "dist/icons", { recursive: true });
// Fonts, both OFL: Inter is the one the GIF labels use; JetBrains Mono v2.304.
cpSync("fonts", "dist/fonts", { recursive: true });
cpSync("../host/assets/Inter.ttf", "dist/fonts/Inter.ttf");
cpSync("../host/assets/Inter-OFL.txt", "dist/fonts/Inter-OFL.txt");
