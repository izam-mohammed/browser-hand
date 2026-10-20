// Proof only: connect the native host, say hello with this profile's claimed
// dir, and relay claims from claim.html. See scripts/prove/chrome-bridge.sh.
const HOST = "dev.browserhand.prove";
let port = null;

async function connect() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST);
  port.onDisconnect.addListener(() => {
    console.warn("native port closed:", chrome.runtime.lastError?.message);
    port = null;
  });
  const { profileDir = null } = await chrome.storage.local.get("profileDir");
  port.postMessage({ type: "hello", profileDir, extensionVersion: chrome.runtime.getManifest().version });
  return port;
}

chrome.runtime.onInstalled.addListener(() => { connect(); });
chrome.runtime.onStartup.addListener(() => { connect(); });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "claim") return;
  (async () => {
    await chrome.storage.local.set({ profileDir: msg.dir });
    const p = await connect();
    p.postMessage({ type: "claimed", profileDir: msg.dir, nonce: msg.nonce });
    reply({ ok: true });
  })().catch((e) => reply({ ok: false, error: String(e) }));
  return true;
});
