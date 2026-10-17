// The tab tools. Every session owns one tab group titled "browser-hand" in
// this profile and may only touch tabs inside it.
import { ToolError } from "./wire";

export const GROUP_TITLE = "browser-hand";

type Api = {
  tabs: Pick<typeof chrome.tabs, "get" | "query" | "create" | "remove" | "update" | "group" | "goBack" | "goForward">;
  tabGroups: Pick<typeof chrome.tabGroups, "get" | "update">;
  windows: Pick<typeof chrome.windows, "create">;
};

/** session -> tab group id, kept across service worker restarts. */
export interface GroupStore {
  get(session: string): Promise<number | undefined>;
  set(session: string, groupId: number): Promise<void>;
  delete(session: string): Promise<void>;
}

export type WaitForLoad = (tabId: number, timeoutMs: number) => Promise<boolean>;

export interface TabInfo {
  tabId: number;
  title: string;
  url: string;
  active: boolean;
}

const NAVIGATE_TIMEOUT_MS = 30_000;

export class TabTools {
  constructor(
    private api: Api,
    private store: GroupStore,
    private waitForLoad: WaitForLoad,
  ) {}

  /** The session's live group id, forgetting one the user has closed. */
  private async group(session: string): Promise<number | undefined> {
    const id = await this.store.get(session);
    if (id === undefined) return undefined;
    try {
      await this.api.tabGroups.get(id);
      return id;
    } catch {
      await this.store.delete(session);
      return undefined;
    }
  }

  /** A new window holding one empty tab, grouped for this session. */
  private async createGroup(session: string): Promise<{ groupId: number; tabId: number }> {
    const win = await this.api.windows.create({ focused: false, url: "about:blank" });
    const tabId = win?.tabs?.[0]?.id;
    if (win?.id === undefined || tabId === undefined) {
      throw new ToolError("page_error", "Chrome did not open a window for the tab group");
    }
    const groupId = await this.api.tabs.group({ tabIds: [tabId], createProperties: { windowId: win.id } });
    await this.api.tabGroups.update(groupId, { title: GROUP_TITLE, color: "orange" });
    await this.store.set(session, groupId);
    return { groupId, tabId };
  }

  private async list(groupId: number): Promise<TabInfo[]> {
    const tabs = await this.api.tabs.query({ groupId });
    return tabs
      .filter((t) => t.id !== undefined)
      .map((t) => ({ tabId: t.id!, title: t.title ?? "", url: t.url ?? "", active: t.active }));
  }

  /** Throws `no_tab` unless the tab exists and is in the session's group. */
  private async ownTab(session: string, tabId: number): Promise<chrome.tabs.Tab> {
    const groupId = await this.group(session);
    let tab: chrome.tabs.Tab;
    try {
      tab = await this.api.tabs.get(tabId);
    } catch {
      throw new ToolError("no_tab", `Tab ${tabId} does not exist. Call tabs_context for current tab ids.`);
    }
    if (groupId === undefined || tab.groupId !== groupId) {
      throw new ToolError("no_tab", `Tab ${tabId} is not in this session's ${GROUP_TITLE} group. Call tabs_context for current tab ids.`);
    }
    return tab;
  }

  async tabsContext(session: string, args: { createIfEmpty?: boolean }) {
    let groupId = await this.group(session);
    if (groupId === undefined) {
      if (!args.createIfEmpty) {
        return { tabs: [], note: `No ${GROUP_TITLE} tab group for this session yet. Call tabs_context with createIfEmpty: true, or tabs_create.` };
      }
      groupId = (await this.createGroup(session)).groupId;
    }
    return { groupId, tabs: await this.list(groupId) };
  }

  async tabsCreate(session: string) {
    const groupId = await this.group(session);
    if (groupId === undefined) {
      const { tabId } = await this.createGroup(session);
      return { tabId };
    }
    const { windowId } = await this.api.tabGroups.get(groupId);
    const tab = await this.api.tabs.create({ windowId, active: true });
    if (tab.id === undefined) throw new ToolError("page_error", "Chrome did not create the tab");
    await this.api.tabs.group({ tabIds: [tab.id], groupId });
    return { tabId: tab.id };
  }

  async tabsClose(session: string, args: { tabId: number }) {
    await this.ownTab(session, args.tabId);
    await this.api.tabs.remove(args.tabId);
    // Chrome drops a group with no tabs; forget it if that just happened.
    await this.group(session);
    return { closed: args.tabId };
  }

  async navigate(session: string, args: { url: string; tabId?: number }) {
    let tabId = args.tabId;
    let context: unknown;
    if (tabId === undefined) {
      if (args.url === "back" || args.url === "forward") {
        throw new ToolError("bad_args", `tabId is required for url "${args.url}"`);
      }
      const ctx = await this.tabsContext(session, { createIfEmpty: true });
      tabId = ctx.tabs[0]?.tabId;
      if (tabId === undefined) throw new ToolError("no_tab", "The session's tab group has no tabs");
      context = ctx;
    }
    await this.ownTab(session, tabId);

    if (args.url === "back") await this.api.tabs.goBack(tabId);
    else if (args.url === "forward") await this.api.tabs.goForward(tabId);
    else await this.api.tabs.update(tabId, { url: normaliseUrl(args.url) });

    const loaded = await this.waitForLoad(tabId, NAVIGATE_TIMEOUT_MS);
    const tab = await this.api.tabs.get(tabId);
    const result: Record<string, unknown> = { tabId, url: tab.url ?? "", title: tab.title ?? "" };
    if (!loaded) result.note = `Still loading after ${NAVIGATE_TIMEOUT_MS / 1000} s`;
    if (context !== undefined) result.tabContext = context;
    return result;
  }

  /** The MCP session went away: forget its group, leave its tabs open. */
  async end(session: string) {
    await this.store.delete(session);
  }
}

/** Adds https:// when no scheme is given, as the reference navigate does. */
export function normaliseUrl(url: string): string {
  const trimmed = url.trim();
  // "localhost:3000" has a colon but no scheme, so require "//" or a
  // scheme that never has one.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^(about|data|blob|mailto):/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}
