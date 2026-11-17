// @vitest-environment jsdom
// The small entry files: each wires one page or script to Chrome. Chrome is
// a fake here and the page is jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Any = any;

let listeners: Any[];
let sendMessage: Any;

function stubChrome(extra: Any = {}) {
  listeners = [];
  sendMessage = vi.fn(async () => ({ on: false }));
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: { addListener: (cb: Any) => listeners.push(cb) },
      connect: vi.fn(() => ({
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
      })),
      openOptionsPage: vi.fn(),
    },
    tabs: {
      sendMessage: vi.fn(),
      getCurrent: vi.fn(async () => ({ id: 4 })),
      remove: vi.fn(async () => {}),
    },
    scripting: { executeScript: vi.fn(async () => {}) },
    windows: { getCurrent: vi.fn(async () => ({ id: 9 })), WINDOW_ID_CURRENT: -2 },
    ...extra,
  });
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
  location.hash = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Any).__browserHandContent;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("claim page", () => {
  it("says nothing is claimed when opened without a dir and nonce", async () => {
    stubChrome();
    document.body.innerHTML = '<p id="status"></p>';
    await import("../src/claim");
    expect(document.getElementById("status")?.textContent).toContain("Nothing to claim");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("claims the profile, says so and closes its own tab", async () => {
    stubChrome();
    sendMessage.mockResolvedValue({ ok: true });
    location.hash = "#dir=Profile%203&nonce=n1";
    document.body.innerHTML = '<p id="status"></p>';
    await import("../src/claim");
    await flush();
    expect(sendMessage).toHaveBeenCalledWith({ type: "claim", dir: "Profile 3", nonce: "n1" });
    expect(document.getElementById("status")?.textContent).toBe(
      "This profile is Profile 3 to browser-hand.",
    );
    expect((globalThis as Any).chrome.tabs.remove).toHaveBeenCalledWith(4);
  });

  it("shows why a claim failed and keeps the tab", async () => {
    stubChrome();
    sendMessage.mockResolvedValue({ ok: false, error: "no port" });
    location.hash = "#dir=D&nonce=n";
    document.body.innerHTML = '<p id="status"></p>';
    await import("../src/claim");
    await flush();
    expect(document.getElementById("status")?.textContent).toBe("Claim failed: no port");
    expect((globalThis as Any).chrome.tabs.remove).not.toHaveBeenCalled();

    vi.resetModules();
    sendMessage.mockResolvedValue(undefined);
    await import("../src/claim");
    await flush();
    expect(document.getElementById("status")?.textContent).toBe("Claim failed: no answer");
  });
});

describe("page-client", () => {
  it("sends the op to the top frame and returns the value", async () => {
    stubChrome();
    (globalThis as Any).chrome.tabs.sendMessage.mockResolvedValue({ ok: true, value: 5 });
    const { toPage } = await import("../src/page-client");
    expect(await toPage(1, { op: "viewport" })).toBe(5);
    expect((globalThis as Any).chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      { op: "viewport", __bh: true },
      { frameId: 0 },
    );
  });

  it("injects the content script into a tab opened before the extension and tries again", async () => {
    stubChrome();
    const send = (globalThis as Any).chrome.tabs.sendMessage;
    send
      .mockRejectedValueOnce(new Error("Receiving end does not exist."))
      .mockResolvedValueOnce({ ok: true, value: "late" });
    const { toPage } = await import("../src/page-client");
    expect(await toPage(1, { op: "text" })).toBe("late");
    expect((globalThis as Any).chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ["content.js"],
    });
  });

  it("names the page as off limits when it cannot be injected", async () => {
    stubChrome();
    const c = (globalThis as Any).chrome;
    c.tabs.sendMessage.mockRejectedValue(new Error("Could not establish connection."));
    c.scripting.executeScript.mockRejectedValue(new Error("Cannot access"));
    const { toPage } = await import("../src/page-client");
    await expect(toPage(1, { op: "text" })).rejects.toThrow(/Cannot read this page: Cannot access/);
  });

  it("passes another failure on as page_error, and an empty or failed reply too", async () => {
    stubChrome();
    const c = (globalThis as Any).chrome;
    const { toPage } = await import("../src/page-client");
    c.tabs.sendMessage.mockRejectedValueOnce("odd");
    await expect(toPage(1, { op: "text" })).rejects.toMatchObject({ code: "page_error" });
    c.tabs.sendMessage.mockResolvedValueOnce(undefined);
    await expect(toPage(1, { op: "text" })).rejects.toThrow("did not answer");
    c.tabs.sendMessage.mockResolvedValueOnce({ ok: false, code: "bad_args", message: "m" });
    await expect(toPage(1, { op: "text" })).rejects.toMatchObject({ code: "bad_args" });
  });
});

describe("popup and settings entries", () => {
  it("does nothing without its root element", async () => {
    stubChrome();
    await import("../src/popup/popup");
    await import("../src/options/options");
    expect((globalThis as Any).chrome.runtime.connect).not.toHaveBeenCalled();
  });

  it("opens the settings page's port when its root is there", async () => {
    stubChrome();
    document.body.innerHTML = '<div id="app"></div>';
    await import("../src/options/options");
    expect((globalThis as Any).chrome.runtime.connect).toHaveBeenCalledWith({ name: "settings" });
  });

  it("sends popup ops to the service worker and turns its reply into a value or an error", async () => {
    stubChrome();
    document.body.innerHTML = '<div id="app"></div>';
    const seen: Any[] = [];
    vi.doMock("../src/popup/page", () => ({
      PopupPage: class {
        constructor(_root: Element, api: Any) {
          seen.push(api);
        }
      },
    }));
    await import("../src/popup/popup");
    const api = seen[0];
    sendMessage.mockResolvedValueOnce({ ok: true, value: [1] });
    expect(await api.send({ __bhPopup: "list" })).toEqual([1]);
    sendMessage.mockResolvedValueOnce({ ok: false, error: "bad" });
    await expect(api.send({ __bhPopup: "list" })).rejects.toThrow("bad");
    sendMessage.mockResolvedValueOnce(undefined);
    await expect(api.send({ __bhPopup: "list" })).rejects.toThrow("did not answer");
    expect(await api.windowId()).toBe(9);
    (globalThis as Any).chrome.windows.getCurrent.mockResolvedValueOnce({});
    expect(await api.windowId()).toBe(-2);
    api.openSettings();
    expect((globalThis as Any).chrome.runtime.openOptionsPage).toHaveBeenCalled();
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    api.close();
    expect(close).toHaveBeenCalled();
    expect(typeof api.now()).toBe("number");
    vi.doUnmock("../src/popup/page");
  });
});

describe("main-world script", () => {
  it("installs the page hooks on the window", async () => {
    stubChrome();
    const hooks = vi.fn();
    vi.doMock("../src/page/hooks", () => ({ installHooks: hooks }));
    await import("../src/page/main-world");
    expect(hooks).toHaveBeenCalledWith(window);
    vi.doUnmock("../src/page/hooks");
  });
});

describe("content script", () => {
  async function load() {
    stubChrome();
    await import("../src/page/content");
    await flush();
    return listeners[0] as Any;
  }

  /** The reply to one op. */
  function ask(on: Any, msg: Any): Any {
    let got: Any;
    on({ __bh: true, ...msg }, {}, (r: Any) => {
      got = r;
    });
    return got;
  }

  it("asks the service worker whether its window records, once", async () => {
    await load();
    expect(sendMessage).toHaveBeenCalledWith({ __bhRec: "hello" });
    const first = sendMessage.mock.calls.length;
    await import("../src/page/content");
    expect(sendMessage.mock.calls.length).toBe(first);
  });

  it("starts recording when the window does, and stops when told to", async () => {
    stubChrome();
    sendMessage.mockResolvedValue({ on: true });
    await import("../src/page/content");
    await flush();
    const on = listeners[0];
    expect(ask(on, { op: "record_stop" })).toEqual({ ok: true, value: true });
    expect(ask(on, { op: "record_start" })).toEqual({ ok: true, value: true });
  });

  it("answers page operations with a value, and a failed one with its code", async () => {
    document.body.innerHTML = '<main><button id="b">Go</button><input id="i" type="text"></main>';
    const on = await load();

    const page = ask(on, { op: "read_page", filter: "interactive" });
    expect(page.ok).toBe(true);
    expect(String(page.value)).toContain("Go");
    expect(String(ask(on, { op: "find", query: "Go" }).value)).toContain("Go");
    expect(ask(on, { op: "text" }).ok).toBe(true);
    expect(ask(on, { op: "console" }).ok).toBe(true);
    expect(ask(on, { op: "viewport" }).value).toMatchObject({ width: expect.any(Number) });

    const ref = String(ask(on, { op: "read_page", filter: "interactive" }).value).match(
      /ref_\w+/,
    )?.[0];
    expect(ref).toBeDefined();
    expect(ask(on, { op: "rect", ref }).value).toMatchObject({ x: expect.any(Number) });
    document.getElementById("b")!.scrollIntoView = vi.fn();
    expect(ask(on, { op: "scroll_into_view", ref }).value).toBe(true);
    expect(ask(on, { op: "resolve", selectors: [["#b"]] }).value).toMatchObject({
      ref: expect.any(String),
    });
    const miss = ask(on, { op: "resolve", selectors: [["#nothing"]] });
    expect(miss).toMatchObject({ ok: false, code: "page_error" });
    expect(miss.message).toContain("No element matches");

    window.scrollTo = vi.fn() as Any;
    expect(ask(on, { op: "scroll_xy", x: 1, y: 2 }).value).toBe(true);
    expect(window.scrollTo).toHaveBeenCalled();
    const el = document.getElementById("i")!;
    el.scrollTo = vi.fn() as Any;
    const iref = String(ask(on, { op: "read_page", filter: "interactive" }).value).match(
      /textbox[^\n]*(ref_\w+)/,
    )?.[1];
    if (iref) expect(ask(on, { op: "scroll_xy", ref: iref, x: 0, y: 5 }).value).toBe(true);

    expect(ask(on, { op: "form_input", ref: "ref_missing", value: "x" }).ok).toBe(false);
    expect(ask(on, { op: "set_files", ref: "ref_missing", files: [] }).ok).toBe(false);
    expect(ask(on, { op: "drop_files", x: 1, y: 1, files: [] }).ok).toBe(false);
  });

  it("ignores messages that are not its own", async () => {
    const on = await load();
    const reply = vi.fn();
    on({ op: "text" }, {}, reply);
    on(undefined, {}, reply);
    expect(reply).not.toHaveBeenCalled();
  });
});
