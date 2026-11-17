// The service worker is wiring: it builds the tools, listens on every Chrome
// event it uses, and turns each call frame into a result frame. Its parts
// have tests of their own, so they are replaced here by stand-ins that answer
// what the wiring asks, and Chrome by a fake that records its listeners.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolError } from "../src/wire";

type Any = any;

const h = vi.hoisted(() => {
  const state: Record<string, any> = {};
  return { state };
});

vi.mock("../src/page-client", () => ({
  toPage: vi.fn(async (_tab: number, op: Any) => `page:${op.op}`),
}));
vi.mock("../src/debugger", () => ({
  DebuggerManager: class {
    setIdleMs = vi.fn();
    send = vi.fn(async (_tab: number, method: string) => h.state.cdp?.(method) ?? {});
  },
}));
vi.mock("../src/network", () => ({
  NetworkLog: class {
    attach = vi.fn();
    read = vi.fn(async () => "net");
  },
}));
vi.mock("../src/input", () => ({
  Input: class {
    setParams = vi.fn();
    run = vi.fn(async () => "ran");
    constructor(deps: Any) {
      h.state.inputDeps = deps;
    }
  },
}));
vi.mock("../src/screenshot", async (orig) => ({
  ...(await orig<typeof import("../src/screenshot")>()),
  capture: vi.fn(async () => {
    if (h.state.captureError) throw h.state.captureError;
    return { text: "shot", data: "AAAA", mimeType: "image/png" };
  }),
  captureVisible: vi.fn(async () => ({ text: "visible", data: "BBBB", mimeType: "image/jpeg" })),
}));
vi.mock("../src/replay", () => ({ replayStep: vi.fn(async () => "replayed") }));
vi.mock("../src/site-rules", () => ({
  SiteRuleSync: class {
    update = vi.fn(async () => {});
    constructor(deps: Any) {
      h.state.siteDeps = deps;
    }
  },
}));
vi.mock("../src/settings", () => ({
  SettingsHub: class {
    settings = {
      input: { pace: "human", typing_speed: 1, mouse_speed: 1 },
      sessions: { new_window: false, close_tabs_on_end: true },
      sites: { blocked: ["blocked.example/*"], read_only: [] },
      capture: { screenshot_size: "1280x800", screenshot_quality: 80 },
      debugger: { detach_after_idle_s: 30 },
    };
    load = vi.fn(async () => {});
    onFrame = vi.fn();
    portOpened = vi.fn();
    portClosed = vi.fn();
    accept = vi.fn(() => h.state.accept ?? true);
    onChange = vi.fn((cb: Any) => {
      h.state.onChange = cb;
    });
    constructor(deps: Any) {
      h.state.hubDeps = deps;
      h.state.hub = this;
    }
  },
}));
vi.mock("../src/tabs", async (orig) => ({
  ...(await orig<typeof import("../src/tabs")>()),
  TabTools: class {
    ownTab = vi.fn(async () => ({ id: 1, windowId: 2, url: "https://example.com/" }));
    tabsContext = vi.fn(async () => "context");
    tabsCreate = vi.fn(async () => "created");
    tabsClose = vi.fn(async () => "closed");
    navigate = vi.fn(async () => "navigated");
    end = vi.fn(async () => {});
    committed = vi.fn(async () => {});
    constructor(...deps: Any[]) {
      h.state.tabDeps = deps;
      h.state.tabs = this;
    }
  },
}));
vi.mock("../src/recorder", async (orig) => ({
  ...(await orig<typeof import("../src/recorder")>()),
  Recorder: class {
    syncPopup = vi.fn(async () => {});
    toggle = vi.fn(async () => {});
    navigated = vi.fn(async () => {});
    openedFrom = vi.fn(async () => {});
    tabCreated = vi.fn(async () => {});
    tabUpdated = vi.fn(async () => {});
    windowRemoved = vi.fn(async () => {});
    isRecording = vi.fn(async () => true);
    step = vi.fn(async () => true);
    busy = vi.fn(async (_tab: number, fn: () => Promise<unknown>) => fn());
    list = vi.fn(async () => "recordings");
    get = vi.fn(async () => "recording");
    remove = vi.fn(async () => "removed");
    stop = vi.fn(async () => "stopped");
    start = vi.fn(async () => "started");
    constructor(deps: Any) {
      h.state.recorderDeps = deps;
      h.state.recorder = this;
    }
  },
}));

const EXT = "ext-id";
const url = (p: string) => `chrome-extension://${EXT}/${p}`;

interface Fake {
  chrome: Any;
  listeners: Record<string, Any[]>;
  port: Any;
  posted: Any[];
  store: Record<string, unknown>;
  calls: Record<string, Any[][]>;
  values: Record<string, unknown>;
}

/** Chrome as a proxy: every `onX` records its listeners, every function
 * returns a resolved promise, and `over` gives the answers that matter. */
function fakeChrome(over: Record<string, unknown> = {}): Fake {
  const listeners: Record<string, Any[]> = {};
  const calls: Record<string, Any[][]> = {};
  const posted: Any[] = [];
  const store: Record<string, unknown> = {};
  const port = {
    postMessage: vi.fn((f: Any) => void posted.push(f)),
    disconnect: vi.fn(),
    onMessage: { addListener: (cb: Any) => (listeners.portMessage ??= []).push(cb) },
    onDisconnect: { addListener: (cb: Any) => (listeners.portDisconnect ??= []).push(cb) },
  };
  const values: Record<string, unknown> = {
    "runtime.id": EXT,
    "runtime.getManifest": () => ({ version: "9.9.9" }),
    "runtime.getURL": url,
    "runtime.getPlatformInfo": async () => ({ os: "mac" }),
    "runtime.connectNative": () => port,
    "runtime.lastError": { message: "gone" },
    "storage.local.get": async (key: string) => (key in store ? { [key]: store[key] } : {}),
    "storage.local.set": async (items: Record<string, unknown>) => void Object.assign(store, items),
    "storage.session.get": async (key: string) => (key in store ? { [key]: store[key] } : {}),
    "storage.session.set": async (items: Record<string, unknown>) =>
      void Object.assign(store, items),
    "storage.session.remove": async (key: string) => void delete store[key],
    "tabs.query": async () => [{ id: 7, windowId: 2 }],
    "tabs.get": async () => ({ id: 1, active: false }),
    "tabGroups.query": async () => [{ id: 5 }],
    "windows.update": async (...a: Any[]) => {
      (calls["windows.update"] ??= []).push(a);
      return { width: 800, height: 600 };
    },
    "declarativeNetRequest.getSessionRules": async () => [],
    ...over,
  };
  const make = (path: string): Any =>
    new Proxy(() => {}, {
      get(_t, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        const next = path ? `${path}.${prop}` : prop;
        if (next in values) return values[next];
        if (prop.startsWith("on")) {
          return {
            addListener: (cb: Any) => (listeners[next] ??= []).push(cb),
            removeListener: vi.fn(),
          };
        }
        return make(next);
      },
      apply(_t, _this, args) {
        (calls[path] ??= []).push(args);
        return Promise.resolve(undefined);
      },
    });
  return { chrome: make(""), listeners, port, posted, store, calls, values };
}

let fake: Fake;
// The class of the module graph the current boot loaded, which `instanceof` needs.
let ToolErr: typeof ToolError;
let nextId = 100;

async function boot(over: Record<string, unknown> = {}) {
  vi.resetModules();
  for (const k of Object.keys(h.state)) delete h.state[k];
  fake = fakeChrome(over);
  vi.stubGlobal("chrome", fake.chrome);
  ({ ToolError: ToolErr } = await import("../src/wire"));
  await import("../src/background");
  await vi.advanceTimersByTimeAsync(0);
}

const emit = (name: string, ...args: Any[]) => {
  for (const l of fake.listeners[name] ?? []) l(...args);
};

/** A call frame in, the result frame out. */
async function call(tool: string, args: Any = {}, id = nextId++) {
  emit("portMessage", { type: "call", id, session: "s1", tool, args });
  await vi.advanceTimersByTimeAsync(0);
  return fake.posted.find((f) => f.type === "result" && f.id === id);
}
const content = (r: Any) => r.content.map((c: Any) => c.text ?? c.type).join("|");

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("connecting", () => {
  it("opens the native port, says hello with the profile and version, and loads the settings", async () => {
    await boot();
    fake.store.profileDir = "Profile 3";
    // hello() ran before profileDir was set; a reconnect says it again.
    h.state.hubDeps.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    const hello = fake.posted.filter((f) => f.type === "hello").at(-1);
    expect(hello).toMatchObject({
      protocol: 1,
      profileDir: "Profile 3",
      extensionVersion: "9.9.9",
    });
    expect(h.state.hub.load).toHaveBeenCalled();
    expect(h.state.hub.portOpened).toHaveBeenCalled();
    expect(fake.port.disconnect).toHaveBeenCalled();
  });

  it("gives the hub a way to post frames only while the port is up", async () => {
    await boot();
    expect(h.state.hubDeps.post({ type: "reload" })).toBe(true);
    expect(fake.posted.at(-1)).toEqual({ type: "reload" });
    emit("portDisconnect");
    expect(h.state.hubDeps.post({ type: "reload" })).toBe(false);
  });

  it("reconnects with a growing wait after the port closes, and tells the hub why", async () => {
    await boot();
    emit("portDisconnect");
    expect(h.state.hub.portClosed).toHaveBeenCalledWith("gone");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.state.hub.portOpened).toHaveBeenCalledTimes(2);
    emit("portDisconnect");
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.state.hub.portOpened).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.state.hub.portOpened).toHaveBeenCalledTimes(3);
  });

  it("starts the port again on startup and install", async () => {
    await boot();
    emit("portDisconnect");
    emit("runtime.onStartup");
    expect(h.state.hub.portOpened).toHaveBeenCalledTimes(2);
  });
});

describe("frames from the host", () => {
  it("passes settings frames to the hub, ends sessions, and reloads on request", async () => {
    await boot();
    emit("portMessage", { type: "settings" });
    emit("portMessage", { type: "settings_saved" });
    expect(h.state.hub.onFrame).toHaveBeenCalledTimes(2);
    emit("portMessage", { type: "end", session: "s9" });
    expect(h.state.tabs.end).toHaveBeenCalledWith("s9");
    emit("portMessage", { type: "reload" });
    expect(fake.calls["runtime.reload"]).toHaveLength(1);
  });

  it("drops a chunk that arrives out of order and goes on", async () => {
    await boot();
    emit("portMessage", { type: "chunk", id: 1, seq: 3, last: false, data: "" });
    expect(console.warn).toHaveBeenCalled();
    const r = await call("tabs_create");
    expect(r.ok).toBe(true);
  });

  it("rejoins a chunked call", async () => {
    await boot();
    const frame = { type: "call", id: 5, session: "s", tool: "tabs_create", args: {} };
    const data = btoa(JSON.stringify(frame));
    emit("portMessage", { type: "chunk", id: 5, seq: 0, last: true, data });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.posted.find((f) => f.id === 5)?.ok).toBe(true);
  });
});

describe("tools", () => {
  beforeEach(() => boot());

  it("answers an unknown tool with bad_args", async () => {
    const r = await call("nope");
    expect(r).toMatchObject({ ok: false, error: { code: "bad_args" } });
    expect(r.error.message).toContain("nope");
  });

  it("makes content blocks from a string, an array or a value", async () => {
    expect(content(await call("tabs_create"))).toBe("created");
    h.state.tabs.tabsCreate.mockResolvedValueOnce([{ type: "text", text: "blocks" }]);
    expect(content(await call("tabs_create", {}, 2))).toBe("blocks");
    h.state.tabs.tabsCreate.mockResolvedValueOnce({ a: 1 });
    expect(content(await call("tabs_create", {}, 3))).toBe('{"a":1}');
  });

  it("turns a ToolError into its code and anything else into page_error", async () => {
    h.state.tabs.tabsCreate.mockRejectedValueOnce(new ToolErr("no_tab", "no tab"));
    expect(await call("tabs_create")).toMatchObject({
      ok: false,
      error: { code: "no_tab", message: "no tab" },
    });
    h.state.tabs.tabsCreate.mockRejectedValueOnce(new Error("boom"));
    expect((await call("tabs_create", {}, 2)).error).toEqual({
      code: "page_error",
      message: "boom",
    });
    h.state.tabs.tabsCreate.mockRejectedValueOnce("plain");
    expect((await call("tabs_create", {}, 3)).error.message).toBe("plain");
  });

  it("runs the tab tools and the page tools through the session's own tab", async () => {
    for (const [tool, args, out] of [
      ["tabs_context", {}, "context"],
      ["tabs_close", { tabId: 1 }, "closed"],
      ["navigate", { url: "https://example.com", tabId: 1 }, "navigated"],
      ["read_page", { tabId: 1 }, "page:read_page"],
      ["find", { tabId: 1, query: "x" }, "page:find"],
      ["get_page_text", { tabId: 1 }, "page:text"],
      ["read_console_messages", { tabId: 1 }, "page:console"],
      ["read_network_requests", { tabId: 1 }, "net"],
      ["form_input", { tabId: 1, ref: "r", value: 1 }, "page:form_input"],
      ["file_upload", { tabId: 1, ref: "r", files: [] }, "page:set_files"],
    ] as const) {
      expect(content(await call(tool, args)), tool).toBe(out);
    }
    expect(h.state.tabs.ownTab).toHaveBeenCalled();
  });

  it("uploads an image by reference, by coordinate, and refuses neither", async () => {
    const img = { tabId: 1, mimeType: "image/png", data: "AAAA" };
    expect(content(await call("upload_image", { ...img, ref: "r" }, 2))).toBe("page:set_files");
    expect(content(await call("upload_image", { ...img, coordinate: [1, 2] }, 3))).toBe(
      "page:drop_files",
    );
    expect((await call("upload_image", img, 4)).error.code).toBe("bad_args");
  });

  it("evaluates JavaScript and shows strings, JSON, undefined and descriptions", async () => {
    const run = async (cdp: Any, id: number) => {
      h.state.cdp = () => cdp;
      return call("javascript_tool", { tabId: 1, text: "1" }, id);
    };
    expect(content(await run({ result: { type: "string", value: "hi" } }, 2))).toBe("hi");
    expect(content(await run({ result: { type: "object", value: { a: 1 } } }, 3))).toBe(
      '{\n  "a": 1\n}',
    );
    expect(content(await run({ result: { type: "undefined" } }, 4))).toBe("undefined");
    expect(content(await run({}, 5))).toBe("undefined");
    expect(content(await run({ result: { type: "function", description: "f()" } }, 6))).toBe("f()");
    expect(content(await run({ result: { type: "symbol" } }, 7))).toBe("symbol");
    const long = content(await run({ result: { type: "string", value: "x".repeat(50_001) } }, 8));
    expect(long).toContain("[truncated: 50001 characters]");
  });

  it("reports an exception from the page as page_error", async () => {
    h.state.cdp = () => ({
      exceptionDetails: { text: "Uncaught", exception: { description: "E: x" } },
    });
    const r = await call("javascript_tool", { tabId: 1, text: "throw" });
    expect(r.error).toEqual({ code: "page_error", message: "E: x" });
    h.state.cdp = () => ({ exceptionDetails: { text: "Uncaught" } });
    expect((await call("javascript_tool", { tabId: 1, text: "t" }, 2)).error.message).toBe(
      "Uncaught",
    );
  });

  it("takes screenshots, falls back to the visible tab when the debugger is refused, and zooms into a region", async () => {
    expect(content(await call("computer", { action: "screenshot", tabId: 1 }, 2))).toBe(
      "shot|image",
    );
    h.state.captureError = new ToolErr("debugger_refused", "no");
    expect(content(await call("computer", { action: "screenshot", tabId: 1 }, 3))).toBe(
      "visible|image",
    );
    const zoom = await call("computer", { action: "zoom", tabId: 1, region: [0, 0, 1, 1] }, 4);
    expect(zoom.error.code).toBe("debugger_refused");
    h.state.captureError = new Error("other");
    expect((await call("computer", { action: "screenshot", tabId: 1 }, 5)).error.message).toBe(
      "other",
    );
    h.state.captureError = undefined;
    expect((await call("computer", { action: "zoom", tabId: 1 }, 6)).error.code).toBe("bad_args");
    expect(
      content(await call("computer", { action: "zoom", tabId: 1, region: [0, 0, 1, 1] }, 7)),
    ).toBe("shot|image");
  });

  it("acts through the tab's input while the recorder marks it as Claude's, and follows the settings' pace", async () => {
    expect(content(await call("computer", { action: "left_click", tabId: 1 }, 2))).toBe("ran");
    expect(h.state.recorder.busy).toHaveBeenCalled();
    h.state.hub.settings.input.pace = "fast";
    expect(
      content(await call("computer", { action: "left_click", tabId: 1, pace: "human" }, 3)),
    ).toBe("ran");
    // A closed tab's input is forgotten.
    expect(content(await call("tabs_close", { tabId: 1 }, 4))).toBe("closed");
  });

  it("gives each input its page hooks and the debugger", async () => {
    await call("computer", { action: "left_click", tabId: 1 }, 2);
    const deps = h.state.inputDeps;
    expect(deps.isMac).toBe(true);
    expect(typeof deps.now()).toBe("number");
    expect(typeof deps.rng()).toBe("number");
    await deps.send("Input.x", {});
    await deps.rect("r");
    await deps.scrollIntoView("r");
    await deps.viewport();
    const sleeping = deps.sleep(10);
    await vi.advanceTimersByTimeAsync(10);
    await sleeping;
  });

  it("resizes the window of the session's tab", async () => {
    expect(content(await call("resize_window", { tabId: 1, width: 800.4, height: 600.2 }, 2))).toBe(
      "Window resized to 800x600",
    );
    expect(fake.calls["windows.update"]?.[0]).toEqual([
      2,
      { width: 800, height: 600, state: "normal" },
    ]);
  });

  it("serves the recordings of the profile to any session", async () => {
    expect(content(await call("recording_list", {}, 2))).toBe("recordings");
    expect(content(await call("recording_get", { id: "a" }, 3))).toBe("recording");
    expect(content(await call("recording_delete", { id: "a" }, 4))).toBe("removed");
  });

  it("replays a step and refuses a call with no step", async () => {
    const step = { type: "click" };
    expect(content(await call("replay_step", { tabId: 1, step }, 2))).toBe("replayed");
    expect((await call("replay_step", { tabId: 1 }, 3)).error.code).toBe("bad_args");
    expect((await call("replay_step", { tabId: 1, step: { type: 1 } }, 4)).error.code).toBe(
      "bad_args",
    );
  });

  it("hands replay what it acts with", async () => {
    const { replayStep } = await import("../src/replay");
    await call("replay_step", { tabId: 1, step: { type: "click" }, pace: "fast" }, 2);
    const deps = (replayStep as Any).mock.calls.at(-1)[0];
    expect(await deps.resolve(1, [])).toBe("page:resolve");
    expect(await deps.act(1, { action: "left_click", tabId: 1 })).toBe("ran");
    await deps.show(1);
    expect(fake.calls["tabs.update"]?.[0]).toEqual([1, { active: true }]);
    expect(await deps.formInput(1, "r", "v")).toBe("page:form_input");
    expect(await deps.scroll(1, "r", 1, 2)).toBe("page:scroll_xy");
    expect(await deps.navigate(1, "https://example.com")).toBe("navigated");
    expect(typeof deps.now()).toBe("number");
    expect(deps.isMac).toBe(true);
    const sleeping = deps.sleep(5);
    await vi.advanceTimersByTimeAsync(5);
    await sleeping;
    const loaded = deps.waitForLoad(1, 100);
    emit("tabs.onUpdated", 1, { status: "complete" });
    expect(await loaded).toBe(true);
    const never = deps.waitForLoad(1, 100);
    emit("tabs.onUpdated", 2, { status: "complete" });
    await vi.advanceTimersByTimeAsync(100);
    expect(await never).toBe(false);
  });
});

describe("what the settings change", () => {
  beforeEach(() => boot());

  it("rebuilds the site rules, speeds, screenshot size and idle time when they change", async () => {
    await call("computer", { action: "left_click", tabId: 1 }, 2);
    h.state.onChange({
      sites: { blocked: ["a.example/*"], read_only: ["b.example/*"] },
      input: { typing_speed: 2, mouse_speed: 2 },
      capture: { screenshot_size: "640x480", screenshot_quality: 50 },
      debugger: { detach_after_idle_s: 5 },
    });
    // The recorder's `blocked` reads the new rules.
    expect(h.state.recorderDeps.blocked("https://a.example/")).toBe(true);
    expect(h.state.recorderDeps.blocked("https://other.example/")).toBe(false);
  });

  it("tells tab tools the settings' window and cleanup choices and which sites are blocked", async () => {
    const [, , , opts] = h.state.tabDeps;
    expect(opts.newWindow()).toBe(false);
    expect(opts.closeTabsOnEnd()).toBe(true);
    h.state.onChange(h.state.hub.settings);
    expect(opts.sites().access("https://blocked.example/")).toBe("blocked");
  });

  it("finds the tabs of browser-hand's groups for the network rules", async () => {
    expect(await h.state.siteDeps.groupTabs()).toEqual([7]);
    expect(h.state.siteDeps.blocked()).toEqual(["blocked.example/*"]);
    await h.state.siteDeps.dnr.getSessionRules();
    await h.state.siteDeps.dnr.updateSessionRules({});
  });

  it("keeps each session's group id in session storage", async () => {
    const [, groups] = h.state.tabDeps;
    expect(await groups.get("s1")).toBeUndefined();
    await groups.set("s1", 4);
    expect(await groups.get("s1")).toBe(4);
    await groups.delete("s1");
    expect(await groups.get("s1")).toBeUndefined();
  });

  it("hands the recorder Chrome's tabs and storage", async () => {
    const d = h.state.recorderDeps;
    expect(await d.tabs.query({ windowId: 2 })).toEqual([{ id: 7, windowId: 2 }]);
    await d.tabs.get(1);
    await d.tabs.sendMessage(1, {});
    expect(typeof d.now()).toBe("number");
  });
});

describe("events", () => {
  beforeEach(() => boot());

  it("toggles recording from the button and the shortcut", async () => {
    emit("action.onClicked", { id: 1 });
    expect(h.state.recorder.toggle).toHaveBeenCalledWith({ id: 1 });
    emit("commands.onCommand", "other", { id: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.recorder.toggle).toHaveBeenCalledTimes(1);
    emit("commands.onCommand", "toggle-recording", { id: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.recorder.toggle).toHaveBeenLastCalledWith({ id: 3 });
    emit("commands.onCommand", "toggle-recording", undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.recorder.toggle).toHaveBeenLastCalledWith({ id: 7, windowId: 2 });
  });

  it("follows navigation, new tabs, group changes and closed windows", async () => {
    emit("webNavigation.onCommitted", { tabId: 1 });
    expect(h.state.tabs.committed).toHaveBeenCalled();
    expect(h.state.recorder.navigated).toHaveBeenCalled();
    emit("webNavigation.onCreatedNavigationTarget", { sourceTabId: 1, tabId: 2 });
    expect(h.state.recorder.openedFrom).toHaveBeenCalledWith(1, 2);
    emit("tabs.onCreated", { id: 3 });
    expect(h.state.recorder.tabCreated).toHaveBeenCalled();
    emit("tabs.onUpdated", 1, { status: "loading" }, { windowId: 2 });
    expect(h.state.recorder.tabUpdated).toHaveBeenCalledWith(1, 2);
    emit("tabs.onUpdated", 1, { groupId: 4 }, { windowId: 2 });
    emit("tabs.onRemoved", 1);
    emit("tabGroups.onUpdated");
    emit("windows.onRemoved", 2);
    expect(h.state.recorder.windowRemoved).toHaveBeenCalledWith(2);
  });

  it("serves the settings page's port only when the hub accepts it", async () => {
    const p = { disconnect: vi.fn() };
    emit("runtime.onConnect", p);
    expect(p.disconnect).not.toHaveBeenCalled();
    h.state.accept = false;
    emit("runtime.onConnect", p);
    expect(p.disconnect).toHaveBeenCalled();
  });
});

describe("messages inside the extension", () => {
  beforeEach(() => boot());

  /** The three onMessage listeners, in the order the worker registers them. */
  const listener = (i: number) => fake.listeners["runtime.onMessage"]?.[i] as Any;
  const tabSender = { id: EXT, tab: { id: 1, windowId: 2, url: "https://example.com/" } };

  it("tells a content script whether its window records, and takes its steps", async () => {
    const reply = vi.fn();
    expect(listener(0)({ __bhRec: "hello" }, tabSender, reply)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reply).toHaveBeenLastCalledWith({ on: true });

    expect(listener(0)({ __bhRec: "step", step: { type: "click" } }, tabSender, reply)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.recorder.step).toHaveBeenCalled();

    h.state.recorder.isRecording.mockRejectedValueOnce(new Error("x"));
    listener(0)({ __bhRec: "hello" }, tabSender, reply);
    await vi.advanceTimersByTimeAsync(0);
    expect(reply).toHaveBeenLastCalledWith({ on: false });
  });

  it("ignores recording messages from other extensions, no tab, or unknown kinds", () => {
    const reply = vi.fn();
    expect(listener(0)({ __bhRec: "hello" }, { ...tabSender, id: "other" }, reply)).toBeUndefined();
    expect(listener(0)({ __bhRec: "hello" }, { id: EXT }, reply)).toBeUndefined();
    expect(listener(0)({ nothing: 1 }, tabSender, reply)).toBeUndefined();
    expect(listener(0)({ __bhRec: "step", step: {} }, tabSender, reply)).toBeUndefined();
    expect(listener(0)({ __bhRec: "other" }, tabSender, reply)).toBeUndefined();
  });

  it("runs the popup's ops only for the popup page and answers with the value or the error", async () => {
    const popup = { id: EXT, url: url("popup.html") };
    const reply = vi.fn();
    expect(listener(1)({ __bhPopup: "list" }, popup, reply)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reply).toHaveBeenLastCalledWith({ ok: true, value: "recordings" });

    listener(1)({ __bhPopup: "get" }, popup, reply);
    await vi.advanceTimersByTimeAsync(0);
    expect(reply).toHaveBeenLastCalledWith({ ok: false, error: "Needs a recording id." });

    h.state.recorder.stop.mockRejectedValueOnce("odd");
    listener(1)({ __bhPopup: "stop" }, popup, reply);
    await vi.advanceTimersByTimeAsync(0);
    expect(reply).toHaveBeenLastCalledWith({ ok: false, error: "odd" });

    listener(1)({ __bhPopup: "start", windowId: 2 }, popup, reply);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.recorder.start).toHaveBeenCalled();

    expect(listener(1)({ __bhPopup: "list" }, tabSender, reply)).toBeUndefined();
    expect(listener(1)({ other: 1 }, popup, reply)).toBeUndefined();
  });

  it("takes a claim only from the claim page and saves the profile dir", async () => {
    const claim = { id: EXT, url: `${url("claim.html")}#dir=Default&nonce=n` };
    const reply = vi.fn();
    const msg = { type: "claim", dir: "Profile 3", nonce: "n1" };
    expect(listener(2)(msg, claim, reply)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.store.profileDir).toBe("Profile 3");
    expect(fake.posted).toContainEqual({ type: "claimed", profileDir: "Profile 3", nonce: "n1" });
    expect(reply).toHaveBeenLastCalledWith({ ok: true });

    expect(listener(2)(msg, { id: EXT, url: "https://example.com/" }, reply)).toBeUndefined();
    expect(listener(2)(msg, { id: "other", url: claim.url }, reply)).toBeUndefined();
    expect(listener(2)({ type: "claim", dir: 1 }, claim, reply)).toBeUndefined();
    expect(listener(2)({ type: "other" }, claim, reply)).toBeUndefined();
  });

  it("says the claim failed when saving it throws", async () => {
    fake.values["storage.local.set"] = () => Promise.reject(new Error("full"));
    const claim = { id: EXT, url: `${url("claim.html")}#x` };
    const reply = vi.fn();
    listener(2)({ type: "claim", dir: "D", nonce: "n" }, claim, reply);
    await vi.advanceTimersByTimeAsync(0);
    expect(reply).toHaveBeenLastCalledWith({ ok: false, error: "Error: full" });
  });
});
