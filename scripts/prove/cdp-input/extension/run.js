// Proof only: open a test page, attach the debugger, click the input, type,
// press cmd+a (Meta+A with the selectAll command), then report what the
// page saw to the echo host. See scripts/prove/cdp-input.sh.
const HOST = "dev.browserhand.provecdp";
const status = document.getElementById("status");

const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html>
<input id="box" style="position:absolute;left:100px;top:100px;width:200px;height:30px">
<script>
  window.__log = [];
  for (const t of ["mousemove", "mousedown", "mouseup", "click", "keydown", "keyup", "input"]) {
    document.addEventListener(t, (e) => window.__log.push({ type: t, trusted: e.isTrusted }), true);
  }
</script>`)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const report = { type: "cdp-proof" };
  const tab = await chrome.tabs.create({ url: PAGE, active: true });
  await sleep(1000);
  const target = { tabId: tab.id };
  await chrome.debugger.attach(target, "1.3");
  const send = (method, params) => chrome.debugger.sendCommand(target, method, params);
  try {
    const at = { x: 200, y: 115 };
    for (const [x, y] of [[50, 50], [120, 90], [at.x, at.y]]) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
      await sleep(16);
    }
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
    await sleep(90);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
    for (const ch of "abc") {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, code: `Key${ch.toUpperCase()}`, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0), text: ch });
      await sleep(80);
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code: `Key${ch.toUpperCase()}`, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) });
      await sleep(150);
    }
    // cmd+a on macOS: Meta down, A with modifiers 4 and the selectAll command.
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91, modifiers: 4 });
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 4, commands: ["selectAll"] });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 4 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91, modifiers: 0 });
    await sleep(100);

    const r = await send("Runtime.evaluate", {
      expression: `(() => { const b = document.getElementById("box");
        return { log: window.__log, value: b.value, selStart: b.selectionStart, selEnd: b.selectionEnd,
                 focused: document.activeElement === b, webdriver: navigator.webdriver }; })()`,
      returnByValue: true,
    });
    Object.assign(report, r.result.value);
  } catch (e) {
    report.error = String(e);
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
  const port = chrome.runtime.connectNative(HOST);
  port.postMessage(report);
  await sleep(300);
  port.disconnect();
  status.textContent = report.error ? `Failed: ${report.error}` : "Done; see the terminal.";
}

main();
