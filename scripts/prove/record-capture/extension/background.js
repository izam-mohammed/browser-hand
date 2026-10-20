// Proof only: the toolbar button starts recording its tab and puts "REC" on
// the badge; once the person has changed the Name field and clicked Save,
// one debugger click lands on "Debugger target"; then the steps go to the
// script's local server as a UserFlow. State lives in storage.session so a
// stopped worker loses nothing. See scripts/prove/record-capture.sh.
const REPORT = "http://127.0.0.1:8765/report";

const load = async () => (await chrome.storage.session.get("proof")).proof ?? { steps: [], meta: [] };
const save = (s) => chrome.storage.session.set({ proof: s });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.action.setBadgeText({ tabId: tab.id, text: "REC" });
  await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#d93025" });
  const s = { onClicked: true, tabId: tab.id, url: tab.url, steps: [], meta: [] };
  s.badge = await chrome.action.getBadgeText({ tabId: tab.id });
  await save(s);
  await chrome.tabs.sendMessage(tab.id, { proof: "start" });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.proof !== "step") return;
  (async () => {
    const s = await load();
    if (sender.tab?.id !== s.tabId || s.reported) return;
    s.steps.push(msg.step);
    s.meta.push({ ...msg.meta, source: s.cdpSent ? "debugger" : "person" });
    await save(s);
    const person = s.steps.filter((_, i) => s.meta[i].source === "person");
    const changed = person.some((st) => st.type === "change");
    const clicked = person.some((st) => st.type === "click" && JSON.stringify(st.selectors).includes("Save"));
    if (!s.cdpSent && changed && clicked) await debuggerClick(s);
    else if (s.cdpSent && msg.step.type === "click") await report(s);
  })();
});

async function debuggerClick(s) {
  s.cdpSent = true;
  await save(s);
  const at = await chrome.tabs.sendMessage(s.tabId, { proof: "rect", id: "cdp" });
  const target = { tabId: s.tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
    const send = (method, params) => chrome.debugger.sendCommand(target, method, params);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, button: "none", buttons: 0 });
    await sleep(50);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
    await sleep(90);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
  } catch (e) {
    s.error = `debugger click failed: ${e}`;
    await report(s);
  } finally {
    await sleep(300);
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function report(s) {
  s.reported = true;
  await save(s);
  const flow = { title: "record-capture proof", steps: [{ type: "navigate", url: s.url }, ...s.steps] };
  const body = { type: "record-proof", onClicked: s.onClicked, badge: s.badge, flow, meta: [{ source: "start" }, ...s.meta], error: s.error };
  let text = "Done; see the terminal.";
  try {
    await fetch(REPORT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    text = `Could not reach the script: ${e}`;
  }
  await chrome.action.setBadgeText({ tabId: s.tabId, text: "" });
  await chrome.tabs.sendMessage(s.tabId, { proof: "done", text }).catch(() => {});
}
