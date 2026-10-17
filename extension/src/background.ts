// Service worker: holds the native port to browser-hand, answers calls, and
// takes profile claims from claim.html (`docs/protocol.md`).
import { TabTools, type GroupStore } from "./tabs";
import { PROTOCOL, Reassembler, ToolError, err, ok, text, type CallFrame, type Frame } from "./wire";

const HOST = "dev.browserhand.host";
const MAX_RETRY_MS = 30_000;

let port: chrome.runtime.Port | null = null;
let retryMs = 1000;
const reassembler = new Reassembler();

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

const tabs = new TabTools(chrome, groups, waitForLoad);

type Tool = (session: string, args: any) => Promise<unknown>;
const tools: Record<string, Tool> = {
  tabs_context: (s, a) => tabs.tabsContext(s, a),
  tabs_create: (s) => tabs.tabsCreate(s),
  tabs_close: (s, a) => tabs.tabsClose(s, a),
  navigate: (s, a) => tabs.navigate(s, a),
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
    post(ok(call.id, [text(result)]));
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
}

function connect() {
  if (port) return;
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener(onFrame);
  port.onDisconnect.addListener(() => {
    console.warn("browser-hand: native port closed:", chrome.runtime.lastError?.message);
    port = null;
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  });
  void hello();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
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
