// Proof only: capture-phase listeners that turn the person's clicks, field
// changes and Enter, Tab and Escape into DevTools Recorder steps
// (docs/external/puppeteer-replay.md) and send them to the service worker.
// See scripts/prove/record-capture.sh.
let on = false;

function roleOf(el) {
  if (el.getAttribute("role")) return el.getAttribute("role");
  const tag = el.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "input" || tag === "textarea") return "textbox";
  return null;
}

function nameOf(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent.trim()).join(" ");
  return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function selectors(el) {
  const out = [];
  const role = roleOf(el);
  const name = nameOf(el);
  if (name) out.push([role ? `aria/${name}[role="${role}"]` : `aria/${name}`]);
  if (el.id) out.push([`#${el.id}`]);
  return out;
}

function send(step, e) {
  if (!on) return;
  chrome.runtime.sendMessage({ proof: "step", step, meta: { trusted: e.isTrusted, ts: Date.now() } });
}

addEventListener(
  "click",
  (e) => {
    const el = e.target.closest("button, input, textarea, a, [role]") || e.target;
    const r = el.getBoundingClientRect();
    send({ type: "click", selectors: selectors(el), offsetX: Math.round(e.clientX - r.left), offsetY: Math.round(e.clientY - r.top) }, e);
  },
  true,
);

addEventListener("change", (e) => send({ type: "change", selectors: selectors(e.target), value: e.target.value }, e), true);

addEventListener(
  "keydown",
  (e) => {
    if (!["Enter", "Tab", "Escape"].includes(e.key)) return;
    send({ type: "keyDown", key: e.key }, e);
    send({ type: "keyUp", key: e.key }, e);
  },
  true,
);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.proof === "start") {
    on = true;
    document.getElementById("state").textContent = "Recording: now type in Name, then click Save.";
    reply(true);
  } else if (msg?.proof === "rect") {
    const r = document.getElementById(msg.id).getBoundingClientRect();
    reply({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  } else if (msg?.proof === "done") {
    on = false;
    document.getElementById("state").textContent = msg.text;
    reply(true);
  }
});
