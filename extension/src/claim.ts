// Opened by `select_profile` as claim.html#dir=<profile dir>&nonce=<n> in the
// profile it names: tells the service worker which profile this is, then
// closes itself.
const params = new URLSearchParams(location.hash.slice(1));
const dir = params.get("dir");
const nonce = params.get("nonce");
const statusEl = document.getElementById("status")!;

if (!dir || !nonce) {
  statusEl.textContent = "Nothing to claim: this page is opened by browser-hand.";
} else {
  chrome.runtime.sendMessage({ type: "claim", dir, nonce }).then(async (res) => {
    if (!res?.ok) {
      statusEl.textContent = `Claim failed: ${res?.error ?? "no answer"}`;
      return;
    }
    statusEl.textContent = `This profile is ${dir} to browser-hand.`;
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
  });
}

export {};
