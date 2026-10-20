// Read #dir=<profile dir>&nonce=<n>, hand it to the service worker, close.
const params = new URLSearchParams(location.hash.slice(1));
const dir = params.get("dir");
const nonce = params.get("nonce");
const status = document.getElementById("status");

chrome.runtime.sendMessage({ type: "claim", dir, nonce }).then((res) => {
  status.textContent = res?.ok ? `Claimed as ${dir}` : `Claim failed: ${res?.error}`;
  if (res?.ok) chrome.tabs.getCurrent().then((tab) => tab && chrome.tabs.remove(tab.id));
});
