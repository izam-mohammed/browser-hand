import { describe, expect, it } from "vitest";
import { PARAMS } from "../src/humane/params";
import { minimumJerk, movePath, segment } from "../src/humane/path";
import { seeded } from "../src/humane/random";
import { fittsMs, keyGapMs, keyHoldMs } from "../src/humane/timing";
import { Input, type InputDeps } from "../src/input";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("paths", () => {
  it("end exactly on the target and stay within the spread", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const from = { x: 100, y: 100 };
      const to = { x: 400, y: 300 };
      const pts = segment(from, to, 500, seeded(seed));
      expect(pts.at(-1)).toEqual(to);
      for (const p of pts) expect(dist(p, from) + dist(p, to)).toBeLessThan(dist(from, to) + 2 * PARAMS.spreadMax);
    }
  });

  it("are not straight lines", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 300, y: 0 };
    const pts = segment(from, to, 500, seeded(7));
    expect(Math.max(...pts.map((p) => Math.abs(p.y)))).toBeGreaterThan(2);
  });

  it("move slowly at both ends and fast in the middle (minimum jerk)", () => {
    expect(minimumJerk(0)).toBe(0);
    expect(minimumJerk(1)).toBeCloseTo(1);
    const early = minimumJerk(0.1) - minimumJerk(0);
    const middle = minimumJerk(0.55) - minimumJerk(0.45);
    const late = minimumJerk(1) - minimumJerk(0.9);
    expect(middle).toBeGreaterThan(early * 5);
    expect(middle).toBeGreaterThan(late * 5);
  });

  it("overshoot only on moves of 500 px or more, then land on target", () => {
    const rng = seeded(3);
    const shortMove = movePath({ x: 0, y: 0 }, { x: 300, y: 0 }, 20, rng);
    expect(Math.max(...shortMove.map((p) => p.x))).toBeLessThanOrEqual(300 + PARAMS.spreadMax);
    let overshot = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const to = { x: 900, y: 400 };
      const pts = movePath({ x: 0, y: 0 }, to, 20, seeded(seed));
      expect(pts.at(-1)).toEqual(to);
      if (pts.some((p) => p.x > to.x + 5)) overshot++;
    }
    expect(overshot).toBeGreaterThan(0);
  });

  it("take longer for longer moves and smaller targets (Fitts)", () => {
    expect(fittsMs(800, 20)).toBeGreaterThan(fittsMs(200, 20));
    expect(fittsMs(400, 10)).toBeGreaterThan(fittsMs(400, 100));
    expect(fittsMs(800, 40)).toBeCloseTo(PARAMS.fittsA + PARAMS.fittsB * Math.log2(21));
    expect(fittsMs(0, 20)).toBe(0);
  });
});

describe("typing timing", () => {
  it("draws gaps with the research mean and never under the floor", () => {
    const rng = seeded(11);
    const gaps = Array.from({ length: 10_000 }, () => keyGapMs(rng));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(PARAMS.keyGapFloorMs);
    expect(mean).toBeGreaterThan(PARAMS.keyGapMeanMs * 0.92);
    expect(mean).toBeLessThan(PARAMS.keyGapMeanMs * 1.1);
  });

  it("holds keys near the research mean", () => {
    const rng = seeded(12);
    const holds = Array.from({ length: 5000 }, () => keyHoldMs(rng));
    const mean = holds.reduce((a, b) => a + b, 0) / holds.length;
    expect(Math.abs(mean - PARAMS.keyHoldMeanMs)).toBeLessThan(3);
  });
});

/** An Input whose CDP calls and sleeps are recorded, not sent. */
function recorder(rect = { x: 200, y: 150, width: 80, height: 30, inViewport: true }) {
  const events: { method: string; params: any }[] = [];
  let slept = 0;
  const deps: InputDeps = {
    send: async (method, params) => void events.push({ method, params }),
    sleep: async (ms) => void (slept += ms),
    rng: seeded(5),
    isMac: true,
    rect: async () => rect,
    scrollIntoView: async () => {},
    viewport: async () => ({ width: 1200, height: 800 }),
  };
  return { input: new Input(deps), events, slept: () => slept };
}

const types = (events: { method: string; params: any }[]) => events.map((e) => e.params.type);

describe("computer actions", () => {
  it("a click glides, presses, holds and releases on the target", async () => {
    const { input, events, slept } = recorder();
    await input.run({ action: "left_click", coordinate: [600, 400] }, "human");
    const t = types(events);
    expect(t.filter((x) => x === "mouseMoved").length).toBeGreaterThan(5);
    expect(t.slice(-2)).toEqual(["mousePressed", "mouseReleased"]);
    const press = events.at(-2)!.params;
    expect(press).toMatchObject({ x: 600, y: 400, button: "left", clickCount: 1 });
    expect(slept()).toBeGreaterThan(100);
  });

  it("fast pace sends the same kind of events with no waiting", async () => {
    const { input, events, slept } = recorder();
    await input.run({ action: "left_click", coordinate: [600, 400] }, "fast");
    expect(types(events)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(slept()).toBe(0);
  });

  it("a double click sends click counts 1 then 2", async () => {
    const { input, events } = recorder();
    await input.run({ action: "double_click", coordinate: [10, 10] }, "fast");
    const presses = events.filter((e) => e.params.type === "mousePressed").map((e) => e.params.clickCount);
    expect(presses).toEqual([1, 2]);
  });

  it("clicks a ref near its centre", async () => {
    const { input, events } = recorder();
    await input.run({ action: "left_click", ref: "ref_3" }, "fast");
    const press = events.find((e) => e.params.type === "mousePressed")!.params;
    expect(Math.abs(press.x - 200)).toBeLessThanOrEqual(80 * 0.15 + 0.001);
    expect(Math.abs(press.y - 150)).toBeLessThanOrEqual(30 * 0.15 + 0.001);
  });

  it("types each character as key down and key up, with Shift for capitals", async () => {
    const { input, events } = recorder();
    await input.run({ action: "type", text: "Hi!" }, "fast");
    const keys = events.map((e) => `${e.params.type}:${e.params.key}`);
    expect(keys).toEqual([
      "rawKeyDown:Shift", "keyDown:H", "keyUp:H", "keyUp:Shift",
      "keyDown:i", "keyUp:i",
      "rawKeyDown:Shift", "keyDown:!", "keyUp:!", "keyUp:Shift",
    ]);
    expect(events.find((e) => e.params.key === "i")!.params.text).toBe("i");
  });

  it("inserts characters no key types", async () => {
    const { input, events } = recorder();
    await input.run({ action: "type", text: "é😀" }, "fast");
    expect(events.map((e) => [e.method, e.params.text])).toEqual([
      ["Input.insertText", "é"],
      ["Input.insertText", "😀"],
    ]);
  });

  it("cmd+a holds Meta and asks for selectAll on macOS", async () => {
    const { input, events } = recorder();
    await input.run({ action: "key", text: "cmd+a" }, "fast");
    expect(events.map((e) => `${e.params.type}:${e.params.key}`)).toEqual([
      "rawKeyDown:Meta", "rawKeyDown:a", "keyUp:a", "keyUp:Meta",
    ]);
    expect(events[1]!.params).toMatchObject({ modifiers: 4, commands: ["selectAll"] });
    expect(events[1]!.params.text).toBeUndefined();
  });

  it("refuses page zoom shortcuts and bad repeats", async () => {
    const { input } = recorder();
    await expect(input.run({ action: "key", text: "cmd+=" }, "fast")).rejects.toMatchObject({ code: "bad_args" });
    await expect(input.run({ action: "key", text: "Enter", repeat: 101 }, "fast")).rejects.toMatchObject({ code: "bad_args" });
  });

  it("scrolls in wheel notches of 100", async () => {
    const { input, events } = recorder();
    await input.run({ action: "scroll", coordinate: [300, 300], scroll_direction: "down", scroll_amount: 4 }, "fast");
    const wheels = events.filter((e) => e.params.type === "mouseWheel");
    expect(wheels.map((w) => w.params.deltaY)).toEqual([100, 100, 100, 100]);
  });

  it("drags with the button held along the way", async () => {
    const { input, events } = recorder();
    await input.run({ action: "left_click_drag", start_coordinate: [10, 10], coordinate: [300, 40] }, "human");
    const pressAt = events.findIndex((e) => e.params.type === "mousePressed");
    const between = events.slice(pressAt + 1, -1);
    expect(between.length).toBeGreaterThan(3);
    for (const e of between) expect(e.params.buttons).toBe(1);
    expect(events.at(-1)!.params).toMatchObject({ type: "mouseReleased", x: 300, y: 40 });
  });

  it("wait is capped at 10 s", async () => {
    const { input } = recorder();
    await expect(input.run({ action: "wait", duration: 11 }, "fast")).rejects.toMatchObject({ code: "bad_args" });
  });
});
