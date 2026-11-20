// Proves `browser-hand replay` in a real Chrome for Testing: a recording in
// the profile is replayed from the command line with no model, each step
// printed as it runs, and it did what was recorded
// (plans/17-hands-free-and-guarded.md, Phase 4).
import { spawn } from "node:child_process";
import { check, run } from "./headless.mjs";

await run({}, async (h) => {
  const now = Date.now();
  const flow = {
    title: "Proof form",
    steps: [
      { type: "navigate", url: `${h.web}/form`, assertedEvents: [{ type: "navigation", url: `${h.web}/form`, title: "" }] },
      { type: "click", selectors: [["#go"]], offsetX: 5, offsetY: 5 },
      { type: "change", selectors: [["#name"]], value: "alice" },
    ],
  };
  const rec = {
    id: "rec_proof",
    title: "Proof form",
    startedAt: now - 5000,
    stoppedAt: now - 1000,
    windowId: 1,
    flow,
    meta: flow.steps.map((_, i) => ({ ts: now - 4000 + i, tabId: 1, actor: "person" })),
    stopReason: "stopped by the person",
  };
  const summary = { id: rec.id, title: rec.title, startedAt: rec.startedAt, stoppedAt: rec.stoppedAt, steps: 3, stopReason: rec.stopReason };
  await h.workerEval(`chrome.storage.local.set({ recordings: [${JSON.stringify(summary)}], "rec:rec_proof": ${JSON.stringify(rec)} }).then(() => true)`);

  // Async: the proof's own web server runs in this process and must keep answering.
  const cli = (...args) =>
    new Promise((resolve) => {
      const p = spawn(h.bin, args, { env: { ...h.env, BROWSER_HAND_PACE: "fast" } });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      const timer = setTimeout(() => p.kill(), 90_000);
      p.on("exit", (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr });
      });
    });

  let r = await cli("recordings", "--profile", "Proof");
  check(r.status === 0 && /rec_proof/.test(r.stdout) && /Proof form/.test(r.stdout), `recordings lists it: ${r.stdout.split("\n")[1] ?? r.stderr}`);

  r = await cli("replay", "rec_proof", "--profile", "Proof");
  check(r.status === 0, `replay exited 0 (${r.status}) ${r.stderr}`);
  check(/Replaying recording rec_proof, steps 1 to 3/.test(r.stdout), "it printed the header");
  check(/Replayed steps 1 to 3\./.test(r.stdout), "it printed the end");
  const stepLines = r.stdout.split("\n").filter((l) => /^[123]\. \[person\]/.test(l));
  check(stepLines.length === 3, `it printed each step (${stepLines.length} of 3)`);
  const out = await h.pageEval("/form", "document.getElementById('out').textContent");
  const name = await h.pageEval("/form", "document.getElementById('name').value");
  check(out === "clicked" && name === "alice", `the page shows what was recorded (out=${out}, name=${name})`);

  r = await cli("replay", "rec_proof", "--profile", "Proof", "--from", "99");
  check(r.status === 1 && /from must be 1 to 3/.test(r.stdout + r.stderr), `a bad --from stops it with status 1: ${(r.stdout + r.stderr).trim().slice(0, 100)}`);
  console.log("PASS: browser-hand replay ran a recording with no model, printed each step and left the page as recorded");
});
