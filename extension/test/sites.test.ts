import { describe, expect, it, vi } from "vitest";
import { type Rule, SiteRuleSync, sessionRules } from "../src/site-rules";
import {
  dnrRegex,
  gate,
  gateRegex,
  isPattern,
  NOT_A_PATTERN,
  patternProblem,
  SiteRules,
  useFor,
} from "../src/sites";

describe("pattern grammar", () => {
  // The same cases as host/tests/config.rs, so the two sides agree.
  it.each([
    "*.bank.com/*",
    "hr.example.com/*",
    "mail.google.com/*",
    "example.com/",
    "localhost/app/*",
    "*/*",
    "127.0.0.1/*",
    "a-b.example.co.uk/x/*/y",
    "Docs.Google.com/*",
  ])("%s is a pattern", (p) => expect(isPattern(p)).toBe(true));
  it.each([
    "https//docs.google",
    "https://docs.google.com/*",
    "docs.google.com",
    "example.com:8080/*",
    "example.com/?q=1",
    "example.com/#top",
    "/path",
    "exa mple.com/*",
    " example.com/*",
    "example..com/*",
    ".example.com/*",
    "",
    "intranet/*",
  ])("%j is not", (p) => expect(isPattern(p)).toBe(false));

  it("the page refuses a bad, long, repeated or extra pattern with words", () => {
    expect(patternProblem("https//docs.google", [])).toBe(NOT_A_PATTERN);
    expect(patternProblem(`a.com/${"x".repeat(100)}`, [])).toMatch(/Longer than 100/);
    expect(patternProblem("a.com/*", ["a.com/*"])).toMatch(/Already/);
    expect(
      patternProblem(
        "b.com/*",
        Array.from({ length: 200 }, (_, i) => `a${i}.com/*`),
      ),
    ).toMatch(/At most 200/);
    expect(patternProblem("docs.google.com/*", [])).toBeNull();
  });
});

describe("matching", () => {
  const rules = new SiteRules(
    ["*.bank.com/*", "hr.example.com/*", "example.org/private/*"],
    ["mail.google.com/*"],
  );

  it.each([
    ["https://bank.com/", "blocked"],
    ["https://www.bank.com/login?next=1", "blocked"],
    ["https://a.b.bank.com/x", "blocked"],
    ["https://notbank.com/", "open"],
    ["https://bank.com.evil.test/", "open"],
    ["http://HR.Example.com:8443/people", "blocked"],
    ["https://example.org/private/x", "blocked"],
    ["https://example.org/public", "open"],
    ["https://mail.google.com/mail/u/0/", "read_only"],
    ["https://docs.google.com/", "open"],
    ["about:blank", "open"],
    ["chrome://extensions", "open"],
    [undefined, "open"],
  ])("%s is %s", (url, want) => expect(rules.access(url)).toBe(want));

  it("the gate regex and the DNR regex agree on every URL", () => {
    const urls = [
      "https://bank.com/",
      "https://www.bank.com/a?b=c",
      "https://notbank.com/",
      "http://hr.example.com:8080/x",
      "wss://a.bank.com/socket",
      "https://example.org/private/",
      "https://example.org/privat",
    ];
    for (const p of ["*.bank.com/*", "hr.example.com/*", "example.org/private/*"]) {
      const dnr = new RegExp(dnrRegex(p), "i");
      for (const url of urls) {
        const u = new URL(url);
        expect(dnr.test(url), `${p} ${url}`).toBe(gateRegex(p).test(u.hostname + u.pathname));
      }
    }
  });

  it("DNR filters use only what RE2 takes: no lookarounds or backreferences", () => {
    for (const p of ["*.bank.com/*", "hr.example.com/a*b"])
      expect(dnrRegex(p)).not.toMatch(/\(\?[=!<]|\\[1-9]/);
  });
});

describe("the gate per tool", () => {
  const rules = new SiteRules(["*.bank.com/*"], ["mail.google.com/*"]);
  const tryTool = (url: string, tool: string, action?: string) => {
    try {
      gate(rules, url, useFor(tool, { action }));
      return "ok";
    } catch (e) {
      return (e as { code: string }).code;
    }
  };

  it("a blocked site refuses every tool but closing its tab", () => {
    for (const tool of [
      "read_page",
      "find",
      "wait_for",
      "get_page_text",
      "read_console_messages",
      "read_network_requests",
      "form_input",
      "javascript_tool",
      "file_upload",
      "upload_image",
      "replay_step",
      "resize_window",
    ]) {
      expect(tryTool("https://www.bank.com/", tool), tool).toBe("blocked");
    }
    expect(tryTool("https://www.bank.com/", "computer", "screenshot")).toBe("blocked");
    expect(tryTool("https://www.bank.com/", "tabs_close")).toBe("ok");
  });

  it("a read-only site allows reading, screenshot, zoom, scroll and scroll_to, and nothing else", () => {
    const mail = "https://mail.google.com/mail/u/0/";
    for (const tool of [
      "read_page",
      "find",
      "wait_for",
      "get_page_text",
      "read_console_messages",
      "read_network_requests",
    ])
      expect(tryTool(mail, tool), tool).toBe("ok");
    for (const action of ["screenshot", "zoom", "scroll", "scroll_to"])
      expect(tryTool(mail, "computer", action), action).toBe("ok");
    for (const action of [
      "left_click",
      "right_click",
      "double_click",
      "triple_click",
      "hover",
      "left_click_drag",
      "type",
      "key",
      "wait",
    ]) {
      expect(tryTool(mail, "computer", action), action).toBe("blocked");
    }
    for (const tool of [
      "form_input",
      "javascript_tool",
      "file_upload",
      "upload_image",
      "replay_step",
    ])
      expect(tryTool(mail, tool), tool).toBe("blocked");
  });

  it("the refusal names the host and says to ask the person", () => {
    expect(() => gate(rules, "https://www.bank.com/x", "read")).toThrow(
      "www.bank.com is blocked in browser-hand settings; ask the person.",
    );
    expect(() => gate(rules, "https://mail.google.com/", "act")).toThrow(
      /mail.google.com is read-only in browser-hand settings/,
    );
  });
});

describe("the allow list", () => {
  const rules = new SiteRules(
    ["ads.docs.google.com/*"],
    ["mail.google.com/*"],
    ["*.google.com/*", "example.org/*"],
  );
  const go = (url: string, use: "read" | "act" = "act") => {
    try {
      gate(rules, url, use);
      return "ok";
    } catch (e) {
      return (e as { message: string }).message;
    }
  };

  it("lets listed sites through and refuses every other web page, in words that say why", () => {
    expect(go("https://docs.google.com/d/1")).toBe("ok");
    expect(go("https://example.org/a")).toBe("ok");
    expect(go("https://news.example.com/")).toBe(
      "news.example.com is not on the allowed sites list in browser-hand settings; ask the person.",
    );
    expect(rules.why("https://news.example.com/")).toBe("unlisted");
  });

  it("blocked wins over allowed, and read-only still applies to a listed site", () => {
    expect(go("https://ads.docs.google.com/x")).toMatch(/is blocked in browser-hand settings/);
    expect(rules.why("https://ads.docs.google.com/x")).toBe("listed");
    expect(go("https://mail.google.com/", "read")).toBe("ok");
    expect(go("https://mail.google.com/", "act")).toMatch(/read-only/);
  });

  it("does not judge pages that are not sites, and an empty list restricts nothing", () => {
    for (const url of [
      "about:blank",
      "chrome://newtab/",
      "chrome-extension://abc/claim.html",
      undefined,
    ])
      expect(rules.access(url as string), String(url)).toBe("open");
    expect(new SiteRules([], [], []).access("https://anything.test/")).toBe("open");
  });

  it("a list with no valid pattern blocks every web page, not none", () => {
    expect(new SiteRules([], [], ["not a pattern"]).access("https://a.test/")).toBe("blocked");
  });
});

describe("DNR session rules", () => {
  it("with an allow list: block every web URL, allow each pattern, blocked on top", () => {
    const rules = sessionRules(
      ["ads.docs.google.com/*"],
      [4, 2],
      ["*.google.com/*", "bad pattern", "example.org/*"],
    );
    expect(rules.map((r) => [r.id, r.priority, r.action.type])).toEqual([
      [1, 1, "block"],
      [2, 2, "allow"],
      [3, 2, "allow"],
      [4, 3, "block"],
    ]);
    expect(rules[0]?.condition.regexFilter).toBe("^(?:https?|wss?)://");
    expect(rules[1]?.condition.regexFilter).toBe(dnrRegex("*.google.com/*"));
    expect(rules.every((r) => r.condition.tabIds.join() === "2,4")).toBe(true);
    // The rules match real URLs the way the gate does.
    const allows = new RegExp(rules[1]?.condition.regexFilter ?? "");
    expect(allows.test("https://docs.google.com/d/1?x=1")).toBe(true);
    expect(allows.test("https://evil.test/https://docs.google.com/")).toBe(false);
    expect(
      new RegExp(rules[0]?.condition.regexFilter ?? "").test("chrome-extension://abc/claim.html"),
    ).toBe(false);
  });

  it("without an allow list the rules are the old ones", () => {
    const rules = sessionRules(["*.bank.com/*"], [1]);
    expect(rules.map((r) => [r.id, r.priority, r.action.type])).toEqual([[1, 1, "block"]]);
  });

  it("one rule per blocked pattern, main_frame and sub_frame, for the group tabs only", () => {
    const rules = sessionRules(["*.bank.com/*", "not a pattern", "hr.example.com/*"], [7, 3]);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({
      id: 1,
      priority: 1,
      action: { type: "block" },
      condition: {
        regexFilter: dnrRegex("*.bank.com/*"),
        resourceTypes: ["main_frame", "sub_frame"],
        tabIds: [3, 7],
      },
    });
    expect(sessionRules(["*.bank.com/*"], [])).toEqual([]);
  });

  it("the sync replaces the old rules whole, and calls made together share one rewrite", async () => {
    let blocked = ["*.bank.com/*"];
    let tabs = [5];
    const updates: { removeRuleIds?: number[]; addRules?: Rule[] }[] = [];
    let current: Rule[] = [{ id: 9 } as Rule];
    const dnr = {
      getSessionRules: vi.fn(async () => current),
      updateSessionRules: vi.fn(async (o: { removeRuleIds?: number[]; addRules?: Rule[] }) => {
        updates.push(o);
        current = o.addRules ?? [];
      }),
    };
    const sync = new SiteRuleSync({ dnr, groupTabs: async () => tabs, blocked: () => blocked });
    sync.update();
    sync.update();
    await sync.update();
    expect(updates).toHaveLength(1);
    expect(updates[0]!.removeRuleIds).toEqual([9]);
    expect(updates[0]!.addRules!.map((r) => r.condition.tabIds)).toEqual([[5]]);

    blocked = [];
    tabs = [5, 6];
    await sync.update();
    expect(updates[1]).toEqual({ removeRuleIds: [1], addRules: [] });
  });
});
