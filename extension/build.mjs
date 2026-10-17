// Bundles the extension into dist/, the folder to load unpacked.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

await build({
  entryPoints: ["src/background.ts", "src/claim.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome120",
  logLevel: "info",
});

for (const file of ["manifest.json", "claim.html"]) cpSync(file, `dist/${file}`);
