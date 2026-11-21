import { describe, expect, it } from "vitest";
import { type WaitDeps, waitFor } from "../src/wait";

/** A clock the fake `sleep` moves, so a 15 s wait takes no real time. */
function fake(over: Partial<WaitDeps> = {}) {
  let t = 0;
  const deps: WaitDeps = {
    pageText: async () => "",
    hasRef: async () => false,
    url: async () => "https://a.test/",
    sleep: async (ms) => void (t += ms),
    now: () => t,
    ...over,
  };
  return deps;
}

describe("wait_for", () => {
  it("returns when the text shows, ignoring case", async () => {
    let polls = 0;
    const d = fake({ pageText: async () => (++polls < 3 ? "Loading" : "All DONE here") });
    expect(await waitFor(d, { tabId: 1, text: "done" })).toMatch(
      /Found the text "done" after 0\.5 s/,
    );
  });

  it("returns when the ref is on the page, and when the URL holds the part", async () => {
    const withRef = fake({ hasRef: async (_t, r) => r === "ref_1_2" });
    expect(await waitFor(withRef, { tabId: 1, ref: "ref_1_2" })).toContain("ref_1_2");
    const url = fake({ url: async () => "https://a.test/cart?done=1" });
    expect(await waitFor(url, { tabId: 1, url_contains: "/cart" })).toContain("/cart");
  });

  it("fails with a timeout that names what it waited for", async () => {
    await expect(waitFor(fake(), { tabId: 1, text: "never", timeout_s: 2 })).rejects.toMatchObject({
      code: "timeout",
      message: expect.stringContaining('"never" did not appear within 2 s'),
    });
  });

  it("keeps polling through a navigation: a failed read is not an answer", async () => {
    let n = 0;
    const d = fake({
      pageText: async () => {
        if (++n < 4) throw new Error("Receiving end does not exist");
        return "welcome";
      },
    });
    expect(await waitFor(d, { tabId: 1, text: "welcome" })).toContain("Found");
    // With `gone`, a failed read must not count as gone.
    let m = 0;
    const g = fake({
      pageText: async () => {
        if (++m < 3) throw new Error("navigating");
        return "other page";
      },
    });
    const out = await waitFor(g, { tabId: 1, text: "spinner", gone: true });
    expect(out).toContain("is gone");
    expect(m).toBe(3);
  });

  it("waits for a thing to go away, and times out if it stays", async () => {
    await expect(
      waitFor(fake({ pageText: async () => "spinner" }), {
        tabId: 1,
        text: "spinner",
        gone: true,
        timeout_s: 1,
      }),
    ).rejects.toMatchObject({ code: "timeout", message: expect.stringContaining("still there") });
  });

  it("refuses no condition, two conditions and a bad timeout", async () => {
    for (const a of [
      { tabId: 1 },
      { tabId: 1, text: "a", ref: "r" },
      { tabId: 1, text: "a", timeout_s: 0 },
      { tabId: 1, text: "a", timeout_s: 61 },
    ]) {
      await expect(waitFor(fake(), a)).rejects.toMatchObject({ code: "bad_args" });
    }
  });
});
