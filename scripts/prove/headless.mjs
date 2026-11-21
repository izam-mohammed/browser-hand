// Shared by the plan 17 proofs (scripts/prove/{wait-for,allow-list,audit-log,
// replay-cli}.sh): starts a throwaway Chrome for Testing profile with the
// built extension, a host and an MCP client, and a small local web server,
// all under temp dirs. Never touches a real Chrome profile. Needs a host
// build (host/target/{release,debug}/browser-hand), extension/dist, node 22+
// and CFT_CHROME. Chrome for Testing ignores a chrome-extension:// URL on its
// command line, so the claim page is opened over DevTools, as in
// scripts/prove/linux-open.sh.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}
export function check(ok, label) {
  console.log(`${ok ? "ok:  " : "FAIL:"} ${label}`);
  if (!ok) {
    process.exitCode = 1;
    throw new Error(label);
  }
}

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** The pages the proofs need; `port` is the server's own. */
function page(url, port) {
  const html = (body) => `<!doctype html><meta charset=utf-8><body>${body}`;
  switch (url.pathname) {
    case "/delayed":
      return html(`<p id=s>Loading...</p><script>setTimeout(()=>{document.getElementById('s').textContent='Ready now'},2000)</script>`);
    case "/hash":
      return html(`<p>wait for the hash</p><script>setTimeout(()=>{location.hash='#done'},1500)</script>`);
    case "/frame":
      return html(`<p>outer</p><iframe src="http://127.0.0.1:${port}/inner"></iframe>`);
    case "/form":
      return html(`<input id=name aria-label=Name><button id=go onclick="document.getElementById('out').textContent='clicked'">Go</button><p id=out></p>`);
    default:
      return html(`<h1>Hello</h1><p>${url.pathname}</p>`);
  }
}

/**
 * @param {{config?: (work: string) => string}} opts config.toml text for the run
 */
export async function start(opts = {}) {
  const bin =
    process.env.BH_BIN ||
    ["release", "debug"].map((d) => path.join(root, "host/target", d, "browser-hand")).find((p) => fs.existsSync(p));
  if (!bin || !fs.existsSync(bin)) fail("build the host first (cargo build --release --manifest-path host/Cargo.toml)");
  const cft = process.env.CFT_CHROME;
  if (!cft || !fs.existsSync(cft)) fail("set CFT_CHROME to the Chrome for Testing binary");
  const ext = path.join(root, "extension/dist");
  if (!fs.existsSync(path.join(ext, "manifest.json"))) fail("build the extension first (npm --prefix extension run build)");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bh-proof-"));
  const udd = path.join(work, "udd");
  const socks = fs.mkdtempSync("/tmp/bhs-");
  const xdg = path.join(work, "xdg");
  fs.mkdirSync(path.join(xdg, "browser-hand"), { recursive: true });
  fs.mkdirSync(udd, { recursive: true });
  fs.writeFileSync(path.join(xdg, "browser-hand/config.toml"), opts.config ? opts.config(work) : "");
  fs.writeFileSync(path.join(udd, "Local State"), JSON.stringify({ profile: { last_used: "Proof", info_cache: { Proof: { name: "Proof" } } } }));

  // The local web server: every request is remembered by Host header.
  const hits = [];
  let webPort = 0;
  const server = http.createServer((req, res) => {
    hits.push({ host: (req.headers.host || "").split(":")[0], url: req.url });
    const url = new URL(req.url, "http://x");
    res.setHeader("content-type", "text/html");
    res.end(page(url, webPort));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  webPort = server.address().port;

  const debugPort = await freePort();
  const browser = path.join(work, "browser");
  fs.writeFileSync(
    browser,
    `#!/bin/sh
echo "$@" >"$BH_WORK/args"
echo $$ >"$BH_WORK/chrome.pid"
n=$#
while [ "$n" -gt 0 ]; do
  a=$1; shift
  case "$a" in
    chrome-extension://*) echo "$a" >"$BH_WORK/claim.url" ;;
    *) set -- "$@" "$a" ;;
  esac
  n=$((n - 1))
done
exec "$CFT_CHROME" --headless=new --no-sandbox --remote-debugging-port="$BH_PORT" \\
  --load-extension="$BH_EXT" --no-first-run --no-default-browser-check "$@" about:blank
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    BH_WORK: work,
    BH_PORT: String(debugPort),
    BH_EXT: ext,
    CFT_CHROME: cft,
    BROWSER_HAND_CHROME_DIR: udd,
    BROWSER_HAND_SOCKET_DIR: socks,
    BROWSER_HAND_BROWSER_BIN: browser,
    XDG_CONFIG_HOME: xdg,
    HOME: work,
  };
  execFileSync(bin, ["install", "--no-store"], { env, stdio: "ignore" });

  const mcp = spawn(bin, ["mcp"], { env, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let nextId = 1;
  readline.createInterface({ input: mcp.stdout }).on("line", (line) => {
    try {
      const m = JSON.parse(line);
      pending.get(m.id)?.(m);
    } catch {}
  });
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "prove", version: "0" } });
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const stop = async () => {
    mcp.kill();
    try {
      const pid = Number(fs.readFileSync(path.join(work, "chrome.pid"), "utf8"));
      process.kill(pid);
    } catch {}
    server.close();
    await sleep(300);
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(socks, { recursive: true, force: true });
  };

  /** One tool call: {text, isError}. */
  const call = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    const content = r.result?.content ?? [];
    const text = content.map((c) => c.text ?? "").join("\n");
    return { text, isError: r.result?.isError === true || !!r.error, error: r.error };
  };

  const cdp = async (wsUrl, method, params = {}) => {
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));
    const out = await new Promise((resolve) => {
      ws.onmessage = (e) => resolve(JSON.parse(e.data));
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
    ws.close();
    return out;
  };
  const targets = async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const browserWs = async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()).webSocketDebuggerUrl;

  try {
    // select_profile starts the browser; open the claim page when it appears.
    const selected = call("select_profile", { profile: "Proof" });
    const claimFile = path.join(work, "claim.url");
    for (let i = 0; !fs.existsSync(claimFile); i++) {
      if (i > 150) fail("the launcher never ran the browser binary");
      await sleep(200);
    }
    for (let i = 0; ; i++) {
      try {
        await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        break;
      } catch {
        if (i > 100) fail("no DevTools port");
        await sleep(250);
      }
    }
    await cdp(await browserWs(), "Target.createTarget", { url: fs.readFileSync(claimFile, "utf8").trim() });
    const sel = await selected;
    if (sel.isError || !/selected/i.test(sel.text)) fail(`select_profile: ${sel.text}`);
  } catch (e) {
    await stop();
    throw e;
  }

  return {
    bin,
    env,
    work,
    web: `http://localhost:${webPort}`,
    webAlt: `http://127.0.0.1:${webPort}`,
    hits,
    call,
    json: async (name, args) => JSON.parse((await call(name, args)).text),
    /** Evaluates in the extension's service worker (it leaves the target list after ~30 s idle). */
    async workerEval(expression) {
      for (let i = 0; i < 40; i++) {
        const t = (await targets()).find((x) => x.type === "service_worker" && x.url.startsWith("chrome-extension://"));
        if (t) {
          const r = await cdp(t.webSocketDebuggerUrl, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
          if (r.result?.exceptionDetails) fail(`worker: ${JSON.stringify(r.result.exceptionDetails)}`);
          return r.result?.result?.value;
        }
        await sleep(250);
      }
      fail("the extension's service worker is not running");
    },
    /** Evaluates in the first page whose URL holds `part`. */
    async pageEval(part, expression) {
      const t = (await targets()).find((x) => x.type === "page" && x.url.includes(part));
      if (!t) fail(`no page with ${part} in its URL`);
      const r = await cdp(t.webSocketDebuggerUrl, "Runtime.evaluate", { expression, returnByValue: true });
      return r.result?.result?.value;
    },
    /** Opens a tab outside any browser-hand group, as the person would. */
    async openTab(url) {
      await cdp(await browserWs(), "Target.createTarget", { url });
    },
    sleep,
    stop,
  };
}

/** Runs `main(h)` against a started harness and always cleans up. */
export async function run(opts, main) {
  const h = await start(opts);
  try {
    await main(h);
  } finally {
    await h.stop();
  }
}
