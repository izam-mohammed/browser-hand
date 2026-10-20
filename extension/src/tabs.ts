// The tab tools. Every session owns one tab group titled "browser-hand" in
// this profile and may only touch tabs inside it, and never a site the
// settings block, nor act on one they make read-only (plans/06-settings.md).
import { SiteRules, gate, type Use } from "./sites";
import { ToolError } from "./wire";

export const GROUP_TITLE = "browser-hand";

type Api = {
  tabs: Pick<typeof chrome.tabs, "get" | "query" | "create" | "remove" | "update" | "group" | "goBack" | "goForward">;
  tabGroups: Pick<typeof chrome.tabGroups, "get" | "update">;
  windows: Pick<typeof chrome.windows, "create" | "getLastFocused">;
};

/** What the settings decide for the tab tools; the defaults are the
 * behaviour from before the settings. */
export interface TabOptions {
  sites?: () => SiteRules;
  /** Off: a session's group starts in the last focused window. */
  newWindow?: () => boolean;
  /** On: a session's tabs close when it ends. */
  closeTabsOnEnd?: () => boolean;
}

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
  /** The settings block this tab's site: its title and URL are left out. */
  blocked?: true;
}

const NAVIGATE_TIMEOUT_MS = 30_000;

export class TabTools {
  constructor(
    private api: Api,
    private store: GroupStore,
    private waitForLoad: WaitForLoad,
    private opts: TabOptions = {},
  ) {}

  private sites(): SiteRules {
    return this.opts.sites?.() ?? new SiteRules();
  }

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

  /** The person's last focused normal window, when the settings want the
   * group there and there is one. */
  private async currentWindow(): Promise<number | undefined> {
    if (this.opts.newWindow?.() ?? true) return undefined;
    try {
      return (await this.api.windows.getLastFocused({ windowTypes: ["normal"] })).id;
    } catch {
      return undefined; // no window open: make one
    }
  }

  /** One empty tab, grouped for this session: in a new window, or in the
   * person's current one (in the background) when the settings say so. */
  private async createGroup(session: string): Promise<{ groupId: number; tabId: number }> {
    let windowId = await this.currentWindow();
    let tabId: number | undefined;
    if (windowId !== undefined) {
      tabId = (await this.api.tabs.create({ windowId, url: "about:blank", active: false })).id;
    } else {
      const win = await this.api.windows.create({ focused: false, url: "about:blank" });
      windowId = win?.id;
      tabId = win?.tabs?.[0]?.id;
    }
    if (windowId === undefined || tabId === undefined) {
      throw new ToolError("page_error", "Chrome did not open a window for the tab group");
    }
    const groupId = await this.api.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
    await this.api.tabGroups.update(groupId, { title: GROUP_TITLE, color: "orange" });
    await this.store.set(session, groupId);
    return { groupId, tabId };
  }

  private async list(groupId: number): Promise<TabInfo[]> {
    const tabs = await this.api.tabs.query({ groupId });
    const sites = this.sites();
    return tabs
      .filter((t) => t.id !== undefined)
      .map((t) =>
        sites.access(t.url) === "blocked" || sites.access(t.pendingUrl) === "blocked"
          ? { tabId: t.id!, title: "", url: "", active: t.active, blocked: true as const }
          : { tabId: t.id!, title: t.title ?? "", url: t.url ?? "", active: t.active },
      );
  }

  /** Throws `no_tab` unless the tab exists and is in the session's group,
   * and `blocked` when the settings refuse `use` on its site. */
  async ownTab(session: string, tabId: number, use: Use = "act"): Promise<chrome.tabs.Tab> {
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
    const sites = this.sites();
    gate(sites, tab.url, use);
    gate(sites, tab.pendingUrl, use);
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
    await this.ownTab(session, args.tabId, "any");
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
    // Leaving a site is never refused; arriving at a blocked one is.
    await this.ownTab(session, tabId, "any");
    const target = args.url === "back" || args.url === "forward" ? undefined : normaliseUrl(args.url);
    if (target !== undefined) gate(this.sites(), target, "read");

    // Listen before navigating: a cached page can finish loading before
    // update resolves, and a fragment-only change never reports complete.
    const load = this.waitForLoad(tabId, NAVIGATE_TIMEOUT_MS);
    if (args.url === "back") await this.api.tabs.goBack(tabId);
    else if (args.url === "forward") await this.api.tabs.goForward(tabId);
    else await this.api.tabs.update(tabId, { url: target });

    let tab = await this.api.tabs.get(tabId);
    const loaded = tab.status === "complete" || (await load);
    if (tab.status !== "complete") tab = await this.api.tabs.get(tabId);
    // A redirect (or history) can land on a blocked site the URL did not name.
    if (this.sites().access(tab.url) === "blocked") {
      const host = hostOf(tab.url);
      await this.api.tabs.update(tabId, { url: "about:blank" });
      throw new ToolError("blocked", `${host} is blocked in browser-hand settings; ask the person. The tab was sent to about:blank.`);
    }
    const result: Record<string, unknown> = { tabId, url: tab.url ?? "", title: tab.title ?? "" };
    if (!loaded) result.note = `Still loading after ${NAVIGATE_TIMEOUT_MS / 1000} s`;
    if (context !== undefined) result.tabContext = context;
    return result;
  }

  /** The MCP session went away: forget its group, and close its tabs when
   * the settings say so (else they stay open for the person). */
  async end(session: string) {
    const groupId = await this.group(session);
    await this.store.delete(session);
    if (groupId === undefined || !(this.opts.closeTabsOnEnd?.() ?? false)) return;
    const ids = (await this.api.tabs.query({ groupId })).map((t) => t.id).filter((id): id is number => id !== undefined);
    if (ids.length) await this.api.tabs.remove(ids);
  }

  /** A top-frame load in any tab (webNavigation.onCommitted). A tab of a
   * browser-hand group that lands on a blocked site before its network
   * rule exists (a new tab opened from a group tab) is closed; an older
   * one goes to about:blank. */
  async committed(d: { tabId: number; frameId: number; url: string }) {
    if (d.frameId !== 0 || this.sites().access(d.url) !== "blocked") return;
    let tab: chrome.tabs.Tab;
    try {
      tab = await this.api.tabs.get(d.tabId);
      if (tab.groupId === undefined || tab.groupId < 0) return;
      if ((await this.api.tabGroups.get(tab.groupId)).title !== GROUP_TITLE) return;
    } catch {
      return; // gone already
    }
    if (tab.openerTabId !== undefined) await this.api.tabs.remove(d.tabId);
    else await this.api.tabs.update(d.tabId, { url: "about:blank" });
  }
}

function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").hostname || "this site";
  } catch {
    return "this site";
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
