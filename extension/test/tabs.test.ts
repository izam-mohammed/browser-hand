import { beforeEach, describe, expect, it } from "vitest";
import { SiteRules } from "../src/sites";
import { GROUP_TITLE, type GroupStore, normaliseUrl, type TabOptions, TabTools } from "../src/tabs";
import { ToolError } from "../src/wire";

type FakeTab = {
  id: number;
  windowId: number;
  groupId: number;
  url: string;
  title: string;
  active: boolean;
  status?: string;
  openerTabId?: number;
};
type FakeGroup = { id: number; windowId: number; title?: string; color?: string };

/** Just enough of chrome.tabs / tabGroups / windows, in memory. */
function fakeChrome() {
  let next = 100;
  const tabs = new Map<number, FakeTab>();
  const groups = new Map<number, FakeGroup>();
  /** The status a tab reports right after update, as Chrome would; and
   * where a URL redirects to, as a server would. */
  const load = { status: "loading", redirects: new Map<string, string>() };
  /** The person's own window, holding one tab of theirs. */
  const personal: FakeTab = {
    id: next++,
    windowId: 1,
    groupId: -1,
    url: "https://news.test/",
    title: "News",
    active: true,
  };
  tabs.set(personal.id, personal);
  const dropEmptyGroups = () => {
    for (const g of groups.values()) {
      if (![...tabs.values()].some((t) => t.groupId === g.id)) groups.delete(g.id);
    }
  };
  const api = {
    windows: {
      async create(_: object) {
        const windowId = next++;
        const tab: FakeTab = {
          id: next++,
          windowId,
          groupId: -1,
          url: "about:blank",
          title: "",
          active: true,
        };
        tabs.set(tab.id, tab);
        return { id: windowId, tabs: [{ id: tab.id }] };
      },
      async getLastFocused(_: object) {
        return { id: 1 };
      },
    },
    tabs: {
      async get(id: number) {
        const t = tabs.get(id);
        if (!t) throw new Error(`No tab with id: ${id}.`);
        return { ...t };
      },
      async query(q: { groupId: number }) {
        return [...tabs.values()].filter((t) => t.groupId === q.groupId).map((t) => ({ ...t }));
      },
      async create(p: { windowId: number; active?: boolean }) {
        const t: FakeTab = {
          id: next++,
          windowId: p.windowId,
          groupId: -1,
          url: "about:blank",
          title: "",
          active: p.active ?? true,
        };
        tabs.set(t.id, t);
        return { ...t };
      },
      async remove(id: number | number[]) {
        for (const i of Array.isArray(id) ? id : [id]) tabs.delete(i);
        dropEmptyGroups();
      },
      async update(id: number, p: { url: string }) {
        const t = tabs.get(id)!;
        t.url = load.redirects.get(p.url) ?? p.url;
        t.title = `title of ${t.url}`;
        t.status = load.status;
        return { ...t };
      },
      async group(o: {
        tabIds: number[];
        groupId?: number;
        createProperties?: { windowId: number };
      }) {
        let gid = o.groupId;
        if (gid === undefined) {
          gid = next++;
          groups.set(gid, { id: gid, windowId: o.createProperties!.windowId });
        }
        for (const id of o.tabIds) tabs.get(id)!.groupId = gid;
        return gid;
      },
      async goBack(id: number) {
        tabs.get(id)!.url = "previous";
      },
      async goForward(id: number) {
        tabs.get(id)!.url = "next";
      },
    },
    tabGroups: {
      async get(id: number) {
        const g = groups.get(id);
        if (!g) throw new Error(`No group with id: ${id}.`);
        return { ...g };
      },
      async update(id: number, p: { title: string; color: string }) {
        Object.assign(groups.get(id)!, p);
        return groups.get(id);
      },
    },
  };
  return { api, tabs, groups, load, personal };
}

function memoryStore(): GroupStore {
  const m = new Map<string, number>();
  return {
    get: async (s) => m.get(s),
    set: async (s, g) => void m.set(s, g),
    delete: async (s) => void m.delete(s),
  };
}

describe("tab tools", () => {
  let chrome: ReturnType<typeof fakeChrome>;
  let tools: TabTools;

  beforeEach(() => {
    chrome = fakeChrome();
    tools = new TabTools(chrome.api as never, memoryStore(), async () => true);
  });

  it("reports no group until asked to create one", async () => {
    const ctx = await tools.tabsContext("a", {});
    expect(ctx.tabs).toEqual([]);
    expect(chrome.groups.size).toBe(0);
  });

  it("creates one titled group per session, in its own window", async () => {
    const a = await tools.tabsContext("a", { createIfEmpty: true });
    const b = await tools.tabsContext("b", { createIfEmpty: true });
    expect(a.tabs).toHaveLength(1);
    expect(a.groupId).not.toBe(b.groupId);
    expect(chrome.groups.get(a.groupId!)?.title).toBe(GROUP_TITLE);
  });

  it("adds new tabs to the session's group", async () => {
    await tools.tabsContext("a", { createIfEmpty: true });
    const { tabId } = await tools.tabsCreate("a");
    const ctx = await tools.tabsContext("a", {});
    expect(ctx.tabs.map((t) => t.tabId)).toContain(tabId);
    expect(ctx.tabs).toHaveLength(2);
  });

  it("never touches another session's tabs", async () => {
    const a = await tools.tabsContext("a", { createIfEmpty: true });
    await tools.tabsContext("b", { createIfEmpty: true });
    const aTab = a.tabs[0]!.tabId;
    await expect(tools.tabsClose("b", { tabId: aTab })).rejects.toMatchObject({ code: "no_tab" });
    await expect(tools.navigate("b", { tabId: aTab, url: "example.com" })).rejects.toBeInstanceOf(
      ToolError,
    );
    expect(chrome.tabs.has(aTab)).toBe(true);
  });

  it("closing the last tab drops the group, and the next context starts fresh", async () => {
    const a = await tools.tabsContext("a", { createIfEmpty: true });
    await tools.tabsClose("a", { tabId: a.tabs[0]!.tabId });
    expect((await tools.tabsContext("a", {})).tabs).toEqual([]);
    const again = await tools.tabsContext("a", { createIfEmpty: true });
    expect(again.groupId).not.toBe(a.groupId);
  });

  it("navigate without a tab id creates the group and returns its context", async () => {
    const r = await tools.navigate("a", { url: "example.com" });
    expect(r.url).toBe("https://example.com");
    expect(r.tabContext).toBeDefined();
  });

  it("navigate counts a load that finished before it looked", async () => {
    tools = new TabTools(chrome.api as never, memoryStore(), async () => false);
    chrome.load.status = "complete";
    const r = await tools.navigate("a", { url: "example.com" });
    expect(r.note).toBeUndefined();
  });

  it("navigate notes a page still loading at the timeout", async () => {
    tools = new TabTools(chrome.api as never, memoryStore(), async () => false);
    const r = await tools.navigate("a", { url: "example.com" });
    expect(r.note).toMatch(/Still loading/);
  });

  it("navigate back needs a tab id", async () => {
    await expect(tools.navigate("a", { url: "back" })).rejects.toMatchObject({ code: "bad_args" });
  });

  it("an unknown tab id is no_tab", async () => {
    await tools.tabsContext("a", { createIfEmpty: true });
    await expect(tools.tabsClose("a", { tabId: 9999 })).rejects.toMatchObject({ code: "no_tab" });
  });

  it("end forgets the group but leaves the tabs", async () => {
    const a = await tools.tabsContext("a", { createIfEmpty: true });
    await tools.end("a");
    expect((await tools.tabsContext("a", {})).tabs).toEqual([]);
    expect(chrome.tabs.has(a.tabs[0]!.tabId)).toBe(true);
  });
});

describe("tab tools under the settings", () => {
  let chrome: ReturnType<typeof fakeChrome>;
  const opts: Required<TabOptions> & { rules: SiteRules; window: boolean; close: boolean } = {
    rules: new SiteRules(["*.bank.com/*"], ["mail.google.com/*"]),
    window: true,
    close: false,
    sites: () => opts.rules,
    newWindow: () => opts.window,
    closeTabsOnEnd: () => opts.close,
  };
  const tools = () => new TabTools(chrome.api as never, store, async () => true, opts);
  let store: GroupStore;

  beforeEach(() => {
    chrome = fakeChrome();
    store = memoryStore();
    opts.window = true;
    opts.close = false;
  });

  it("navigate refuses a blocked site before loading it", async () => {
    const t = tools();
    const { tabId } = await t.tabsCreate("a");
    await expect(t.navigate("a", { tabId, url: "www.bank.com/login" })).rejects.toMatchObject({
      code: "blocked",
      message: expect.stringMatching(/www.bank.com is blocked/),
    });
    expect(chrome.tabs.get(tabId)!.url).toBe("about:blank");
  });

  it("a redirect onto a blocked site sends the tab to about:blank and answers blocked", async () => {
    const t = tools();
    const { tabId } = await t.tabsCreate("a");
    chrome.load.status = "complete";
    chrome.load.redirects.set("https://short.test/x", "https://bank.com/account");
    await expect(t.navigate("a", { tabId, url: "short.test/x" })).rejects.toMatchObject({
      code: "blocked",
    });
    expect(chrome.tabs.get(tabId)!.url).toBe("about:blank");
  });

  it("every tab tool refuses a tab on a blocked site; read-only refuses only acting", async () => {
    const t = tools();
    const { tabId } = await t.tabsCreate("a");
    chrome.tabs.get(tabId)!.url = "https://mail.google.com/mail/u/0/";
    await expect(t.ownTab("a", tabId, "read")).resolves.toBeDefined();
    await expect(t.ownTab("a", tabId, "act")).rejects.toMatchObject({ code: "blocked" });
    chrome.tabs.get(tabId)!.url = "https://bank.com/";
    await expect(t.ownTab("a", tabId, "read")).rejects.toMatchObject({ code: "blocked" });
    await expect(t.tabsClose("a", { tabId })).resolves.toEqual({ closed: tabId });
  });

  it("tabs_context lists a blocked tab with no title or URL", async () => {
    const t = tools();
    const { tabId } = await t.tabsCreate("a");
    Object.assign(chrome.tabs.get(tabId)!, {
      url: "https://bank.com/statements",
      title: "Your statements",
    });
    const ctx = await t.tabsContext("a", {});
    expect(ctx.tabs).toEqual([{ tabId, title: "", url: "", active: true, blocked: true }]);
    expect(JSON.stringify(ctx)).not.toContain("bank");
  });

  it("new window off groups the first tab in the last focused window, in the background", async () => {
    opts.window = false;
    const t = tools();
    const { tabId } = await t.tabsCreate("a");
    const tab = chrome.tabs.get(tabId)!;
    expect(tab.windowId).toBe(1);
    expect(tab.active).toBe(false);
    expect(chrome.groups.get(tab.groupId)).toMatchObject({ windowId: 1, title: GROUP_TITLE });
  });

  it("close tabs on end removes the group's tabs; off leaves them", async () => {
    const t = tools();
    const a = await t.tabsContext("a", { createIfEmpty: true });
    await t.end("a");
    expect(chrome.tabs.has(a.tabs[0]!.tabId)).toBe(true);

    opts.close = true;
    const b = await t.tabsContext("b", { createIfEmpty: true });
    await t.tabsCreate("b");
    await t.end("b");
    expect(b.tabs.every((x) => !chrome.tabs.has(x.tabId))).toBe(true);
    expect([...chrome.tabs.values()].filter((x) => x.groupId === b.groupId)).toEqual([]);
    expect(chrome.tabs.has(chrome.personal.id), "the person's tab stays").toBe(true);
  });

  it("a new tab from a group tab that lands on a blocked site is closed; an old one goes blank", async () => {
    const t = tools();
    const { tabId } = await t.tabsCreate("a");
    const groupId = chrome.tabs.get(tabId)!.groupId;
    const popup = {
      id: 900,
      windowId: chrome.tabs.get(tabId)!.windowId,
      groupId,
      url: "https://bank.com/",
      title: "",
      active: true,
      openerTabId: tabId,
    };
    chrome.tabs.set(popup.id, popup);
    await t.committed({ tabId: 900, frameId: 0, url: "https://bank.com/" });
    expect(chrome.tabs.has(900)).toBe(false);

    chrome.tabs.get(tabId)!.url = "https://bank.com/";
    await t.committed({ tabId, frameId: 0, url: "https://bank.com/" });
    expect(chrome.tabs.get(tabId)!.url).toBe("about:blank");

    // The person's own tabs and frames are left alone.
    await t.committed({ tabId: chrome.personal.id, frameId: 0, url: "https://bank.com/" });
    expect(chrome.tabs.has(chrome.personal.id)).toBe(true);
  });
});

describe("normaliseUrl", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["localhost:3000/x", "https://localhost:3000/x"],
    ["http://example.com", "http://example.com"],
    ["chrome://extensions", "chrome://extensions"],
    ["about:blank", "about:blank"],
    ["  example.com/a ", "https://example.com/a"],
  ])("%s -> %s", (input, want) => expect(normaliseUrl(input)).toBe(want));
});
