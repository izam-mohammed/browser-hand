// Proof only: reports which window the popup belongs to (windows.getCurrent,
// and the last focused one beside it), switches the global popup off with
// setPopup(""), and tells the person what to do next. See
// scripts/prove/action-popup.sh.
const BASE = "http://127.0.0.1:8791";
const send = (kind, data = {}) =>
  fetch(`${BASE}/event`, { method: "POST", body: JSON.stringify({ kind, at: Date.now(), ...data }) }).catch(() => {});
const say = (text) => (document.getElementById("say").textContent = text);

(async () => {
  const [current, focused, { clicks = 0 }] = await Promise.all([
    chrome.windows.getCurrent(),
    chrome.windows.getLastFocused(),
    chrome.storage.session.get("clicks"),
  ]);
  await send("popup_opened", { clicks, windowId: current.id, focusedWindowId: focused.id });
  const go = document.getElementById("go");
  if (clicks >= 2) {
    say("Done: the popup is back. Look at the terminal for PASS.");
    await send("done");
    return;
  }
  say(
    clicks === 0
      ? "Press the button, then click the toolbar icon again: nothing should open."
      : "The popup opened while it was off (lost when the worker stopped). Press the button and click the icon again.",
  );
  go.hidden = false;
  go.addEventListener("click", async () => {
    await chrome.action.setPopup({ popup: "" });
    await send("popup_off", { popup: await chrome.action.getPopup({}), clicks });
    window.close();
  });
})();
