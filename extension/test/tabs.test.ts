import { beforeEach, describe, expect, it } from "vitest";
import { GROUP_TITLE, TabTools, normaliseUrl, type GroupStore } from "../src/tabs";
import { ToolError } from "../src/wire";

type FakeTab = { id: number; windowId: number; groupId: number; url: string; title: string; active: boolean };
type FakeGroup = { id: number; windowId: number; title?: string; color?: string };

/** Just enough of chrome.tabs / tabGroups / windows, in memory. */
function fakeChrome() {
  let next = 100;
  const tabs = new Map<number, FakeTab>();
  const groups = new Map<number, FakeGroup>();
  const dropEmptyGroups = () => {
    for (const g of groups.values()) {
      if (![...tabs.values()].some((t) => t.groupId === g.id)) groups.delete(g.id);
    }
  };
  const api = {
    windows: {
      async create(_: object) {
        const windowId = next++;
        const tab: FakeTab = { id: next++, windowId, groupId: -1, url: "about:blank", title: "", active: true };
        tabs.set(tab.id, tab);
        return { id: windowId, tabs: [{ id: tab.id }] };
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
      async create(p: { windowId: number }) {
        const t: FakeTab = { id: next++, windowId: p.windowId, groupId: -1, url: "about:blank", title: "", active: true };
        tabs.set(t.id, t);
        return { ...t };
      },
      async remove(id: number) {
        tabs.delete(id);
        dropEmptyGroups();
      },
      async update(id: number, p: { url: string }) {
        const t = tabs.get(id)!;
        t.url = p.url;
        t.title = `title of ${p.url}`;
        return { ...t };
      },
      async group(o: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }) {
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
  return { api, tabs, groups };
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
    await expect(tools.navigate("b", { tabId: aTab, url: "example.com" })).rejects.toBeInstanceOf(ToolError);
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
