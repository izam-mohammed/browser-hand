// One DevTools call from the shell. Node 22+ (built-in WebSocket), no packages.
//   node cdp.mjs <port> targets
//   node cdp.mjs <port> open <url>                       Target.createTarget
//   node cdp.mjs <port> eval <url-part|type> <js>        Runtime.evaluate, awaits promises
//   node cdp.mjs <port> shot <url-part|type> <out.png>   Page.captureScreenshot
// Service worker (chrome.* APIs):  eval ednpkicgdjiiihmophoifehfeeoabjdc/background 'chrome.runtime.getManifest().name'
// Extension pages need `open` (a chrome-extension:// URL on the command line fails headless).
import { writeFileSync } from "node:fs";
const [port, cmd, a, b] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const list = async () => (await fetch(`${base}/json`)).json();
const connect = async (url) => {
  const ws = new WebSocket(url);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let n = 0; const wait = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); wait.get(d.id)?.(d); };
  return { send: (method, params = {}) => new Promise((r) => { wait.set(++n, r); ws.send(JSON.stringify({ id: n, method, params })); }), close: () => ws.close() };
};
const find = async (needle) => {
  const t = (await list()).find((x) => x.url.includes(needle) || x.type === needle);
  if (!t) { console.error(`no target matching ${needle}`); process.exit(1); }
  return t;
};
if (cmd === "targets") for (const t of await list()) console.log(t.type, t.url);
else if (cmd === "open") {
  const v = await (await fetch(`${base}/json/version`)).json();
  const c = await connect(v.webSocketDebuggerUrl);
  console.log(JSON.stringify((await c.send("Target.createTarget", { url: a })).result)); c.close();
} else if (cmd === "eval") {
  const c = await connect((await find(a)).webSocketDebuggerUrl);
  const r = (await c.send("Runtime.evaluate", { expression: b, awaitPromise: true, returnByValue: true })).result;
  if (r.exceptionDetails) { console.error(r.exceptionDetails.exception?.description ?? "exception"); process.exit(1); }
  console.log(JSON.stringify(r.result.value)); c.close();
} else if (cmd === "shot") {
  const c = await connect((await find(a)).webSocketDebuggerUrl);
  writeFileSync(b, Buffer.from((await c.send("Page.captureScreenshot")).result.data, "base64")); c.close();
} else { console.error("usage: see header"); process.exit(2); }
