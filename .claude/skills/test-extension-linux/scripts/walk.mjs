import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
const { WORK, BIN, PORT } = process.env;
const log = (ok, what, extra = "") => console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra ? " ~ " + extra : ""}`);
let bad = 0; const check = (ok, what, extra) => { log(ok, what, extra); if (!ok) bad++; };

// local page: form, drag, big text, a token in the url, a fetch with a token
const big = "lorem ipsum ".repeat(9000);
const srv = createServer((req, res) => {
  if (req.url.startsWith("/api")) { res.setHeader("content-type", "application/json"); return res.end('{"ok":true}'); }
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><title>walk</title><body style="margin:0">
<form onsubmit="event.preventDefault();document.title='sent:'+document.getElementById('n').value">
<label for=n>name</label><input id=n><button id=go>send</button></form>
<div id=drag style="width:80px;height:40px;background:#e90;position:absolute;left:300px;top:200px">drag</div>
<script>fetch('/api?token=abc&access_token=abc');let d=document.getElementById('drag');
let on=false;d.onmousedown=()=>on=true;onmouseup=()=>{if(on){document.title+=' dragged';on=false}}</script>
<p>${big}</p></body>`);
}).listen(0, "127.0.0.1");
await new Promise((r) => srv.on("listening", r));
const site = `http://127.0.0.1:${srv.address().port}`;

const env = { ...process.env };
const p = spawn(BIN, ["mcp"], { env, stdio: ["pipe", "pipe", "inherit"] });
let buf = "", n = 0; const wait = new Map();
p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); wait.get(m.id)?.(m); } catch {} } });
const rpc = (method, params) => new Promise((r) => { const id = ++n; wait.set(id, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const call = async (name, args = {}) => { const m = await rpc("tools/call", { name, arguments: args }); return m.result ?? { isError: true, content: [{ type: "text", text: JSON.stringify(m.error) }] }; };
const text = (r) => (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "walk", version: "0" } });
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const cdp = async () => { const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)); let k = 0; const w = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); w.get(d.id)?.(d); }; return { send: (method, params = {}) => new Promise((r) => { w.set(++k, r); ws.send(JSON.stringify({ id: k, method, params })); }), ws }; };

// 1. select_profile launches Chrome; open the claim URL as a person's Chrome would
const sel = call("select_profile", { profile: "Proof" });
for (let i = 0; i < 100 && !existsSync(`${WORK}/claim.url`); i++) await new Promise((r) => setTimeout(r, 200));
for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
const c = await cdp(); await c.send("Target.createTarget", { url: readFileSync(`${WORK}/claim.url`, "utf8").trim() });
const s = await sel; check(!s.isError && /selected/.test(text(s)), "select_profile", text(s).slice(0, 80));

// 2. list_profiles
const lp = await call("list_profiles"); check(!lp.isError && /Proof/.test(text(lp)), "list_profiles shows the profile once", text(lp).replace(/\\n/g, " ").slice(0, 120));

// 3. open a page
const tc = await call("tabs_context", { createIfEmpty: true }); const tabId = Number((text(tc).match(/(?:tabId|Tab ID)\D{0,5}(\d+)/i) || [])[1]);
check(tabId > 0, "tabs_context gave a tab", text(tc).slice(0, 100));
const nav = await call("navigate", { tabId, url: `${site}/?access_token=abc` }); check(!nav.isError, "navigate", text(nav).slice(0, 80));
await new Promise((r) => setTimeout(r, 1500));

// 4. read page, find, fill a form, click, drag
const rp = await call("read_page", { tabId, filter: "interactive" }); const rt = text(rp); check(!rp.isError && /name|textbox|input/i.test(rt), "read_page shows the form");
const ref = (rt.match(/textbox[^\n]*?\[?(ref_\w+)\]?|\[(ref_\w+)\][^\n]*textbox|(ref_\w+)[^\n]*(input|textbox)/i) || []).slice(1).find(Boolean);
const fi = await call("form_input", { tabId, ref, value: "Ada" }); check(!fi.isError, "form_input", text(fi).slice(0, 80));
const btn = (rt.match(/(ref_\w+)[^\n]*send|send[^\n]*(ref_\w+)/i) || []).slice(1).find(Boolean);
const ck = await call("computer", { tabId, action: "left_click", ref: btn }); check(!ck.isError, "computer left_click on Send", text(ck).slice(0, 80));
const t1 = await call("javascript_tool", { tabId, action: "javascript_exec", text: "document.title" }); check(/sent:Ada/.test(text(t1)), "the form was filled and sent", text(t1));
const dr = await call("computer", { tabId, action: "left_click_drag", start_coordinate: [340, 220], coordinate: [500, 300] }); check(!dr.isError, "computer left_click_drag", text(dr).slice(0, 80));
const t2 = await call("javascript_tool", { tabId, action: "javascript_exec", text: "document.title" }); check(/dragged/.test(text(t2)), "the drag reached the page", text(t2));

// 5. screenshot
const sh = await call("computer", { tabId, action: "screenshot" }); check(!sh.isError && (sh.content || []).some((x) => x.type === "image"), "screenshot returns an image");
const img = (sh.content || []).find((x) => x.type === "image"); if (img) writeFileSync(`${process.env.SHOT || process.env.WORK}/walk-shot.png`, Buffer.from(img.data, "base64"));

// 6. network read hides the token
const nr = await call("read_network_requests", { tabId }); const nt = text(nr);
check(/\/api/.test(nt) && !/access_token=abc|token=abc/.test(nt), "read_network_requests lists /api with the token hidden", nt.split("\n").find((l) => /api/.test(l)) || nt.slice(0, 120));

// 7. big read
const gt = await call("get_page_text", { tabId }); check(!gt.isError && text(gt).length > 50000, "get_page_text returns a large page", `${text(gt).length} chars`);
const lt = await rpc("tools/list", {}); const meta = lt.result.tools.find((t) => t.name === "get_page_text")?._meta; check(meta?.["anthropic/maxResultSizeChars"] === 60000, "tools/list carries maxResultSizeChars 60000");

// 8. uploads refuse credential files
writeFileSync(`${WORK}/.env`, "KEY=1\n"); writeFileSync(`${WORK}/ok.txt`, "hi\n");
const up = await call("file_upload", { tabId, ref, paths: [`${WORK}/.env`] }); check(up.isError && /\.env|refus|credential|not/i.test(text(up)), "file_upload refuses a .env", text(up).slice(0, 100));

// 9. reload the worker mid-session; the next call carries on
const sws = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "service_worker" && t.url.includes("ednpkicgdjiiihmophoifehfeeoabjdc"));
const wsk = new WebSocket(sws.webSocketDebuggerUrl); await new Promise((r) => (wsk.onopen = r));
await c.send("Target.closeTarget", { targetId: sws.id }); await new Promise((r) => setTimeout(r, 500));
await c.send("Target.createTarget", { url: "about:blank" }); // an event wakes the stopped worker, as Chrome does
await new Promise((r) => setTimeout(r, 1500)); const t0 = Date.now();
const old = await call("javascript_tool", { tabId, action: "javascript_exec", text: "document.title" });
console.log("old tab after the worker restart:", text(old).slice(0, 140));
const nt2 = await call("tabs_create"); const id2 = Number((text(nt2).match(/(?:tabId|Tab ID)\D{0,5}(\d+)/i) || [])[1]);
await call("navigate", { tabId: id2, url: site + "/" }); await new Promise((r) => setTimeout(r, 1200));
const after = await call("javascript_tool", { tabId: id2, action: "javascript_exec", text: "document.title" });
check(!after.isError && /walk/.test(text(after)), "after the worker restarted mid-session, the next call on a new tab goes on", `${Date.now() - t0} ms; ${text(after).slice(0, 60)}`);
console.log(bad ? `WALK FAIL (${bad})` : "WALK PASS");
p.kill(); srv.close(); process.exit(bad ? 1 : 0);
