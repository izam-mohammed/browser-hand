// Service worker: holds the native port to browser-hand, answers calls,
// takes profile claims from claim.html (`docs/protocol.md`), runs the
// toolbar button and its popup that record the person's steps
// (`recorder.ts`, plans/08-recorder-popup.md), and
// applies the settings the native host sends, serving the settings page
// (`settings.ts`, plans/06-settings.md).
import { DebuggerManager } from "./debugger";
import { type Params, scaledParams } from "./humane/params";
import { seeded } from "./humane/random";
import { type ComputerArgs, Input, type Pace, type Rect } from "./input";
import { NetworkLog } from "./network";
import type { RecMsg } from "./page/content";
import type { Step } from "./page/record";
import { toPage } from "./page-client";
import {
  fromPopup,
  POPUP,
  type PopupMsg,
  type PopupReply,
  popupOp,
  Recorder,
  type RecorderDeps,
  type TabLike,
} from "./recorder";
import { type ReplayDeps, type Resolved, replayStep } from "./replay";
import {
  type Around,
  capture,
  captureVisible,
  DEFAULT_SHOT,
  type Shot,
  type ShotPrefs,
  shotPrefs,
} from "./screenshot";
import { type PortLike, SettingsHub } from "./settings";
import { SiteRuleSync } from "./site-rules";
import { SiteRules, useFor } from "./sites";
import { GROUP_TITLE, type GroupStore, TabTools } from "./tabs";
import { type WaitArgs, type WaitDeps, waitFor } from "./wait";
import {
  type CallFrame,
  type Content,
  err,
  type Frame,
  ok,
  PROTOCOL,
  Reassembler,
  ToolError,
  text,
} from "./wire";

const HOST = "dev.browserhand.host";
const MAX_RETRY_MS = 30_000;
const JS_RESULT_MAX = 50_000;

let port: chrome.runtime.Port | null = null;
let retryMs = 1000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const reassembler = new Reassembler();

const hub = new SettingsHub({
  local: chrome.storage.local,
  post(frame) {
    if (!port) return false;
    port.postMessage(frame);
    return true;
  },
  reconnect,
  version: chrome.runtime.getManifest().version,
  extensionId: chrome.runtime.id,
  optionsUrl: chrome.runtime.getURL("options.html"),
});
/** What the settings make of the tools, rebuilt when they change. */
let sites = new SiteRules();
let params: Params = scaledParams();
let shot: ShotPrefs = DEFAULT_SHOT;
const pace = (asked?: Pace): Pace =>
  asked ?? (hub.settings.input.pace === "fast" ? "fast" : "human");

const groups: GroupStore = {
  async get(session) {
    const key = `group:${session}`;
    return (await chrome.storage.session.get(key))[key] as number | undefined;
  },
  async set(session, groupId) {
    await chrome.storage.session.set({ [`group:${session}`]: groupId });
  },
  async delete(session) {
    await chrome.storage.session.remove(`group:${session}`);
  },
};

function waitForLoad(tabId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (loaded: boolean) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(loaded);
    };
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const tabs = new TabTools(chrome, groups, waitForLoad, {
  sites: () => sites,
  newWindow: () => hub.settings.sessions.new_window,
  closeTabsOnEnd: () => hub.settings.sessions.close_tabs_on_end,
});
const dbg = new DebuggerManager(chrome.debugger);
const network = new NetworkLog();
network.attach(chrome.webRequest, chrome.tabs);

let isMac = false;
chrome.runtime.getPlatformInfo().then((info) => (isMac = info.os === "mac"));

const inputs = new Map<number, Input>();
chrome.tabs.onRemoved.addListener((tabId) => inputs.delete(tabId));

function inputFor(tabId: number): Input {
  let input = inputs.get(tabId);
  if (!input) {
    input = new Input(
      {
        send: (method, params) => dbg.send(tabId, method, params),
        sleep,
        now: () => performance.now(),
        rng: seeded((Date.now() ^ (tabId * 2654435761)) >>> 0),
        get isMac() {
          return isMac;
        },
        rect: (ref) => toPage<Rect>(tabId, { op: "rect", ref }),
        scrollIntoView: async (ref) => void (await toPage(tabId, { op: "scroll_into_view", ref })),
        viewport: () => toPage<{ width: number; height: number }>(tabId, { op: "viewport" }),
        // A page without the content script (chrome://) has no overlay; the move still happens.
        cursor: (path, intervalMs) =>
          void toPage(tabId, { op: "cursor_move", path, intervalMs }).catch(() => {}),
      },
      params,
    );
    inputs.set(tabId, input);
  }
  return input;
}

/** Hides and shows the tab's cursor overlay around a capture; never fails. */
const cursorAround = (tabId: number): Around => ({
  hide: () =>
    toPage(tabId, { op: "cursor_hide" }).then(
      () => {},
      () => {},
    ),
  show: () =>
    toPage(tabId, { op: "cursor_show" }).then(
      () => {},
      () => {},
    ),
});

const recorder = new Recorder({
  action: chrome.action,
  tabs: {
    query: (q) => chrome.tabs.query(q),
    get: (tabId) => chrome.tabs.get(tabId) as Promise<TabLike>,
    sendMessage: (tabId, msg) => chrome.tabs.sendMessage(tabId, msg),
  },
  local: chrome.storage.local as unknown as RecorderDeps["local"],
  session: chrome.storage.session as unknown as RecorderDeps["session"],
  now: () => Date.now(),
  blocked: (url) => sites.access(url) === "blocked",
});
// Chrome may not keep a global popup value while the worker sleeps.
void recorder.syncPopup();

/** Blocked sites as network rules on the tabs of browser-hand groups. */
const siteRules = new SiteRuleSync({
  dnr: {
    getSessionRules: () => chrome.declarativeNetRequest.getSessionRules(),
    updateSessionRules: (o) =>
      chrome.declarativeNetRequest.updateSessionRules(
        o as chrome.declarativeNetRequest.UpdateRuleOptions,
      ),
  },
  async groupTabs() {
    const found = await chrome.tabGroups.query({ title: GROUP_TITLE });
    const lists = await Promise.all(found.map((g) => chrome.tabs.query({ groupId: g.id })));
    return lists
      .flat()
      .map((t) => t.id)
      .filter((id): id is number => id !== undefined);
  },
  blocked: () => hub.settings.sites.blocked,
  allowed: () => hub.settings.sites.allowed,
});

hub.onChange((s) => {
  sites = new SiteRules(s.sites.blocked, s.sites.read_only, s.sites.allowed);
  params = scaledParams(s.input.typing_speed, s.input.mouse_speed);
  for (const input of inputs.values()) input.setParams(params);
  shot = shotPrefs(s.capture.screenshot_size, s.capture.screenshot_quality);
  dbg.setIdleMs(s.debugger.detach_after_idle_s * 1000);
  void siteRules.update();
});
void hub.load();

/** Replay acts through the tab's `Input`, marked as Claude's while it does. */
function replayDeps(session: string, pace: Pace): ReplayDeps {
  return {
    resolve: (tabId, selectors) => toPage<Resolved>(tabId, { op: "resolve", selectors }),
    act: (tabId, args) => recorder.busy(tabId, () => inputFor(tabId).run(args, pace)),
    show: async (tabId) => {
      if (!(await chrome.tabs.get(tabId)).active) await chrome.tabs.update(tabId, { active: true });
    },
    formInput: (tabId, ref, value) =>
      recorder.busy(tabId, () => toPage(tabId, { op: "form_input", ref, value })),
    scroll: (tabId, ref, x, y) => toPage(tabId, { op: "scroll_xy", ref, x, y }),
    navigate: (tabId, url) => tabs.navigate(session, { tabId, url }),
    waitForLoad,
    sleep,
    now: () => Date.now(),
    get isMac() {
      return isMac;
    },
  };
}

/** A tool answers with content blocks; a plain value becomes one text block. */
// biome-ignore lint/suspicious/noExplicitAny: each tool checks its own args at runtime.
type Tool = (session: string, args: any) => Promise<unknown>;

const shotContent = (s: Shot): Content[] => [
  text(s.text),
  { type: "image", data: s.data, mimeType: s.mimeType },
];

async function screenshot(
  session: string,
  tabId: number,
  opts: { scale?: number; region?: [number, number, number, number] },
) {
  const tab = await tabs.ownTab(session, tabId, "read");
  try {
    return await capture(dbg, tabId, opts, shot, cursorAround(tabId));
  } catch (e) {
    if (e instanceof ToolError && e.code === "debugger_refused" && !opts.region) {
      const around = cursorAround(tabId);
      await around.hide();
      try {
        return await captureVisible(tab, shot);
      } finally {
        await around.show();
      }
    }
    throw e;
  }
}

async function javascript(session: string, a: { text: string; tabId: number }) {
  await tabs.ownTab(session, a.tabId, useFor("javascript_tool"));
  const r = await dbg.send<{
    result?: { type: string; value?: unknown; description?: string };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>(a.tabId, "Runtime.evaluate", {
    expression: a.text,
    replMode: true,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new ToolError(
      "page_error",
      r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
    );
  }
  const res = r.result;
  let out: string;
  if (!res || res.type === "undefined") out = "undefined";
  else if ("value" in res)
    out = typeof res.value === "string" ? res.value : JSON.stringify(res.value, null, 2);
  else out = res.description ?? res.type;
  return out.length > JS_RESULT_MAX
    ? `${out.slice(0, JS_RESULT_MAX)}\n[truncated: ${out.length} characters]`
    : out;
}

/** What `wait_for` reads: the page's text and refs through the content
 * script, the URL from the tab. A ref the page lost is `false`, not an error. */
const waitDeps: WaitDeps = {
  pageText: async (tabId) => String(await toPage(tabId, { op: "text" })),
  hasRef: async (tabId, ref) => {
    try {
      await toPage(tabId, { op: "rect", ref });
      return true;
    } catch (e) {
      if (e instanceof ToolError && /not on the page any more/.test(e.message)) return false;
      throw e;
    }
  },
  url: async (tabId) => (await chrome.tabs.get(tabId)).url ?? "",
  sleep,
  now: () => Date.now(),
};

const tools: Record<string, Tool> = {
  tabs_context: (s, a) => tabs.tabsContext(s, a),
  tabs_create: (s) => tabs.tabsCreate(s),
  tabs_close: async (s, a) => {
    const r = await tabs.tabsClose(s, a);
    inputs.delete(a.tabId);
    return r;
  },
  navigate: (s, a) => tabs.navigate(s, a),

  read_page: async (s, a) => {
    await tabs.ownTab(s, a.tabId, useFor("read_page"));
    return toPage(a.tabId, {
      op: "read_page",
      filter: a.filter,
      depth: a.depth,
      ref_id: a.ref_id,
      max_chars: a.max_chars,
    });
  },
  find: async (s, a) => {
    await tabs.ownTab(s, a.tabId, useFor("find"));
    return toPage(a.tabId, { op: "find", query: a.query });
  },
  wait_for: async (s, a: WaitArgs) => {
    await tabs.ownTab(s, a.tabId, useFor("wait_for"));
    return waitFor(waitDeps, a);
  },
  get_page_text: async (s, a) => {
    await tabs.ownTab(s, a.tabId, useFor("get_page_text"));
    return toPage(a.tabId, { op: "text" });
  },
  read_console_messages: async (s, a) => {
    await tabs.ownTab(s, a.tabId, useFor("read_console_messages"));
    return toPage(a.tabId, {
      op: "console",
      pattern: a.pattern,
      onlyErrors: a.onlyErrors,
      limit: a.limit,
      clear: a.clear,
    });
  },
  read_network_requests: async (s, a) => {
    await tabs.ownTab(s, a.tabId, useFor("read_network_requests"));
    return network.read(a.tabId, a);
  },
  form_input: async (s, a) => {
    await tabs.ownTab(s, a.tabId, useFor("form_input"));
    return toPage(a.tabId, { op: "form_input", ref: a.ref, value: a.value });
  },
  javascript_tool: (s, a) => javascript(s, a),
  file_upload: async (s, a) => {
    await tabs.ownTab(s, a.tabId, useFor("file_upload"));
    return toPage(a.tabId, { op: "set_files", ref: a.ref, files: a.files });
  },
  upload_image: async (s, a) => {
    await tabs.ownTab(s, a.tabId, useFor("upload_image"));
    const files = [{ name: a.filename ?? "image.png", mimeType: a.mimeType, data: a.data }];
    if (a.ref) return toPage(a.tabId, { op: "set_files", ref: a.ref, files });
    if (!a.coordinate) throw new ToolError("bad_args", "upload_image needs ref or coordinate");
    return toPage(a.tabId, { op: "drop_files", x: a.coordinate[0], y: a.coordinate[1], files });
  },

  computer: async (
    s,
    a: ComputerArgs & {
      tabId: number;
      pace?: Pace;
      scale?: number;
      region?: [number, number, number, number];
    },
  ) => {
    if (a.action === "screenshot")
      return shotContent(await screenshot(s, a.tabId, { scale: a.scale }));
    if (a.action === "zoom") {
      if (!a.region) throw new ToolError("bad_args", "zoom needs region [x0, y0, x1, y1]");
      return shotContent(await screenshot(s, a.tabId, { scale: a.scale, region: a.region }));
    }
    await tabs.ownTab(s, a.tabId, useFor("computer", a));
    return recorder.busy(a.tabId, () => inputFor(a.tabId).run(a, pace(a.pace)));
  },
  resize_window: async (s, a) => {
    const tab = await tabs.ownTab(s, a.tabId, useFor("resize_window"));
    const win = await chrome.windows.update(tab.windowId, {
      width: Math.round(a.width),
      height: Math.round(a.height),
      state: "normal",
    });
    return `Window resized to ${win.width}x${win.height}`;
  },

  // Recordings are the profile's, not the session's: any session reads them.
  recording_list: () => recorder.list(),
  recording_get: (_s, a: { id?: string }) => recorder.get(a.id),
  recording_delete: (_s, a: { id: string }) => recorder.remove(a.id),
  replay_step: async (s, a: { tabId: number; step: Step; pace?: Pace }) => {
    await tabs.ownTab(s, a.tabId, useFor("replay_step"));
    if (!a.step || typeof a.step.type !== "string")
      throw new ToolError("bad_args", "replay_step needs a step");
    return replayStep(replayDeps(s, pace(a.pace)), a.tabId, a.step);
  },
};

function post(frame: Frame) {
  port?.postMessage(frame);
}

async function hello() {
  const { profileDir = null } = await chrome.storage.local.get("profileDir");
  post({
    type: "hello",
    protocol: PROTOCOL,
    profileDir: profileDir as string | null,
    extensionVersion: chrome.runtime.getManifest().version,
    instance: "",
  });
}

async function handleCall(call: CallFrame) {
  const tool = tools[call.tool];
  if (!tool) return post(err(call.id, "bad_args", `Unknown tool: ${call.tool}`));
  try {
    const result = await tool(call.session, call.args ?? {});
    const content = Array.isArray(result) ? (result as Content[]) : [text(result)];
    post(ok(call.id, content));
  } catch (e) {
    if (e instanceof ToolError) post(err(call.id, e.code, e.message));
    else post(err(call.id, "page_error", e instanceof Error ? e.message : String(e)));
  }
}

function onFrame(raw: Frame) {
  retryMs = 1000;
  let frame: Frame | null;
  try {
    frame = reassembler.push(raw);
  } catch (e) {
    console.warn("browser-hand: dropped a chunked frame", e);
    return;
  }
  if (!frame) return;
  if (frame.type === "call") void handleCall(frame);
  else if (frame.type === "end") void tabs.end(frame.session);
  else if (frame.type === "settings" || frame.type === "settings_saved") hub.onFrame(frame);
  // `browser-hand reload` after a build: pick up the new files from disk.
  else if (frame.type === "reload") chrome.runtime.reload();
}

function connect() {
  if (port) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const p = chrome.runtime.connectNative(HOST);
  port = p;
  p.onMessage.addListener(onFrame);
  p.onDisconnect.addListener(() => {
    const why = chrome.runtime.lastError?.message;
    console.warn("browser-hand: native port closed:", why);
    if (port !== p) return; // replaced by reconnect
    port = null;
    hub.portClosed(why);
    retryTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  });
  hub.portOpened();
  void hello();
}

/** The settings page's Retry: a fresh port now, not at the next backoff. */
function reconnect() {
  retryMs = 1000;
  const old = port;
  port = null;
  old?.disconnect();
  connect();
}

// Recording: the button, the shortcut, and what moves tabs in and out. The
// button reaches onClicked only while recording; otherwise it opens the popup.
chrome.action.onClicked.addListener((tab) => void recorder.toggle(tab as TabLike));
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-recording") return;
  const target = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (target) await recorder.toggle(target as TabLike);
});
chrome.webNavigation.onCommitted.addListener((d) => {
  void tabs.committed(d);
  void recorder.navigated(d);
});
chrome.webNavigation.onCreatedNavigationTarget.addListener(
  (d) => void recorder.openedFrom(d.sourceTabId, d.tabId),
);
chrome.tabs.onCreated.addListener((tab) => void recorder.tabCreated(tab as TabLike));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "loading") void recorder.tabUpdated(tabId, tab.windowId);
  if (info.groupId !== undefined) void siteRules.update();
});
chrome.tabs.onRemoved.addListener(() => void siteRules.update());
chrome.tabGroups.onUpdated.addListener(() => void siteRules.update());

// The settings page (options.html) talks to the hub over a port.
chrome.runtime.onConnect.addListener((p) => {
  if (!hub.accept(p as unknown as PortLike)) p.disconnect();
});
chrome.windows.onRemoved.addListener((windowId) => void recorder.windowRemoved(windowId));

// Content scripts ask whether their window records, and send steps.
chrome.runtime.onMessage.addListener((msg: RecMsg, sender, reply) => {
  const tab = sender.tab;
  if (sender.id !== chrome.runtime.id || tab?.id === undefined || typeof msg?.__bhRec !== "string")
    return;
  let on: Promise<boolean>;
  if (msg.__bhRec === "hello") on = recorder.isRecording(tab.windowId);
  else if (msg.__bhRec === "step" && typeof msg.step?.type === "string")
    on = recorder.step(tab.id, tab.windowId, msg, sender.url ?? tab.url);
  else return;
  on.then(
    (v) => reply({ on: v }),
    () => reply({ on: false }),
  );
  return true;
});

// The toolbar popup lists, opens, deletes and starts recordings.
chrome.runtime.onMessage.addListener((msg: PopupMsg, sender, reply: (r: PopupReply) => void) => {
  if (
    typeof msg?.__bhPopup !== "string" ||
    !fromPopup(sender, chrome.runtime.id, chrome.runtime.getURL(POPUP))
  )
    return;
  const activeTab = async (windowId: number) =>
    (await chrome.tabs.query({ active: true, windowId }))[0] as TabLike | undefined;
  popupOp(recorder, msg, activeTab).then(
    (value) => reply({ ok: true, value }),
    (e) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Only the extension's own claim page may claim.
  if (
    sender.id !== chrome.runtime.id ||
    sender.url?.startsWith(chrome.runtime.getURL("claim.html")) !== true
  )
    return;
  if (msg?.type !== "claim" || typeof msg.dir !== "string" || typeof msg.nonce !== "string") return;
  (async () => {
    await chrome.storage.local.set({ profileDir: msg.dir });
    connect();
    post({ type: "claimed", profileDir: msg.dir, nonce: msg.nonce });
    await hello();
    reply({ ok: true });
  })().catch((e) => reply({ ok: false, error: String(e) }));
  return true;
});

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
