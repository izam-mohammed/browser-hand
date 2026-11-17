// The person's steps, captured in the page (plans/05-record-steps.md). While
// the service worker says this tab's window is recording, capture-phase
// listeners turn trusted clicks, field changes, Enter, Tab and Escape, and
// sampled scrolls into DevTools Recorder steps (docs/external/puppeteer-replay.md),
// each naming its element several ways: aria/, text/, CSS, xpath/, and
// pierce/ inside shadow roots. Sensitive values never leave the page.
import { find } from "./find";
import { allElements, isInteractiveRole, nameOf, resolveRef, roleOf } from "./walker";

/** One selector: a string, or a chain through shadow roots (last is the target). */
export type Selector = string | string[];

export interface Step {
  type: string;
  selectors?: Selector[];
  [field: string]: unknown;
}

/** What the content script sends the service worker for each step. */
export interface StepMsg {
  step: Step;
  ts: number;
  masked?: true;
}

/** Names and text in selectors are page data; capped so a page cannot fill a step. */
export const NAME_MAX = 120;
export const MASKED = "<masked>";
/** Scrolls settle this long before one step is taken. */
export const SCROLL_SETTLE_MS = 400;

const SENSITIVE_AUTOCOMPLETE = new Set(["one-time-code", "current-password", "new-password"]);

function cap(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > NAME_MAX ? t.slice(0, NAME_MAX) : t;
}

/** Passwords, card fields and one-time codes: their values are never recorded. */
export function isSensitive(el: Element): boolean {
  if (el.tagName.toLowerCase() === "input" && (el as HTMLInputElement).type === "password")
    return true;
  const tokens = (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
  return tokens.some((t) => t.startsWith("cc-") || SENSITIVE_AUTOCOMPLETE.has(t));
}

/** Shadow hosts between the document and `el`, outermost first. */
function shadowHosts(el: Element): Element[] {
  const hosts: Element[] = [];
  let root = el.getRootNode();
  while (root instanceof ShadowRoot) {
    hosts.unshift(root.host);
    root = root.host.getRootNode();
  }
  return hosts;
}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** A CSS path inside `el`'s own root: `#id`, then `[name]`, `[data-testid]`, then nth-of-type steps. */
export function cssFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return /^[A-Za-z_][\w-]*$/.test(el.id) ? `#${el.id}` : `[id=${quote(el.id)}]`;
  const name = el.getAttribute("name");
  if (name) return `${tag}[name=${quote(name)}]`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid=${quote(testId)}]`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.tagName.toLowerCase() !== "html") {
    const t = node.tagName.toLowerCase();
    if (node !== el && node.id && /^[A-Za-z_][\w-]*$/.test(node.id)) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    const same = parent ? [...parent.children].filter((c) => c.tagName === node!.tagName) : [];
    parts.unshift(same.length > 1 ? `${t}:nth-of-type(${same.indexOf(node) + 1})` : t);
    node = parent;
  }
  return parts.join(" > ");
}

function xpathFor(el: Element): string {
  if (el.id) return `//*[@id=${quote(el.id)}]`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node) {
    const parent: Element | null = node.parentElement;
    const tag = node.tagName.toLowerCase();
    const same = parent ? [...parent.children].filter((c) => c.tagName === node!.tagName) : [];
    parts.unshift(same.length > 1 ? `${tag}[${same.indexOf(node) + 1}]` : tag);
    node = parent;
  }
  return `/${parts.join("/")}`;
}

/** Every way to find `el` again, in the Recorder's order: aria/, text/, CSS, xpath/, pierce/. */
export function selectorsFor(el: Element): Selector[] {
  const out: Selector[] = [];
  const role = roleOf(el);
  const name = cap(nameOf(el));
  if (name) out.push([role ? `aria/${name}[role=${quote(role)}]` : `aria/${name}`]);
  const tag = el.tagName.toLowerCase();
  if (!["input", "textarea", "select"].includes(tag)) {
    const text = cap((el as HTMLElement).innerText ?? el.textContent ?? "");
    if (text && text.length <= 64) out.push([`text/${text}`]);
  }
  const hosts = shadowHosts(el);
  out.push([...hosts.map(cssFor), cssFor(el)]);
  if (hosts.length) out.push([`pierce/${cssFor(el)}`]);
  else out.push([`xpath/${xpathFor(el)}`]);
  return out;
}

/** This frame's path from the top: each level's index among its parent's frames. */
export function framePath(win: Window): number[] {
  const path: number[] = [];
  let w: Window = win;
  while (w !== w.parent) {
    const parent = w.parent;
    let index = -1;
    for (let i = 0; i < parent.frames.length; i++) {
      if (parent.frames[i] === w) index = i;
    }
    if (index < 0) break;
    path.unshift(index);
    w = parent;
  }
  return path;
}

/** Rich text the person types into; jsdom has no `isContentEditable`, so the attribute too. */
const isEditable = (el: Element) =>
  (el as HTMLElement).isContentEditable === true ||
  el.closest(
    '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
  ) !== null;

const isField = (el: Element) => {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag !== "input") return false;
  return !["checkbox", "radio", "file", "button", "submit", "reset", "image", "hidden"].includes(
    (el as HTMLInputElement).type,
  );
};

/** The element an event really hit, through shadow roots. */
function hit(e: Event): Element | null {
  const first = e.composedPath()[0];
  return first instanceof Element ? first : e.target instanceof Element ? e.target : null;
}

/** The control a click meant: the nearest ancestor with an interactive role. */
function actionable(el: Element): Element {
  let node: Element | null = el;
  for (let i = 0; node && i < 6; i++) {
    if (isInteractiveRole(roleOf(node))) return node;
    const root = node.getRootNode();
    node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return el;
}

/** Listens while on; each trusted step goes to `send`. */
export class Capture {
  private on = false;
  private frame: number[] = [];
  /** The value each field last recorded, so a change is not taken twice. */
  private lastValue = new WeakMap<Element, string>();
  private editStart = new WeakMap<Element, string>();
  private scrollTimers = new Map<EventTarget, ReturnType<typeof setTimeout>>();
  private listeners: [string, (e: Event) => void][] = [];

  /** `trusted` is `isTrusted` in Chrome; tests stand in for it, since
   * jsdom cannot make a trusted event. Pages' synthetic events are dropped. */
  constructor(
    private win: Window,
    private send: (msg: StepMsg) => void,
    private trusted: (e: Event) => boolean = (e) => e.isTrusted,
  ) {}

  get recording() {
    return this.on;
  }

  start() {
    if (this.on) return;
    this.on = true;
    try {
      this.frame = framePath(this.win);
    } catch {
      this.frame = [];
    }
    this.listeners = [
      ["click", (e) => this.click(e as MouseEvent, "click")],
      ["dblclick", (e) => this.click(e as MouseEvent, "doubleClick")],
      ["change", (e) => this.change(e)],
      ["keydown", (e) => this.key(e as KeyboardEvent)],
      ["focusin", (e) => this.focusIn(e)],
      ["focusout", (e) => this.focusOut(e)],
      ["scroll", (e) => this.scroll(e)],
    ];
    for (const [type, fn] of this.listeners) this.win.addEventListener(type, fn, true);
  }

  stop() {
    this.on = false;
    for (const [type, fn] of this.listeners) this.win.removeEventListener(type, fn, true);
    this.listeners = [];
    for (const t of this.scrollTimers.values()) clearTimeout(t);
    this.scrollTimers.clear();
  }

  private emit(step: Step, masked = false) {
    if (this.frame.length) step.frame = this.frame;
    this.send({ step, ts: Date.now(), ...(masked ? { masked: true as const } : {}) });
  }

  private click(e: MouseEvent, type: "click" | "doubleClick") {
    if (!this.trusted(e)) return;
    const target = hit(e);
    if (!target) return;
    const el = actionable(target);
    const r = el.getBoundingClientRect();
    const step: Step = {
      type,
      selectors: selectorsFor(el),
      offsetX: Math.max(0, Math.round(e.clientX - r.left)),
      offsetY: Math.max(0, Math.round(e.clientY - r.top)),
    };
    if (e.button === 1) step.button = "auxiliary";
    else if (e.button === 2) step.button = "secondary";
    this.emit(step);
  }

  /** A field's final value as a `change` step, once per value. */
  private fieldChange(el: Element) {
    const value = (el as HTMLInputElement).value ?? "";
    if (this.lastValue.get(el) === value) return;
    this.lastValue.set(el, value);
    const masked = isSensitive(el);
    this.emit(
      { type: "change", selectors: selectorsFor(el), value: masked ? MASKED : value },
      masked,
    );
  }

  private change(e: Event) {
    if (!this.trusted(e)) return;
    const el = hit(e);
    if (el && isField(el)) this.fieldChange(el);
  }

  private key(e: KeyboardEvent) {
    if (!this.trusted(e) || !["Enter", "Tab", "Escape"].includes(e.key)) return;
    // Enter can submit before the field's change fires; take the value first.
    const el = hit(e);
    if (el && isField(el) && el.tagName.toLowerCase() !== "select") this.fieldChange(el);
    this.emit({ type: "keyDown", key: e.key });
    this.emit({ type: "keyUp", key: e.key });
  }

  private focusIn(e: Event) {
    const el = hit(e);
    if (this.trusted(e) && el && isEditable(el)) this.editStart.set(el, el.textContent ?? "");
  }

  /** contenteditable has no change event: its text is taken when focus leaves. */
  private focusOut(e: Event) {
    const el = hit(e);
    if (!this.trusted(e) || !el || !isEditable(el) || !this.editStart.has(el)) return;
    const before = this.editStart.get(el);
    this.editStart.delete(el);
    const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
    if (text !== before) this.emit({ type: "change", selectors: selectorsFor(el), value: text });
  }

  /** One step per scroll gesture, once it settles. */
  private scroll(e: Event) {
    if (!this.trusted(e)) return;
    const target = e.target;
    if (!target) return;
    clearTimeout(this.scrollTimers.get(target));
    this.scrollTimers.set(
      target,
      setTimeout(() => {
        this.scrollTimers.delete(target);
        if (!this.on) return;
        const doc = this.win.document;
        if (
          target === doc ||
          target === doc.documentElement ||
          target === this.win ||
          target === doc.body
        ) {
          this.emit({
            type: "scroll",
            x: Math.round(this.win.scrollX),
            y: Math.round(this.win.scrollY),
          });
        } else if (target instanceof Element) {
          this.emit({
            type: "scroll",
            selectors: selectorsFor(target),
            x: Math.round(target.scrollLeft),
            y: Math.round(target.scrollTop),
          });
        }
      }, SCROLL_SETTLE_MS),
    );
  }
}

/** Holds steps until the service worker takes them; it may be stopped and
 * waking, so a failed send is retried in order. */
export class Outbox {
  private queue: StepMsg[] = [];
  private busy = false;

  constructor(
    private deliver: (msg: StepMsg) => Promise<unknown>,
    private retryMs = 1000,
  ) {}

  get pending() {
    return this.queue.length;
  }

  push(msg: StepMsg) {
    this.queue.push(msg);
    void this.flush();
  }

  private async flush() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        try {
          await this.deliver(this.queue[0]!);
          this.queue.shift();
        } catch {
          setTimeout(() => void this.flush(), this.retryMs);
          return;
        }
      }
    } finally {
      this.busy = false;
    }
  }
}

// Replay: finding a recorded element again.

/** CSS through every shadow root under `root`. */
function deepQuery(root: ParentNode, css: string): Element | null {
  const direct = root.querySelector(css);
  if (direct) return direct;
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      const found = deepQuery(el.shadowRoot, css);
      if (found) return found;
    }
  }
  return null;
}

const ARIA = /^aria\/(.*?)(?:\[role="([^"]*)"\])?$/s;

function byName(
  doc: Document,
  name: string,
  role: string | undefined,
  matchText: boolean,
): Element | null {
  const body = doc.body ?? doc.documentElement;
  const want = name.toLowerCase();
  // `find` ranks by words; keep only exact names among its best.
  for (const m of find(body, name).matches) {
    if (m.name.toLowerCase() !== want || (role && m.role !== role)) continue;
    const el = resolveRef(m.ref);
    if (el) return el;
  }
  let last: Element | null = null;
  for (const el of allElements(body)) {
    if (role && roleOf(el) !== role) continue;
    const label = matchText
      ? cap((el as HTMLElement).innerText ?? el.textContent ?? "")
      : cap(nameOf(el));
    if (label.toLowerCase() === want) {
      if (!matchText) return el;
      last = el; // the deepest element with exactly this text
    }
  }
  return last;
}

function resolveOne(doc: Document, sel: Selector): Element | null {
  const chain = typeof sel === "string" ? [sel] : sel;
  if (!chain.length) return null;
  const first = chain[0]!;
  if (chain.length === 1) {
    const aria = ARIA.exec(first);
    if (aria) return byName(doc, aria[1]!, aria[2], false);
    if (first.startsWith("text/")) return byName(doc, first.slice(5), undefined, true);
    if (first.startsWith("xpath/")) {
      const r = doc.evaluate(first.slice(6), doc, null, 9 /* FIRST_ORDERED_NODE_TYPE */, null);
      return r.singleNodeValue instanceof Element ? r.singleNodeValue : null;
    }
    if (first.startsWith("pierce/")) return deepQuery(doc, first.slice(7));
  }
  let root: ParentNode = doc;
  let el: Element | null = null;
  for (const [i, part] of chain.entries()) {
    el = root.querySelector(part);
    if (!el) return null;
    if (i < chain.length - 1) {
      if (!el.shadowRoot) return null;
      root = el.shadowRoot;
    }
  }
  return el;
}

const show = (sel: Selector) => (typeof sel === "string" ? sel : sel.join(" >>> "));

/** The first selector that finds an element, and what was tried. */
export function resolveSelectors(
  doc: Document,
  selectors: Selector[],
): { el: Element | null; tried: string[] } {
  const tried: string[] = [];
  for (const sel of selectors) {
    tried.push(show(sel));
    let el: Element | null = null;
    try {
      el = resolveOne(doc, sel);
    } catch {
      el = null; // a selector this page cannot parse
    }
    if (el) return { el, tried };
  }
  return { el: null, tried };
}

/** How replay sets a recorded value into an element. */
export function fieldKind(el: Element): "select" | "check" | "text" | "editable" | "other" {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") return "select";
  if (tag === "input" && ["checkbox", "radio"].includes((el as HTMLInputElement).type))
    return "check";
  if (tag === "textarea" || (tag === "input" && isField(el))) return "text";
  if (isEditable(el)) return "editable";
  return "other";
}
