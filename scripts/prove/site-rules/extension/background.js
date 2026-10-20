// Proof only: opens the options page with runtime.openOptionsPage, then
// adds one session rule blocking http://localhost:8790/blocked* (main_frame
// and sub_frame) for tab A alone, and in tabs A and B loads the blocked page
// three ways: an iframe, a link click and tabs.update. The local server
// counts which requests reached it; this reports what Chrome said.
// See scripts/prove/site-rules.sh.
const BASE = "http://127.0.0.1:8790";
const BLOCKED = "http://localhost:8790/blocked.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { options: null, rule: null, errors: [], navErrors: [] };

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "options") return;
  port.onMessage.addListener((m) => {
    report.options = { url: m.opened, inTab: port.sender?.tab?.id !== undefined, senderUrl: port.sender?.url ?? null };
  });
});

chrome.webNavigation.onErrorOccurred.addListener((d) => report.navErrors.push(d));

async function loaded(tabId) {
  for (let i = 0; i < 50; i++) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return t;
    await sleep(100);
  }
  return chrome.tabs.get(tabId);
}

async function run() {
  await chrome.runtime.openOptionsPage();
  await sleep(1500);

  const a = await chrome.tabs.create({ url: `${BASE}/tab.html?tab=A`, active: false });
  const b = await chrome.tabs.create({ url: `${BASE}/tab.html?tab=B`, active: false });
  await loaded(a.id);
  await loaded(b.id);

  const rule = {
    id: 1,
    priority: 1,
    action: { type: "block" },
    condition: {
      regexFilter: "^https?://localhost(:[0-9]+)?/blocked",
      resourceTypes: ["main_frame", "sub_frame"],
      tabIds: [a.id],
    },
  };
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1], addRules: [rule] });
    report.rule = (await chrome.declarativeNetRequest.getSessionRules()).length === 1 ? "added" : "missing";
  } catch (e) {
    report.rule = `refused: ${e.message}`;
  }

  for (const [name, tab] of [["A", a], ["B", b]]) {
    try {
      await chrome.tabs.sendMessage(tab.id, { proof: "iframe", url: `${BLOCKED}?tab=${name}&via=iframe` });
      await sleep(1500);
      await chrome.tabs.sendMessage(tab.id, { proof: "link", url: `${BLOCKED}?tab=${name}&via=link` });
      await sleep(1500);
      await chrome.tabs.update(tab.id, { url: `${BLOCKED}?tab=${name}&via=update` });
      await sleep(1500);
    } catch (e) {
      report.errors.push(`${name}: ${e.message}`);
    }
  }
  report.tabs = { A: a.id, B: b.id };
  await fetch(`${BASE}/report`, { method: "POST", body: JSON.stringify(report) });
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1] });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.proof === "start") run().catch((e) => fetch(`${BASE}/report`, { method: "POST", body: JSON.stringify({ error: String(e) }) }));
});
