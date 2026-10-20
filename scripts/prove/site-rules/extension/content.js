// Proof only: the start page asks the service worker to begin; in tabs A
// and B it adds an iframe or follows a link to the blocked host when told.
// See scripts/prove/site-rules.sh.
if (location.pathname === "/") {
  document.getElementById("go")?.addEventListener("click", () => chrome.runtime.sendMessage({ proof: "start" }));
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.proof === "iframe") {
    const f = document.createElement("iframe");
    f.src = msg.url;
    document.body.append(f);
    reply(true);
  } else if (msg?.proof === "link") {
    const a = document.createElement("a");
    a.href = msg.url;
    a.textContent = "to the blocked host";
    document.body.append(a);
    a.click();
    reply(true);
  }
});
