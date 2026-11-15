// The toolbar popup's entry: popup ops go to the service worker, which only
// takes them from this page (`fromPopup` in `recorder.ts`).
import type { PopupReply } from "../recorder";
import { PopupPage } from "./page";

const root = document.getElementById("app");
if (root) {
  new PopupPage(root, {
    async send(msg) {
      const r = (await chrome.runtime.sendMessage(msg)) as PopupReply | undefined;
      if (!r) throw new Error("browser-hand's service worker did not answer. Reload the extension.");
      if (!r.ok) throw new Error(r.error);
      return r.value;
    },
    windowId: async () => (await chrome.windows.getCurrent()).id ?? chrome.windows.WINDOW_ID_CURRENT,
    openSettings: () => void chrome.runtime.openOptionsPage(),
    close: () => window.close(),
    now: () => Date.now(),
  });
}
