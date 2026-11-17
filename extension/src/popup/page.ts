// The toolbar popup (plans/08-recorder-popup.md; Penpot boards popup--idle,
// popup--empty and popup--steps). Plain DOM like the settings page: built
// once, and `render` writes the view into it. It keeps no recordings of its
// own: the list, one recording and a delete all go through the service
// worker's `Recorder` (`popupOp` in `recorder.ts`). Titles and steps are page
// data, so they are only ever set as text.
import type { PopupMsg, Recording, Summary } from "../recorder";
import { stepLine } from "./lines";

export interface PopupApi {
  /** One popup op; rejects with the worker's error. */
  send(msg: PopupMsg): Promise<unknown>;
  /** The window the popup opened over (`windows.getCurrent`), not the focused one. */
  windowId(): Promise<number>;
  openSettings(): void;
  close(): void;
  now(): number;
}

/** `stopNow`'s reason when the person stopped it. */
export const PERSON_STOP = "stopped by the person";

const pad = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "Today 18:09", "Yesterday 11:20", else "2026-10-19 11:20", in local time. */
export function when(ms: number, now: number): string {
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day(d) === day(new Date(now))) return `Today ${time}`;
  if (day(d) === day(yesterday)) return `Yesterday ${time}`;
  return `${day(d)} ${time}`;
}

/** How a recording ended, as the person reads it. */
export function stateText(s: Summary, recording: string | null): string {
  if (s.id === recording) return "recording";
  if (!s.stopReason) return "stopped";
  return s.stopReason === PERSON_STOP ? "stopped by you" : `stopped: ${s.stopReason}`;
}

const stepCount = (n: number) => `${n} ${n === 1 ? "step" : "steps"}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Attrs = { [k: string]: string | boolean | undefined };

/** Builds the popup's DOM and keeps it in step with the state. */
export class PopupPage {
  private doc: Document;
  private els = new Map<string, HTMLElement>();
  /** `null` until the worker answers. */
  private list: Summary[] | null = null;
  private recording: string | null = null;
  private open: { summary: Summary; rec: Recording } | null = null;
  private confirming = false;
  private starting = false;
  private error: string | null = null;
  /** Settles once the first list is in; tests wait on it. */
  readonly ready: Promise<void>;

  constructor(
    private root: HTMLElement,
    private api: PopupApi,
  ) {
    this.doc = root.ownerDocument;
    this.build();
    this.render();
    this.get("start").focus();
    this.ready = this.load();
  }

  // Building.

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Attrs = {},
    ...kids: (Node | string)[]
  ): HTMLElementTagNameMap[K] {
    const e = this.doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      if (k === "class") e.className = String(v);
      else e.setAttribute(k, v === true ? "" : String(v));
    }
    e.append(...kids);
    if (typeof attrs.id === "string") this.els.set(attrs.id, e);
    return e;
  }

  /** An element by id; every id is made in `build`. */
  get<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.els.get(id) as T;
  }

  private button(id: string, cls: string, onClick: () => void, ...kids: (Node | string)[]) {
    const b = this.el("button", { type: "button", id, class: cls }, ...kids);
    b.addEventListener("click", onClick);
    return b;
  }

  private build() {
    const head = this.el(
      "header",
      { class: "head" },
      this.el("h1", { id: "title" }, "browser-hand"),
      this.button("back", "link", () => this.back(), "‹ Back"),
      this.button("settings", "link", () => this.settings(), "Settings"),
    );
    const listView = this.el(
      "div",
      { class: "view", id: "list-view" },
      this.button(
        "start",
        "start",
        () => void this.start(),
        this.el("i", { class: "rec-dot", "aria-hidden": "true" }),
        "Start recording",
      ),
      this.el("p", { class: "hint" }, "Records this window. Alt+Shift+R starts and stops it too."),
      this.el(
        "div",
        { class: "empty", id: "empty" },
        this.el("h2", {}, "No recordings yet"),
        this.el(
          "p",
          { class: "hint" },
          "Press Start recording, do the task, then click the toolbar button again to stop. Claude can then read it back or do it again.",
        ),
      ),
      this.el(
        "div",
        { class: "recent", id: "recent" },
        this.el("h2", { class: "label", id: "recent-label" }, "Recent recordings"),
        this.el("ul", { class: "recordings", id: "recordings", "aria-labelledby": "recent-label" }),
      ),
      this.el(
        "p",
        { class: "hint foot", id: "foot" },
        "Recordings stay in this profile. Passwords and card numbers are saved masked.",
      ),
    );
    const stepsView = this.el(
      "div",
      { class: "view", id: "steps-view" },
      this.el("h2", { class: "rec-title", id: "rec-title" }),
      this.el("p", { class: "hint", id: "rec-meta" }),
      this.el("ol", {
        class: "steps",
        id: "steps",
        tabindex: "0",
        "aria-label": "Steps, as Claude reads them",
      }),
      this.el(
        "div",
        { class: "actions" },
        this.button("delete", "button danger", () => this.confirm(true), "Delete"),
        this.button("cancel", "button", () => this.confirm(false), "Keep it"),
        this.button("confirm", "button danger solid", () => void this.remove(), "Delete for good"),
        this.el(
          "p",
          { class: "hint", id: "use-hint" },
          'Ask Claude "what did I just record?" to use it.',
        ),
      ),
    );
    const error = this.el("p", { class: "error", id: "error", role: "alert" });
    this.doc.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.open) return;
      // Escape steps back once: out of the confirm, then out of the steps.
      e.preventDefault();
      if (this.confirming) this.confirm(false);
      else this.back();
    });
    this.root.replaceChildren(head, listView, stepsView, error);
  }

  // State.

  private async load() {
    try {
      const r = (await this.api.send({ __bhPopup: "list" })) as {
        recordings: Summary[];
        recording: string | null;
      };
      if (r.recording) {
        // The popup is off while recording, so this click came through a
        // popup value Chrome lost; the person clicked to stop.
        await this.api.send({ __bhPopup: "stop" });
        this.api.close();
        return;
      }
      this.list = r.recordings;
      this.recording = r.recording;
    } catch (e) {
      this.list = [];
      this.error = message(e);
    }
    this.renderList();
    this.render();
  }

  private async start() {
    if (this.starting) return;
    this.starting = true;
    this.error = null;
    this.render();
    try {
      await this.api.send({ __bhPopup: "start", windowId: await this.api.windowId() });
      this.api.close();
    } catch (e) {
      this.starting = false;
      this.error = message(e);
      this.render();
    }
  }

  private settings() {
    this.api.openSettings();
    this.api.close();
  }

  private async show(s: Summary) {
    try {
      const rec = (await this.api.send({ __bhPopup: "get", id: s.id })) as Recording;
      this.open = { summary: s, rec };
      this.confirming = false;
      this.error = null;
      this.renderSteps();
      this.render();
      this.get("back").focus();
    } catch (e) {
      this.error = message(e);
      this.render();
    }
  }

  private back() {
    const id = this.open?.summary.id;
    this.open = null;
    this.confirming = false;
    this.error = null;
    this.render();
    const row = [...this.get("recordings").querySelectorAll<HTMLButtonElement>("button.row")].find(
      (b) => b.dataset.id === id,
    );
    (row ?? this.get("start")).focus();
  }

  private confirm(on: boolean) {
    if (!this.open) return;
    this.confirming = on;
    this.render();
    // Focus lands on Keep it, so a second Enter by reflex deletes nothing.
    this.get(on ? "cancel" : "delete").focus();
  }

  private async remove() {
    const id = this.open?.summary.id;
    if (!id || !this.confirming) return;
    try {
      await this.api.send({ __bhPopup: "delete", id });
      this.list = (this.list ?? []).filter((s) => s.id !== id);
      this.open = null;
      this.confirming = false;
      this.error = null;
      this.renderList();
      this.render();
      this.get("start").focus();
    } catch (e) {
      this.confirming = false;
      this.error = message(e);
      this.render();
      this.get("delete").focus();
    }
  }

  // Rendering.

  private renderList() {
    const now = this.api.now();
    const rows = (this.list ?? []).map((s) => {
      const state = stateText(s, this.recording);
      const meta = [
        when(s.startedAt, now),
        stepCount(s.steps),
        ...(state === "stopped by you" ? [] : [state]),
      ].join(" · ");
      const b = this.el(
        "button",
        { type: "button", class: "row", "data-id": s.id },
        this.el(
          "span",
          { class: "row-text" },
          this.el("span", { class: "row-title" }, s.title || "Recording"),
          this.el("span", { class: "row-meta" }, meta),
        ),
        this.el("span", { class: "open", "aria-hidden": "true" }, "›"),
      );
      b.addEventListener("click", () => void this.show(s));
      return this.el("li", {}, b);
    });
    this.get("recordings").replaceChildren(...rows);
  }

  private renderSteps() {
    if (!this.open) return;
    const { summary, rec } = this.open;
    const steps = rec.flow?.steps ?? [];
    this.get("rec-title").textContent = rec.title || "Recording";
    this.get("rec-meta").textContent = [
      when(rec.startedAt, this.api.now()),
      stepCount(steps.length),
      stateText(summary, this.recording),
    ].join(" · ");
    const lines = this.doc.createDocumentFragment();
    steps.forEach((step, i) => {
      lines.append(this.el("li", {}, stepLine(i + 1, step, rec.meta?.[i])));
    });
    this.get("steps").replaceChildren(lines);
  }

  render() {
    const open = !!this.open;
    const n = this.list?.length ?? 0;
    this.get("title").hidden = open;
    this.get("back").hidden = !open;
    this.get("list-view").hidden = open;
    this.get("steps-view").hidden = !open;
    this.get<HTMLButtonElement>("start").disabled = this.starting;
    this.get("empty").hidden = this.list === null || n > 0;
    this.get("recent").hidden = n === 0;
    this.get("foot").hidden = n === 0;
    this.get("delete").hidden = this.confirming;
    this.get("cancel").hidden = !this.confirming;
    this.get("confirm").hidden = !this.confirming;
    this.get("use-hint").hidden = this.confirming;
    this.get("error").textContent = this.error ?? "";
    this.get("error").hidden = !this.error;
  }
}
