// Proves the audit log in a real Chrome for Testing: one JSON line per call,
// and nothing secret in it (plans/17-hands-free-and-guarded.md, Phase 2).
import fs from "node:fs";
import path from "node:path";
import { check, run } from "./headless.mjs";

const config = (work) => `[audit]\nenabled = true\nfile = "${path.join(work, "audit.jsonl")}"\n`;

await run({ config }, async (h) => {
  const { tabId } = await h.json("tabs_create");
  await h.call("navigate", { url: `${h.web}/delayed?token=SECRET123`, tabId });
  await h.call("computer", { action: "screenshot", tabId });
  await h.call("wait_for", { tabId, text: "TYPED-SECRET-WORDS", timeout_s: 1 });
  await h.call("find", { tabId, query: "FIND-SECRET-WORDS" });

  const file = path.join(h.work, "audit.jsonl");
  check(fs.existsSync(file), "the audit file was created");
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.trim().split("\n").map((l) => JSON.parse(l));
  const tools = lines.map((l) => l.tool);
  for (const want of ["tabs_create", "navigate", "computer", "wait_for", "find"])
    check(tools.includes(want), `a line for ${want}`);
  const nav = lines.find((l) => l.tool === "navigate");
  check(nav.host === "localhost" && nav.ok === true, `the navigate line has the host only: ${JSON.stringify(nav)}`);
  const wait = lines.find((l) => l.tool === "wait_for");
  check(wait.ok === false && wait.err === "timeout", `a failed call has its error code: ${JSON.stringify(wait)}`);
  for (const secret of ["SECRET123", "TYPED-SECRET-WORDS", "FIND-SECRET-WORDS", "/delayed"])
    check(!raw.includes(secret), `the file holds no ${secret}`);
  const mode = fs.statSync(file).mode & 0o777;
  check(mode === 0o600, `the file is private (mode ${mode.toString(8)})`);
  console.log("PASS: every call wrote one audit line, with no URL path, query or typed text");
});
