import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebuggerManager } from "../src/debugger";
import { NetworkLog } from "../src/network";
import { fitScale, zoomScale } from "../src/screenshot";

describe("network log", () => {
  const start = (log: NetworkLog, requestId: string, url: string, type = "xmlhttprequest") =>
    log.started({ requestId, tabId: 1, url, method: "GET", type, timeStamp: 1000 });

  it("records requests with status and duration, filtered by URL", () => {
    const log = new NetworkLog();
    start(log, "1", "https://a.test/", "main_frame");
    start(log, "2", "https://a.test/api/items");
    log.finished({ requestId: "2", tabId: 1, statusCode: 200, timeStamp: 1042 });
    const out = log.read(1, { urlPattern: "/api/" });
    expect(out).toBe("GET https://a.test/api/items [xmlhttprequest] 200 42 ms");
  });

  it("clears on a cross-domain navigation but not a same-domain one", () => {
    const log = new NetworkLog();
    start(log, "1", "https://a.test/", "main_frame");
    start(log, "2", "https://a.test/x");
    start(log, "3", "https://a.test/next", "main_frame");
    expect(log.read(1, {})).toContain("https://a.test/x");
    start(log, "4", "https://b.test/", "main_frame");
    expect(log.read(1, {})).not.toContain("a.test");
  });

  it("ignores requests from no tab and reports failures", () => {
    const log = new NetworkLog();
    log.started({ requestId: "9", tabId: -1, url: "https://x.test/", method: "GET", type: "other", timeStamp: 0 });
    start(log, "1", "https://a.test/f");
    log.failed({ requestId: "1", tabId: 1, error: "net::ERR_FAILED", timeStamp: 1005 });
    expect(log.read(1, {})).toContain("failed net::ERR_FAILED");
  });
});

describe("debugger manager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeApi(refuse = false) {
    const calls: string[] = [];
    const api = {
      attach: vi.fn(async () => {
        calls.push("attach");
        if (refuse) throw new Error("Cannot access a chrome:// URL");
      }),
      detach: vi.fn(async () => void calls.push("detach")),
      sendCommand: vi.fn(async (_t: unknown, method: string) => {
        calls.push(method);
        return { ok: true };
      }),
      onDetach: { addListener: vi.fn() },
    };
    return { api, calls };
  }

  it("attaches once for several calls and detaches after the idle time", async () => {
    const { api, calls } = fakeApi();
    const dbg = new DebuggerManager(api as never, 30_000);
    await dbg.send(5, "Page.getLayoutMetrics");
    await dbg.send(5, "Input.dispatchMouseEvent");
    expect(calls).toEqual(["attach", "Page.getLayoutMetrics", "Input.dispatchMouseEvent"]);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(dbg.isAttached(5)).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls.at(-1)).toBe("detach");
    expect(dbg.isAttached(5)).toBe(false);
  });

  it("a refused attach is debugger_refused naming the reason", async () => {
    const { api } = fakeApi(true);
    const dbg = new DebuggerManager(api as never);
    await expect(dbg.send(5, "Runtime.evaluate")).rejects.toMatchObject({ code: "debugger_refused" });
  });

  it("forgets a tab when Chrome detaches it", async () => {
    const { api } = fakeApi();
    const dbg = new DebuggerManager(api as never);
    await dbg.send(5, "X");
    const onDetach = api.onDetach.addListener.mock.calls[0]![0] as (s: { tabId: number }) => void;
    onDetach({ tabId: 5 });
    expect(dbg.isAttached(5)).toBe(false);
  });
});

describe("screenshot scaling", () => {
  it("leaves a small viewport at 1 and fits a large one inside 1280x800", () => {
    expect(fitScale(1024, 700)).toBe(1);
    expect(fitScale(1440, 900)).toBeCloseTo(800 / 900);
    expect(fitScale(1440, 900, 0.5)).toBeCloseTo((800 / 900) * 0.5);
  });

  it("enlarges a small zoom region, at most 3x", () => {
    expect(zoomScale(100, 50)).toBe(3);
    expect(zoomScale(640, 400)).toBe(2);
    expect(zoomScale(2000, 1000)).toBe(1);
  });
});
