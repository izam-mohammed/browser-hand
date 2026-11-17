// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { Cursor, type CursorEnv, IDLE_HIDE_MS } from "../src/page/cursor";

/** A clock the test turns by hand: frames run when `tick` passes their time. */
function fakeEnv(reduced = false) {
  let now = 0;
  let frame: ((t: number) => void) | undefined;
  const timers: { at: number; cb: () => void; id: number }[] = [];
  let next = 1;
  const env: CursorEnv = {
    now: () => now,
    raf: (cb) => {
      frame = cb;
      return 1;
    },
    cancelRaf: () => {
      frame = undefined;
    },
    reducedMotion: () => reduced,
    setTimer: (cb, ms) => {
      timers.push({ at: now + ms, cb, id: next });
      return next++;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const tick = (ms: number) => {
    now += ms;
    const f = frame;
    frame = undefined;
    f?.(now);
    for (const t of [...timers].filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.cb();
    }
  };
  return { env, tick, animating: () => frame !== undefined };
}

describe("page cursor", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  it("mounts in a closed shadow root that the page cannot reach", () => {
    const { env } = fakeEnv();
    const c = new Cursor(document, env);
    c.move([{ x: 1, y: 1 }], 10);
    const host = document.documentElement.querySelector(
      "[data-browser-hand-cursor]",
    ) as HTMLElement;
    expect(host).toBeTruthy();
    expect(host.shadowRoot).toBeNull();
    expect(host.style.pointerEvents).toBe("none");
    expect(host.style.position).toBe("fixed");
  });

  it("replays the path point by point and lands on the last", () => {
    const f = fakeEnv();
    const c = new Cursor(document, f.env);
    c.move(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      10,
    );
    expect(c.position).toEqual({ x: 0, y: 0 });
    f.tick(5);
    expect(c.position.x).toBeCloseTo(50);
    f.tick(10);
    expect(c.position.x).toBeCloseTo(100);
    expect(c.position.y).toBeCloseTo(25);
    f.tick(50);
    expect(c.position).toEqual({ x: 100, y: 50 });
    expect(f.animating()).toBe(false);
  });

  it("snaps to the last point when a new move starts", () => {
    const f = fakeEnv();
    const c = new Cursor(document, f.env);
    c.move(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      10,
    );
    c.move(
      [
        { x: 100, y: 0 },
        { x: 100, y: 80 },
      ],
      10,
    );
    expect(c.position).toEqual({ x: 100, y: 0 });
  });

  it("is hidden while hidden and back after show", () => {
    const f = fakeEnv();
    const c = new Cursor(document, f.env);
    c.move([{ x: 5, y: 5 }], 10);
    expect(c.visible).toBe(true);
    c.hide();
    expect(c.visible).toBe(false);
    c.show();
    expect(c.visible).toBe(true);
  });

  it("snaps instead of gliding for a person who asks for reduced motion", () => {
    const f = fakeEnv(true);
    const c = new Cursor(document, f.env);
    c.move(
      [
        { x: 0, y: 0 },
        { x: 300, y: 300 },
      ],
      10,
    );
    expect(c.position).toEqual({ x: 300, y: 300 });
    expect(f.animating()).toBe(false);
  });

  it("disappears a few seconds after the last action and returns on the next", () => {
    const f = fakeEnv();
    const c = new Cursor(document, f.env);
    c.move([{ x: 5, y: 5 }], 10);
    f.tick(IDLE_HIDE_MS - 1);
    expect(c.visible).toBe(true);
    f.tick(1);
    expect(c.visible).toBe(false);
    c.move([{ x: 6, y: 6 }], 10);
    expect(c.visible).toBe(true);
  });

  it("stays out of the way while hidden even when idle ends", () => {
    const f = fakeEnv();
    const c = new Cursor(document, f.env);
    c.move([{ x: 5, y: 5 }], 10);
    c.hide();
    f.tick(IDLE_HIDE_MS);
    c.show();
    expect(c.visible).toBe(false);
  });
});
