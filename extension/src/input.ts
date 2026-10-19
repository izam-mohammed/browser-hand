// The `computer` tool's acting half: each action becomes a timed run of CDP
// Input events shaped like a hand on a mouse and keyboard
// (plans/03-humane-input.md). Screenshots are `screenshot.ts`.
import { PARAMS, type Params } from "./humane/params";
import { aimPoint, movePath, type Pt } from "./humane/path";
import type { Rng } from "./humane/random";
import { clickHoldMs, dwellMs, keyGapMs, keyHoldMs, multiClickGapMs, wheelGapMs } from "./humane/timing";
import {
  charKey,
  isZoomShortcut,
  macCommands,
  modifierKey,
  modifiersBits,
  parseCombo,
  type Combo,
  type KeyDef,
  MOD,
} from "./humane/keys";
import { ToolError } from "./wire";

export type Pace = "human" | "fast";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  inViewport: boolean;
}

export interface InputDeps {
  send(method: string, params: { [key: string]: unknown }): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  rng: Rng;
  isMac: boolean;
  rect(ref: string): Promise<Rect>;
  scrollIntoView(ref: string): Promise<void>;
  viewport(): Promise<{ width: number; height: number }>;
}

export interface ComputerArgs {
  action: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  ref?: string;
  text?: string;
  duration?: number;
  scroll_direction?: "up" | "down" | "left" | "right";
  scroll_amount?: number;
  modifiers?: string;
  repeat?: number;
}

const BUTTON_BITS = { left: 1, right: 2, middle: 4 } as const;

/** One per tab: remembers where this tab's cursor is. */
export class Input {
  private cursor: Pt | undefined;

  constructor(
    private d: InputDeps,
    private p: Params = PARAMS,
  ) {}

  get position(): Pt | undefined {
    return this.cursor;
  }

  private async wait(ms: number, pace: Pace) {
    if (pace === "human" && ms > 0) await this.d.sleep(ms);
  }

  private mouse(type: string, at: Pt, extra: { [key: string]: unknown } = {}) {
    return this.d.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, ...extra });
  }

  private async start(): Promise<Pt> {
    if (this.cursor) return this.cursor;
    const vp = await this.d.viewport();
    this.cursor = { x: vp.width * (0.3 + 0.4 * this.d.rng()), y: vp.height * (0.3 + 0.4 * this.d.rng()) };
    return this.cursor;
  }

  /** Glides the cursor to `to`, holding `buttons` (a drag) if set. */
  private async moveTo(to: Pt, width: number, pace: Pace, buttons = 0, modifiers = 0) {
    const from = await this.start();
    const path = pace === "fast" ? [to] : movePath(from, to, width, this.d.rng, this.p);
    const extra = { button: buttons ? "left" : "none", buttons, modifiers };
    for (const pt of path) {
      await this.mouse("mouseMoved", pt, extra);
      this.cursor = pt;
      await this.wait(this.p.moveIntervalMs, pace);
    }
    this.cursor = to;
  }

  /** The point to act on: a ref's element (scrolled into view first) or a coordinate. */
  private async target(args: ComputerArgs, pace: Pace): Promise<{ at: Pt; width: number }> {
    if (args.ref) {
      let r = await this.d.rect(args.ref);
      if (!r.inViewport) {
        await this.scrollToRef(args.ref, pace);
        r = await this.d.rect(args.ref);
      }
      const at = aimPoint({ x: r.x, y: r.y }, r.width, r.height, this.d.rng, this.p);
      return { at, width: Math.max(1, Math.min(r.width, r.height)) };
    }
    if (!args.coordinate) throw new ToolError("bad_args", `${args.action} needs coordinate or ref`);
    const [x, y] = args.coordinate;
    return { at: { x, y }, width: this.p.defaultTargetWidth };
  }

  private modBits(args: ComputerArgs): number {
    if (!args.modifiers) return 0;
    // Parse "ctrl+shift" as the modifiers of a combo on a placeholder key.
    return modifiersBits(parseCombo(`${args.modifiers}+a`).mods);
  }

  private async click(args: ComputerArgs, button: keyof typeof BUTTON_BITS, count: number, pace: Pace) {
    const { at, width } = await this.target(args, pace);
    const modifiers = this.modBits(args);
    await this.moveTo(at, width, pace);
    await this.wait(dwellMs(this.d.rng, this.p), pace);
    // Re-read a ref's position: the page may have shifted during the glide.
    let point = at;
    if (args.ref) {
      const r = await this.d.rect(args.ref);
      if (Math.abs(r.x - at.x) > r.width / 2 || Math.abs(r.y - at.y) > r.height / 2) {
        point = { x: r.x, y: r.y };
        await this.moveTo(point, width, pace);
      }
    }
    for (let i = 1; i <= count; i++) {
      const common = { button, buttons: BUTTON_BITS[button], clickCount: i, modifiers };
      await this.mouse("mousePressed", point, common);
      await this.wait(clickHoldMs(this.d.rng, this.p), pace);
      await this.mouse("mouseReleased", point, { ...common, buttons: 0 });
      if (i < count) await this.wait(multiClickGapMs(this.d.rng, this.p), pace);
    }
    return point;
  }

  private async keyEvent(type: string, key: KeyDef, modifiers: number, extra: { [key: string]: unknown } = {}) {
    await this.d.send("Input.dispatchKeyEvent", {
      type,
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
      modifiers,
      ...extra,
    });
  }

  /** Presses one key, holding Shift first when the character needs it.
   * Returns how long the key was held, in ms. */
  private async typeChar(ch: string, pace: Pace): Promise<number> {
    const key = charKey(ch);
    if (!key) {
      await this.d.send("Input.insertText", { text: ch });
      return 0;
    }
    let mods = 0;
    if (key.shift) {
      await this.keyEvent("rawKeyDown", modifierKey("shift"), MOD.shift);
      mods = MOD.shift;
    }
    const text = key.text;
    await this.keyEvent(text ? "keyDown" : "rawKeyDown", key, mods, text ? { text, unmodifiedText: text } : {});
    const hold = keyHoldMs(this.d.rng, this.p);
    await this.wait(hold, pace);
    await this.keyEvent("keyUp", key, mods);
    if (key.shift) await this.keyEvent("keyUp", modifierKey("shift"), 0);
    return hold;
  }

  private async pressCombo(c: Combo, pace: Pace) {
    let bits = 0;
    for (const m of c.mods) {
      bits |= MOD[m];
      await this.keyEvent("rawKeyDown", modifierKey(m), bits);
      await this.wait(30 + 40 * this.d.rng(), pace);
    }
    const typesText = c.key.text && !(bits & (MOD.ctrl | MOD.meta | MOD.alt));
    const commands = this.d.isMac ? macCommands(c) : [];
    await this.keyEvent(typesText ? "keyDown" : "rawKeyDown", c.key, bits, {
      ...(typesText ? { text: c.key.text, unmodifiedText: c.key.text } : {}),
      ...(commands.length ? { commands } : {}),
    });
    await this.wait(keyHoldMs(this.d.rng, this.p), pace);
    await this.keyEvent("keyUp", c.key, bits);
    for (const m of [...c.mods].reverse()) {
      bits &= ~MOD[m];
      await this.keyEvent("keyUp", modifierKey(m), bits);
    }
  }

  private async wheel(at: Pt, dx: number, dy: number) {
    await this.mouse("mouseWheel", at, { deltaX: dx, deltaY: dy, button: "none", buttons: 0 });
  }

  /** Wheels towards a ref until it is in view; falls back to scrollIntoView
   * for containers the wheel at the cursor does not reach. */
  private async scrollToRef(ref: string, pace: Pace) {
    const vp = await this.d.viewport();
    const at = this.cursor ?? { x: vp.width / 2, y: vp.height / 2 };
    let last: Rect | undefined;
    for (let i = 0; i < 40; i++) {
      const r = await this.d.rect(ref);
      if (r.inViewport && r.y > vp.height * 0.15 && r.y < vp.height * 0.85) return;
      if (last && Math.abs(last.y - r.y) < 1 && Math.abs(last.x - r.x) < 1) break; // the wheel moved nothing
      last = r;
      const dy = r.y < vp.height / 2 ? -this.p.wheelDelta : this.p.wheelDelta;
      await this.wheel(at, 0, dy);
      await this.wait(wheelGapMs(this.d.rng, this.p), pace);
    }
    await this.d.scrollIntoView(ref);
  }

  /** Runs one acting action and says what happened. */
  async run(args: ComputerArgs, pace: Pace): Promise<string> {
    switch (args.action) {
      case "left_click": {
        const at = await this.click(args, "left", 1, pace);
        return `Clicked at (${Math.round(at.x)}, ${Math.round(at.y)})`;
      }
      case "right_click": {
        const at = await this.click(args, "right", 1, pace);
        return `Right-clicked at (${Math.round(at.x)}, ${Math.round(at.y)})`;
      }
      case "double_click": {
        const at = await this.click(args, "left", 2, pace);
        return `Double-clicked at (${Math.round(at.x)}, ${Math.round(at.y)})`;
      }
      case "triple_click": {
        const at = await this.click(args, "left", 3, pace);
        return `Triple-clicked at (${Math.round(at.x)}, ${Math.round(at.y)})`;
      }
      case "hover": {
        const { at, width } = await this.target(args, pace);
        await this.moveTo(at, width, pace);
        await this.wait(dwellMs(this.d.rng, this.p), pace);
        return `Hovering at (${Math.round(at.x)}, ${Math.round(at.y)})`;
      }
      case "left_click_drag": {
        if (!args.start_coordinate || !args.coordinate) {
          throw new ToolError("bad_args", "left_click_drag needs start_coordinate and coordinate");
        }
        const [sx, sy] = args.start_coordinate;
        const [ex, ey] = args.coordinate;
        const modifiers = this.modBits(args);
        await this.moveTo({ x: sx, y: sy }, this.p.defaultTargetWidth, pace);
        await this.wait(dwellMs(this.d.rng, this.p), pace);
        await this.mouse("mousePressed", { x: sx, y: sy }, { button: "left", buttons: 1, clickCount: 1, modifiers });
        await this.wait(clickHoldMs(this.d.rng, this.p), pace);
        await this.moveTo({ x: ex, y: ey }, this.p.defaultTargetWidth, pace, 1, modifiers);
        await this.wait(dwellMs(this.d.rng, this.p) / 2, pace);
        await this.mouse("mouseReleased", { x: ex, y: ey }, { button: "left", buttons: 0, clickCount: 1, modifiers });
        return `Dragged from (${sx}, ${sy}) to (${ex}, ${ey})`;
      }
      case "type": {
        if (args.text === undefined) throw new ToolError("bad_args", "type needs text");
        let prev = "";
        let held = 0;
        for (const ch of args.text) {
          // keyGapMs is press to press, and the last key's hold is part of it.
          if (prev) await this.wait(Math.max(0, keyGapMs(this.d.rng, prev, this.p) - held), pace);
          held = await this.typeChar(ch, pace);
          prev = ch;
        }
        return `Typed ${[...args.text].length} characters`;
      }
      case "key": {
        if (!args.text) throw new ToolError("bad_args", "key needs text, e.g. \"Enter\" or \"cmd+a\"");
        const repeat = args.repeat ?? 1;
        if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) {
          throw new ToolError("bad_args", "repeat must be a whole number from 1 to 100");
        }
        const combos = args.text.trim().split(/\s+/).map(parseCombo);
        const zoom = combos.find(isZoomShortcut);
        if (zoom) throw new ToolError("bad_args", "Page zoom shortcuts are not supported; use the zoom action to magnify a region");
        let first = true;
        for (let i = 0; i < repeat; i++) {
          for (const c of combos) {
            if (!first) await this.wait(keyGapMs(this.d.rng, "", this.p), pace);
            await this.pressCombo(c, pace);
            first = false;
          }
        }
        return `Pressed ${args.text}${repeat > 1 ? ` x${repeat}` : ""}`;
      }
      case "scroll": {
        if (!args.scroll_direction) throw new ToolError("bad_args", "scroll needs scroll_direction");
        const ticks = args.scroll_amount ?? 3;
        if (!Number.isInteger(ticks) || ticks < 1 || ticks > 10) throw new ToolError("bad_args", "scroll_amount must be 1 to 10");
        const { at, width } = await this.target(args, pace);
        await this.moveTo(at, width, pace);
        const d = this.p.wheelDelta;
        const [dx, dy] = { up: [0, -d], down: [0, d], left: [-d, 0], right: [d, 0] }[args.scroll_direction];
        for (let i = 0; i < ticks; i++) {
          await this.wheel(at, dx!, dy!);
          await this.wait(wheelGapMs(this.d.rng, this.p), pace);
        }
        return `Scrolled ${args.scroll_direction} ${ticks} notch(es) at (${Math.round(at.x)}, ${Math.round(at.y)})`;
      }
      case "scroll_to": {
        if (!args.ref) throw new ToolError("bad_args", "scroll_to needs ref");
        await this.scrollToRef(args.ref, pace);
        return `Scrolled ${args.ref} into view`;
      }
      case "wait": {
        const s = args.duration ?? 1;
        if (s < 0 || s > 10) throw new ToolError("bad_args", "duration must be 0 to 10 seconds");
        await this.d.sleep(s * 1000);
        return `Waited ${s} s`;
      }
      default:
        throw new ToolError("bad_args", `Unknown action ${args.action}`);
    }
  }
}
