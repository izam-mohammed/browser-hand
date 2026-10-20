// Proof only: says the options page opened, from a port as the real
// settings page will connect. See scripts/prove/site-rules.sh.
const port = chrome.runtime.connect({ name: "options" });
port.postMessage({ opened: location.href });
