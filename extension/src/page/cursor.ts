// The agent's cursor, drawn on the page so the person watching sees where
// Claude is acting (plans/13-chrome-parity.md, decision 4). The real input
// goes through CDP and has no pointer; this is a twin that replays each
// move's path, sent once per move. It sits in a closed shadow root made by
// the isolated-world content script, takes no pointer events, and is hidden
// during screenshots.
export interface Pt {
  x: number;
  y: number;
}

export interface CursorEnv {
  now(): number;
  raf(cb: (t: number) => void): number;
  cancelRaf(id: number): void;
  reducedMotion(): boolean;
  setTimer(cb: () => void, ms: number): number;
  clearTimer(id: number): void;
}

/** The cursor fades this long after the last move. */
export const IDLE_HIDE_MS = 4000;

export function pageEnv(win: Window): CursorEnv {
  return {
    now: () => performance.now(),
    raf: (cb) => win.requestAnimationFrame(cb),
    cancelRaf: (id) => win.cancelAnimationFrame(id),
    reducedMotion: () => win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    setTimer: (cb, ms) => win.setTimeout(cb, ms),
    clearTimer: (id) => win.clearTimeout(id),
  };
}

const ARROW =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M2 1.5 L2 17 L6.2 13 L9 19.5 L11.6 18.4 L8.9 12 L14.5 12 Z" fill="#d97757" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>';

export class Cursor {
  private host: HTMLElement | undefined;
  private dot: HTMLElement | undefined;
  private at: Pt = { x: 0, y: 0 };
  private hidden = false;
  private faded = true;
  private frame: number | undefined;
  private idle: number | undefined;
  private path: Pt[] = [];

  constructor(
    private doc: Document,
    private env: CursorEnv,
  ) {}

  get position(): Pt {
    return { ...this.at };
  }

  get visible(): boolean {
    return !!this.host && !this.hidden && !this.faded;
  }

  /** Replays `path` (a point every `intervalMs`), snapping to its end if reduced motion is asked for. */
  move(path: Pt[], intervalMs: number) {
    if (!path.length) return;
    this.mount();
    this.stop();
    this.faded = false;
    this.armIdle();
    if (this.env.reducedMotion() || path.length === 1 || intervalMs <= 0) {
      this.place(path[path.length - 1]!);
      return;
    }
    this.path = path;
    this.place(path[0]!);
    const t0 = this.env.now();
    const step = (t: number) => {
      const k = (t - t0) / intervalMs;
      if (k >= path.length - 1) {
        this.frame = undefined;
        this.place(path[path.length - 1]!);
        return;
      }
      const i = Math.floor(k);
      const f = k - i;
      const a = path[i]!;
      const b = path[i + 1]!;
      this.place({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      this.frame = this.env.raf(step);
    };
    this.frame = this.env.raf(step);
  }

  /** Out of sight, for a screenshot. */
  hide() {
    this.hidden = true;
    this.paint();
  }

  show() {
    this.hidden = false;
    this.paint();
  }

  private stop() {
    if (this.frame !== undefined) {
      this.env.cancelRaf(this.frame);
      this.frame = undefined;
      const last = this.path[this.path.length - 1];
      if (last) this.place(last);
    }
  }

  private armIdle() {
    if (this.idle !== undefined) this.env.clearTimer(this.idle);
    this.idle = this.env.setTimer(() => {
      this.idle = undefined;
      this.faded = true;
      this.paint();
    }, IDLE_HIDE_MS);
  }

  private place(p: Pt) {
    this.at = p;
    if (this.dot) this.dot.style.transform = `translate(${p.x}px, ${p.y}px)`;
    this.paint();
  }

  private paint() {
    if (this.host) this.host.style.visibility = this.visible ? "visible" : "hidden";
  }

  private mount() {
    if (this.host?.isConnected) return;
    const host = this.doc.createElement("div");
    host.setAttribute("data-browser-hand-cursor", "");
    host.style.cssText =
      "position:fixed;inset:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none;visibility:hidden";
    const root = host.attachShadow({ mode: "closed" });
    const dot = this.doc.createElement("div");
    dot.style.cssText =
      "position:fixed;left:0;top:0;pointer-events:none;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))";
    dot.innerHTML = ARROW;
    root.appendChild(dot);
    (this.doc.documentElement ?? this.doc.body).appendChild(host);
    this.host = host;
    this.dot = dot;
    dot.style.transform = `translate(${this.at.x}px, ${this.at.y}px)`;
  }
}
