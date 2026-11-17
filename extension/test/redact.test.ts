import { describe, expect, it } from "vitest";
import type { DebuggerManager } from "../src/debugger";
import { NetworkLog } from "../src/network";
import { DEFAULT_SHOT, capture } from "../src/screenshot";

describe("screenshot hides the page cursor", () => {
  const fakeDbg = (log: string[], fail = false) =>
    ({
      isAttached: () => true,
      send: async (_t: number, method: string) => {
        log.push(method);
        if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 800, clientHeight: 600 } };
        if (method === "Runtime.evaluate") return { result: { value: 1 } };
        if (fail) throw new Error("boom");
        return { data: "AAAA" };
      },
    }) as unknown as DebuggerManager;

  it("hides before the capture and shows after", async () => {
    const log: string[] = [];
    const around = { hide: async () => void log.push("hide"), show: async () => void log.push("show") };
    await capture(fakeDbg(log), 1, {}, DEFAULT_SHOT, around);
    expect(log.indexOf("hide")).toBeLessThan(log.indexOf("Page.captureScreenshot"));
    expect(log.at(-1)).toBe("show");
  });

  it("shows again when the capture fails", async () => {
    const log: string[] = [];
    const around = { hide: async () => void log.push("hide"), show: async () => void log.push("show") };
    await expect(capture(fakeDbg(log, true), 1, {}, DEFAULT_SHOT, around)).rejects.toThrow();
    expect(log.at(-1)).toBe("show");
  });
});

describe("network log redaction", () => {
  const rec = (url: string, pattern?: string) => {
    const log = new NetworkLog();
    log.started({ requestId: "1", tabId: 1, url, method: "GET", type: "xmlhttprequest", timeStamp: 0 });
    return log.read(1, { urlPattern: pattern });
  };

  it.each(["access_token", "token", "API_KEY", "client_secret", "sig", "password", "auth", "code", "sessionid", "X-Amz-Signature"])(
    "hides the value of %s",
    (key) => {
      const out = rec(`https://a.test/p?x=1&${key}=hunter2&y=2`);
      expect(out).not.toContain("hunter2");
      expect(out).toContain(`${key}=REDACTED`);
      expect(out).toContain("x=1");
      expect(out).toContain("y=2");
    },
  );

  it("hides keys in the fragment and userinfo", () => {
    const out = rec("https://bob:pw123@a.test/cb#access_token=abc&state=ok");
    expect(out).not.toContain("pw123");
    expect(out).not.toContain("bob");
    expect(out).not.toContain("abc");
    expect(out).toContain("access_token=REDACTED");
    expect(out).toContain("state=ok");
  });

  it("leaves ordinary values alone", () => {
    expect(rec("https://a.test/search?q=shoes&page=2")).toContain("https://a.test/search?q=shoes&page=2");
  });

  it("matches urlPattern against the redacted form", () => {
    expect(rec("https://a.test/api?token=hunter2", "hunter2")).toContain("No network requests");
    expect(rec("https://a.test/api?token=hunter2", "/api")).toContain("token=REDACTED");
  });

  it("keeps a URL that does not parse as it came", () => {
    expect(rec("not a url")).toContain("not a url");
  });
});
