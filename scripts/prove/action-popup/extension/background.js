// Proof only: reports to the local server what the global popup reads each
// time the service worker wakes, and every click that reaches onClicked
// (which only fires while the popup is ""). From the second click on, it
// sets the popup back to popup.html, as the recorder does at every stop.
// See scripts/prove/action-popup.sh.
const BASE = "http://127.0.0.1:8791";
const send = (kind, data = {}) =>
  fetch(`${BASE}/event`, { method: "POST", body: JSON.stringify({ kind, at: Date.now(), ...data }) }).catch(() => {});

chrome.action.getPopup({}).then((popup) => send("wake", { popup }));

chrome.action.onClicked.addListener(async (tab) => {
  const { clicks = 0 } = await chrome.storage.session.get("clicks");
  const n = clicks + 1;
  await chrome.storage.session.set({ clicks: n });
  await send("clicked", { n, windowId: tab.windowId, tabId: tab.id, url: tab.url ?? "", popup: await chrome.action.getPopup({}) });
  if (n >= 2) {
    await chrome.action.setPopup({ popup: "popup.html" });
    await send("popup_on", { popup: await chrome.action.getPopup({}) });
  }
});
