// The settings page (plans/06-settings.md; design/settings--*.png). Plain
// DOM: the page is built once, and `render` writes the state into it, one
// function per section. It edits a draft of the settings the service worker
// sent, counts what changed, and asks the worker to save; the worker, the
// native host and `config.toml` do the rest (`settings.ts`).

import type { PageMsg, PageState, Settings, WorkerMsg } from "../settings";
import { patternProblem } from "../sites";

export interface PagePort {
  postMessage(msg: PageMsg): void;
  onMessage: { addListener(cb: (msg: WorkerMsg) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

export const TOAST_MS = 4_000;
export const SIZES = [
  ["1024x640", "1024 × 640"],
  ["1280x800", "1280 × 800"],
  ["1568x980", "1568 × 980"],
] as const;

type ListKey = "blocked" | "read_only" | "allowed";
const LISTS: readonly ListKey[] = ["blocked", "read_only", "allowed"];

const clone = (s: Settings): Settings => structuredClone(s);

/** "1.0×" for a speed, "0.25×" when it needs two places. */
export function speedLabel(v: number): string {
  return `${Number.isInteger(Math.round(v * 100) / 10) ? v.toFixed(1) : v.toFixed(2)}×`;
}

/** Why the GIF folder cannot be saved (the host checks the same). */
export function folderProblem(folder: string): string | null {
  if (!folder) return "Needs a folder.";
  return pathProblem(folder);
}

/** Why an optional folder or file cannot be saved: empty is fine. */
export function optionalPathProblem(path: string): string | null {
  return path ? pathProblem(path) : null;
}

function pathProblem(folder: string): string | null {
  if (!(folder === "~" || folder.startsWith("~/") || folder.startsWith("/")))
    return "Start with ~/ or /.";
  if (folder.split("/").includes("..")) return "May not contain ..";
  return null;
}

function numberProblem(v: number, lo: number, hi: number, unit: string): string | null {
  return Number.isInteger(v) && v >= lo && v <= hi
    ? null
    : `A whole number from ${lo} to ${hi} ${unit}.`;
}

/** How many edits `draft` holds over `base`: one per value, one per
 * pattern added or removed. */
export function changeCount(base: Settings, draft: Settings): number {
  let n = 0;
  const scalars: [unknown, unknown][] = [
    [base.input.pace, draft.input.pace],
    [base.input.typing_speed, draft.input.typing_speed],
    [base.input.mouse_speed, draft.input.mouse_speed],
    [base.sessions.default_profile, draft.sessions.default_profile],
    [base.sessions.new_window, draft.sessions.new_window],
    [base.sessions.close_tabs_on_end, draft.sessions.close_tabs_on_end],
    [base.capture.screenshot_size, draft.capture.screenshot_size],
    [base.capture.screenshot_quality, draft.capture.screenshot_quality],
    [base.capture.gif_folder, draft.capture.gif_folder],
    [base.capture.save_screenshots, draft.capture.save_screenshots],
    [base.capture.screenshot_folder, draft.capture.screenshot_folder],
    [base.capture.gif_frame_delay_ms, draft.capture.gif_frame_delay_ms],
    [base.audit.enabled, draft.audit.enabled],
    [base.audit.file, draft.audit.file],
    [base.debugger.detach_after_idle_s, draft.debugger.detach_after_idle_s],
  ];
  for (const [a, b] of scalars) if (!Object.is(a, b)) n++;
  for (const k of LISTS) {
    const was = new Set(base.sites[k]);
    const now = new Set(draft.sites[k]);
    for (const p of now) if (!was.has(p)) n++;
    for (const p of was) if (!now.has(p)) n++;
  }
  return n;
}

type Attrs = { [k: string]: string | boolean | number | undefined };

/** Builds the page's DOM and keeps it in step with the state. */
export class SettingsPage {
  private doc: Document;
  private latest: PageState | null = null;
  /** The settings and revision the draft was made from. */
  private base: { settings: Settings; revision: string } | null = null;
  private draft: Settings | null = null;
  private listErrors = new Map<ListKey, string>();
  private saveError: string | null = null;
  private saving = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private els = new Map<string, HTMLElement>();

  constructor(
    private root: HTMLElement,
    private port: PagePort,
  ) {
    this.doc = root.ownerDocument;
    this.build();
    port.onMessage.addListener((msg) => this.receive(msg));
    port.onDisconnect.addListener(() => {
      // The worker went away (the extension reloaded): nothing can be saved.
      if (this.latest)
        this.receive({
          type: "state",
          state: { ...this.latest, connected: false, down: "not_running" },
        });
    });
    this.render();
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

  private section(title: string, desc: string | null, ...body: Node[]) {
    return this.el(
      "section",
      { class: "card" },
      this.el("h2", {}, title),
      ...(desc ? [this.el("p", { class: "desc" }, desc)] : []),
      ...body,
    );
  }

  private row(id: string, label: string, help: string, control: Node) {
    return this.el(
      "div",
      { class: "row" },
      this.el(
        "div",
        { class: "text" },
        this.el("label", { for: id, id: `${id}-label` }, label),
        this.el("p", { class: "help" }, help),
        this.el("p", { class: "error", id: `${id}-error`, hidden: true }),
      ),
      this.el("div", { class: "control" }, control),
    );
  }

  private slider(id: string, min: number, max: number, step: number, onInput: (v: number) => void) {
    const input = this.el("input", { type: "range", id, min, max, step });
    input.addEventListener("input", () => onInput(Number(input.value)));
    return this.el(
      "div",
      { class: "slider" },
      input,
      this.el("output", { id: `${id}-value`, for: id }),
    );
  }

  private toggle(id: string, onFlip: (on: boolean) => void) {
    const b = this.el(
      "button",
      { type: "button", role: "switch", id, class: "toggle", "aria-checked": "false" },
      this.el("span", { class: "knob" }),
    );
    b.addEventListener("click", () => onFlip(b.getAttribute("aria-checked") !== "true"));
    return b;
  }

  private number(id: string, unit: string, onInput: (v: number) => void) {
    const input = this.el("input", {
      type: "text",
      inputmode: "numeric",
      id,
      class: "mono",
      autocomplete: "off",
      spellcheck: "false",
    });
    input.addEventListener("input", () =>
      onInput(input.value.trim() === "" ? NaN : Number(input.value)),
    );
    return this.el(
      "div",
      { class: "field unit" },
      input,
      this.el("span", { class: "unit-label" }, unit),
    );
  }

  private patterns(key: ListKey, label: string, help: string) {
    const input = this.el("input", {
      type: "text",
      id: `${key}-input`,
      class: "mono",
      placeholder: "example.com/*",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": `Add to ${label.toLowerCase()}`,
    });
    const add = this.el("button", { type: "button", class: "button", id: `${key}-add` }, "Add");
    const submit = () => this.addPattern(key, input.value.trim());
    add.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    input.addEventListener("input", () => {
      if (this.listErrors.delete(key)) this.render();
    });
    return this.el(
      "div",
      { class: "sites" },
      this.el("h3", {}, label),
      this.el("p", { class: "help" }, help),
      this.el("ul", { class: "patterns", id: `${key}-list`, "aria-label": label }),
      this.el("div", { class: "add" }, input, add),
      this.el("p", { class: "error", id: `${key}-error`, role: "alert", hidden: true }),
    );
  }

  private build() {
    const pace = this.el(
      "div",
      { class: "segmented", role: "radiogroup", id: "pace", "aria-labelledby": "pace-label" },
      this.el(
        "button",
        { type: "button", role: "radio", id: "pace-human", "aria-checked": "false" },
        "Human",
      ),
      this.el(
        "button",
        { type: "button", role: "radio", id: "pace-fast", "aria-checked": "false" },
        "Fast",
      ),
    );
    this.get("pace-human").addEventListener("click", () =>
      this.edit((d) => (d.input.pace = "human")),
    );
    this.get("pace-fast").addEventListener("click", () =>
      this.edit((d) => (d.input.pace = "fast")),
    );

    const profile = this.el("select", { id: "default-profile" });
    profile.addEventListener("change", () =>
      this.edit((d) => (d.sessions.default_profile = profile.value)),
    );
    const size = this.el(
      "select",
      { id: "shot-size" },
      ...SIZES.map(([v, label]) => this.el("option", { value: v }, label)),
    );
    size.addEventListener("change", () =>
      this.edit((d) => (d.capture.screenshot_size = size.value)),
    );
    const optionalPath = (id: string, edit: (d: Settings, v: string) => void, hint: string) => {
      const input = this.el("input", {
        type: "text",
        id,
        class: "mono",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: hint,
      });
      input.addEventListener("input", () => this.edit((d) => edit(d, input.value.trim())));
      return input;
    };
    const shotFolder = optionalPath(
      "shot-folder",
      (d, v) => (d.capture.screenshot_folder = v),
      "Same as the GIF folder",
    );
    const auditFile = optionalPath(
      "audit-file",
      (d, v) => (d.audit.file = v),
      "The browser-hand settings folder",
    );
    const folder = this.el("input", {
      type: "text",
      id: "gif-folder",
      class: "mono",
      autocomplete: "off",
      spellcheck: "false",
    });
    folder.addEventListener("input", () =>
      this.edit((d) => (d.capture.gif_folder = folder.value.trim())),
    );

    const main = this.el(
      "main",
      { class: "page" },
      this.el(
        "header",
        { class: "head" },
        this.el(
          "div",
          {},
          this.el("h1", {}, "browser-hand"),
          this.el("p", { class: "intro" }, "Settings apply to every Chrome profile."),
        ),
        this.el(
          "span",
          { class: "pill", id: "pill", role: "status" },
          this.el("i", { class: "dot" }),
          this.el("span", { id: "pill-text" }),
        ),
      ),
      this.el(
        "div",
        { class: "banner", id: "banner", hidden: true, role: "alert" },
        this.el(
          "div",
          {},
          this.el("strong", { id: "banner-title" }),
          this.el("p", { id: "banner-body" }),
        ),
        this.el("button", { type: "button", class: "button", id: "retry" }, "Retry"),
      ),
      this.el("div", { class: "warnings", id: "warnings", hidden: true }),
      this.el(
        "div",
        { class: "sections", id: "sections" },
        this.section(
          "Input",
          "How the cursor and keyboard move. Human pace is slower and harder for sites to tell apart from you.",
          this.row("pace", "Pace", "Fast keeps the same events without travel time.", pace),
          this.row(
            "typing",
            "Typing speed",
            "Multiplies the gap between keys. 0.5 is twice as fast.",
            this.slider("typing", 0.25, 3, 0.05, (v) =>
              this.edit((d) => (d.input.typing_speed = v)),
            ),
          ),
          this.row(
            "mouse",
            "Mouse speed",
            "Scales how fast the cursor travels.",
            this.slider("mouse", 0.25, 3, 0.05, (v) => this.edit((d) => (d.input.mouse_speed = v))),
          ),
        ),
        this.section(
          "Sessions",
          "What Claude opens when a session starts and ends.",
          this.row(
            "default-profile",
            "Default profile",
            "Used when Claude is not told which profile to drive.",
            this.el("div", { class: "select" }, profile),
          ),
          this.row(
            "new-window",
            "Open a new window",
            "Off puts the tab group in your current window.",
            this.toggle("new-window", (on) => this.edit((d) => (d.sessions.new_window = on))),
          ),
          this.row(
            "close-tabs",
            "Close tabs when the session ends",
            "Off leaves Claude's tabs open for you.",
            this.toggle("close-tabs", (on) =>
              this.edit((d) => (d.sessions.close_tabs_on_end = on)),
            ),
          ),
        ),
        this.section(
          "Site access",
          "Enforced in the extension, so a request from the server cannot get past it. One pattern per line, * matches anything.",
          this.patterns("blocked", "Blocked sites", "Claude never opens or acts on these."),
          this.patterns(
            "read_only",
            "Read-only sites",
            "Claude can read these but not click, type or run scripts.",
          ),
          this.patterns(
            "allowed",
            "Allowed sites",
            "When this list has anything in it, Claude may open and act on only these sites (blocked ones still win). Empty means no limit.",
          ),
        ),
        this.section(
          "Capture",
          "Screenshots Claude takes and GIFs it records.",
          this.row(
            "shot-size",
            "Screenshot size",
            "Bigger shows more detail and costs more tokens.",
            this.el("div", { class: "select" }, size),
          ),
          this.row(
            "shot-quality",
            "Screenshot quality",
            "JPEG quality.",
            this.slider("shot-quality", 30, 100, 1, (v) =>
              this.edit((d) => (d.capture.screenshot_quality = v)),
            ),
          ),
          this.row(
            "gif-folder",
            "GIF folder",
            "Where GIFs and saved screenshots go.",
            this.el("div", { class: "field wide" }, folder),
          ),
          this.row(
            "save-shots",
            "Save every screenshot",
            "Off: only when Claude asks. On: each screenshot Claude takes is also written to a file.",
            this.toggle("save-shots", (on) => this.edit((d) => (d.capture.save_screenshots = on))),
          ),
          this.row(
            "shot-folder",
            "Screenshot folder",
            "Where saved screenshots go. Empty uses the GIF folder.",
            this.el("div", { class: "field wide" }, shotFolder),
          ),
          this.row(
            "gif-delay",
            "GIF frame delay",
            "Playback speed of recordings.",
            this.number("gif-delay", "ms", (v) =>
              this.edit((d) => (d.capture.gif_frame_delay_ms = v)),
            ),
          ),
        ),
        this.section(
          "Audit log",
          "A private file with one line for each thing Claude does: the tool, the tab, whether it worked and how long it took. Never what was typed or read.",
          this.row(
            "audit-on",
            "Write the audit log",
            "Off by default.",
            this.toggle("audit-on", (on) => this.edit((d) => (d.audit.enabled = on))),
          ),
          this.row(
            "audit-file",
            "Audit file",
            "Where it is written. Empty keeps audit.jsonl in the browser-hand settings folder.",
            this.el("div", { class: "field wide" }, auditFile),
          ),
        ),
        this.section(
          "Debugger",
          null,
          this.row(
            "idle",
            "Detach after idle",
            'How soon the "started debugging" bar goes away after the last action.',
            this.number("idle", "s", (v) => this.edit((d) => (d.debugger.detach_after_idle_s = v))),
          ),
        ),
      ),
      this.el("footer", { class: "version", id: "version" }),
    );
    const bar = this.el(
      "div",
      { class: "savebar", id: "savebar", hidden: true },
      this.el(
        "div",
        { class: "inner" },
        this.el("span", { class: "count", id: "count" }),
        this.el("span", { class: "save-error", id: "save-error", role: "alert" }),
        this.el("button", { type: "button", class: "button", id: "discard" }, "Discard"),
        this.el("button", { type: "button", class: "button primary", id: "save" }, "Save"),
      ),
    );
    const toast = this.el(
      "div",
      { class: "toast", id: "toast", hidden: true, role: "status" },
      this.el("i", { class: "dot", id: "toast-dot" }),
      this.el(
        "div",
        {},
        this.el("strong", { id: "toast-title" }),
        this.el("p", { id: "toast-body" }),
      ),
    );
    this.get("retry").addEventListener("click", () => this.port.postMessage({ op: "retry" }));
    this.get("discard").addEventListener("click", () => this.discard());
    this.get("save").addEventListener("click", () => this.save());
    this.root.replaceChildren(main, bar, toast);
  }

  // State.

  private receive(msg: WorkerMsg) {
    if (msg.type === "state") {
      this.latest = msg.state;
      // A clean page follows the file; a page with edits keeps them, and a
      // save from it is refused as stale if the file moved on meanwhile.
      if (!this.base || !this.dirty()) {
        this.base = { settings: clone(msg.state.settings), revision: msg.state.revision };
        this.draft = clone(msg.state.settings);
      }
    } else if (msg.type === "saved") {
      this.saving = false;
      if (msg.ok) {
        if (this.base && this.draft) this.base = { ...this.base, settings: clone(this.draft) };
        this.saveError = null;
        this.toast("Saved", "", "success");
      } else if (msg.error?.message.includes("another profile") && this.latest) {
        // Show the file as it is now; the person makes the change again.
        this.base = { settings: clone(this.latest.settings), revision: this.latest.revision };
        this.draft = clone(this.latest.settings);
        this.listErrors.clear();
        this.saveError = null;
        this.toast(
          "Not saved: changed in another profile",
          "The page now shows the saved settings; make your change again.",
          "warning",
        );
      } else {
        this.saveError = msg.error?.message ?? "Not saved.";
        for (const k of LISTS)
          if (msg.error?.field === `sites.${k}`) this.listErrors.set(k, msg.error.message);
      }
    }
    this.render();
  }

  private dirty(): boolean {
    return !!this.base && !!this.draft && changeCount(this.base.settings, this.draft) > 0;
  }

  private get connected(): boolean {
    return this.latest?.connected === true;
  }

  private edit(fn: (d: Settings) => void) {
    if (!this.draft || !this.connected) return;
    fn(this.draft);
    this.saveError = null;
    this.render();
  }

  private addPattern(key: ListKey, p: string) {
    if (!this.draft || !this.connected) return;
    const problem = patternProblem(p, this.draft.sites[key]);
    if (problem) {
      this.listErrors.set(key, problem);
    } else {
      this.draft.sites[key].push(p);
      this.listErrors.delete(key);
      this.get<HTMLInputElement>(`${key}-input`).value = "";
    }
    this.render();
  }

  private removePattern(key: ListKey, p: string) {
    if (!this.draft || !this.connected) return;
    this.draft.sites[key] = this.draft.sites[key].filter((x) => x !== p);
    this.render();
  }

  private discard() {
    if (!this.base) return;
    this.draft = clone(this.base.settings);
    this.listErrors.clear();
    this.saveError = null;
    for (const k of LISTS) this.get<HTMLInputElement>(`${k}-input`).value = "";
    this.render();
  }

  /** Values the page refuses before asking the host, by row id. */
  private fieldErrors(): Map<string, string> {
    const out = new Map<string, string>();
    const d = this.draft;
    if (!d) return out;
    const folder = folderProblem(d.capture.gif_folder);
    if (folder) out.set("gif-folder", folder);
    const shots = optionalPathProblem(d.capture.screenshot_folder);
    if (shots) out.set("shot-folder", shots);
    const audit = optionalPathProblem(d.audit.file);
    if (audit) out.set("audit-file", audit);
    const delay = numberProblem(d.capture.gif_frame_delay_ms, 100, 5000, "ms");
    if (delay) out.set("gif-delay", delay);
    const idle = numberProblem(d.debugger.detach_after_idle_s, 5, 600, "s");
    if (idle) out.set("idle", idle);
    return out;
  }

  private save() {
    if (
      !this.base ||
      !this.draft ||
      !this.connected ||
      this.saving ||
      !this.dirty() ||
      this.fieldErrors().size
    )
      return;
    this.saving = true;
    this.port.postMessage({
      op: "save",
      settings: clone(this.draft),
      revision: this.base.revision,
    });
    this.render();
  }

  private toast(title: string, body: string, kind: "success" | "warning") {
    this.get("toast-title").textContent = title;
    this.get("toast-body").textContent = body;
    this.get("toast-body").hidden = !body;
    this.get("toast-dot").className = `dot ${kind}`;
    this.get("toast").hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.get("toast").hidden = true;
      this.toastTimer = null;
    }, TOAST_MS);
  }

  // Rendering: the state into the DOM, one function per section.

  /** Sets a control's value unless the person is typing in it. */
  private setValue(id: string, value: string) {
    const e = this.get<HTMLInputElement | HTMLSelectElement>(id);
    if (this.doc.activeElement !== e && e.value !== value) e.value = value;
  }

  private setError(id: string, message: string | undefined) {
    const e = this.get(`${id}-error`);
    e.textContent = message ?? "";
    e.hidden = !message;
    this.get(id).classList.toggle("invalid", !!message);
  }

  render() {
    const s = this.latest;
    const d = this.draft;
    const live = this.connected;
    this.renderHeader(s);
    this.get("sections").classList.toggle("readonly", !live);
    for (const c of this.root.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >(".sections input, .sections button, .sections select")) {
      c.disabled = !live;
    }
    if (d) {
      this.renderInput(d);
      this.renderSessions(d, s);
      this.renderSites(d);
      this.renderCapture(d);
      this.setValue(
        "idle",
        Number.isNaN(d.debugger.detach_after_idle_s) ? "" : String(d.debugger.detach_after_idle_s),
      );
    }
    const errors = this.fieldErrors();
    for (const id of ["gif-folder", "shot-folder", "audit-file", "gif-delay", "idle"])
      this.setError(id, errors.get(id));
    this.renderSaveBar(errors.size > 0);
  }

  private renderHeader(s: PageState | null) {
    const live = this.connected;
    this.get("pill").className = `pill ${live ? "success" : "warning"}`;
    this.get("pill-text").textContent = live ? "Connected" : "Not connected";
    this.get("version").textContent = `browser-hand ${s?.version ?? ""}`.trim();

    const banner = this.get("banner");
    const down = s && !live ? (s.down ?? "not_running") : null;
    banner.hidden = !down || down === "connecting";
    if (down === "older") {
      this.get("banner-title").textContent = "The browser-hand host is older than this extension";
      this.get("banner-body").textContent =
        "Settings are read-only until it is updated. Rebuild it (sh scripts/build.sh), run browser-hand install, then Retry.";
    } else if (down) {
      this.get("banner-title").textContent = "The browser-hand host is not running";
      const said = s?.detail ? ` Chrome said: ${s.detail}` : "";
      const last = s?.seen ? " Values are the last ones the extension saw." : "";
      this.get("banner-body").textContent =
        `Settings are read-only until it connects. Run browser-hand install, then Retry.${last}${said}`;
    }

    const warnings = this.get("warnings");
    const list = live ? (s?.warnings ?? []) : [];
    warnings.hidden = list.length === 0;
    warnings.replaceChildren(
      ...(list.length
        ? [this.el("strong", {}, "Some saved settings could not be used, so their defaults apply:")]
        : []),
      ...list.map((w) => this.el("code", {}, w)),
    );
  }

  private renderInput(d: Settings) {
    for (const p of ["human", "fast"] as const) {
      const b = this.get(`pace-${p}`);
      b.setAttribute("aria-checked", String(d.input.pace === p));
    }
    for (const [id, v] of [
      ["typing", d.input.typing_speed],
      ["mouse", d.input.mouse_speed],
    ] as const) {
      this.setValue(id, String(v));
      this.get(`${id}-value`).textContent = speedLabel(v);
      this.fill(id);
    }
  }

  /** The slider's track is accent up to the thumb (design: the "fill"). */
  private fill(id: string) {
    const e = this.get<HTMLInputElement>(id);
    const at = ((Number(e.value) - Number(e.min)) / (Number(e.max) - Number(e.min))) * 100;
    e.style.setProperty("--fill", `${Math.max(0, Math.min(100, at))}%`);
  }

  private renderSessions(d: Settings, s: PageState | null) {
    const select = this.get<HTMLSelectElement>("default-profile");
    const profiles = s?.profiles ?? [];
    const want = d.sessions.default_profile;
    // An older host sends no `id`: the dir is the value. The browser is named
    // only when ids carry one (more than one browser is installed).
    const idOf = (p: (typeof profiles)[number]) => p.id || p.dir;
    const options: [string, string][] = [
      ["", "Ask each time"],
      ...profiles.map((p): [string, string] => [
        idOf(p),
        idOf(p) !== p.dir && p.browser ? `${p.name} (${p.browser})` : p.name,
      ]),
    ];
    // A stored bare dir stands for the first browser's profile with it.
    const match = profiles.find((p) => idOf(p) === want) ?? profiles.find((p) => p.dir === want);
    if (want && !match) options.push([want, `${want} (not found)`]);
    const key = JSON.stringify(options);
    if (select.dataset.options !== key) {
      select.replaceChildren(
        ...options.map(([v, label]) => this.el("option", { value: v }, label)),
      );
      select.dataset.options = key;
    }
    this.setValue("default-profile", match ? idOf(match) : want);
    this.get("new-window").setAttribute("aria-checked", String(d.sessions.new_window));
    this.get("close-tabs").setAttribute("aria-checked", String(d.sessions.close_tabs_on_end));
  }

  private renderSites(d: Settings) {
    for (const key of LISTS) {
      const ul = this.get(`${key}-list`);
      ul.replaceChildren(
        ...(d.sites[key].length
          ? d.sites[key].map((p) => {
              const remove = this.el(
                "button",
                {
                  type: "button",
                  class: "remove",
                  "aria-label": `Remove ${p}`,
                  disabled: !this.connected,
                },
                "×",
              );
              remove.addEventListener("click", () => this.removePattern(key, p));
              return this.el("li", {}, this.el("code", {}, p), remove);
            })
          : [this.el("li", { class: "empty" }, "No patterns yet")]),
      );
      const error = this.listErrors.get(key);
      const e = this.get(`${key}-error`);
      e.textContent = error ?? "";
      e.hidden = !error;
      this.get(`${key}-input`).classList.toggle("invalid", !!error);
    }
  }

  private renderCapture(d: Settings) {
    this.setValue("shot-size", d.capture.screenshot_size);
    this.setValue("shot-quality", String(d.capture.screenshot_quality));
    this.get("shot-quality-value").textContent = String(d.capture.screenshot_quality);
    this.fill("shot-quality");
    this.setValue("gif-folder", d.capture.gif_folder);
    this.get("save-shots").setAttribute("aria-checked", String(d.capture.save_screenshots));
    this.setValue("shot-folder", d.capture.screenshot_folder);
    this.get("audit-on").setAttribute("aria-checked", String(d.audit.enabled));
    this.setValue("audit-file", d.audit.file);
    this.setValue(
      "gif-delay",
      Number.isNaN(d.capture.gif_frame_delay_ms) ? "" : String(d.capture.gif_frame_delay_ms),
    );
  }

  private renderSaveBar(invalid: boolean) {
    const n = this.base && this.draft ? changeCount(this.base.settings, this.draft) : 0;
    const bar = this.get("savebar");
    bar.hidden = n === 0 || !this.connected;
    this.root.classList.toggle("editing", !bar.hidden);
    this.get("count").textContent = `${n} unsaved change${n === 1 ? "" : "s"}`;
    this.get("save-error").textContent =
      this.saveError ?? (invalid ? "Fix the marked values to save." : "");
    (this.get("save") as HTMLButtonElement).disabled = this.saving || invalid;
    (this.get("discard") as HTMLButtonElement).disabled = this.saving;
    this.get("save").textContent = this.saving ? "Saving" : "Save";
  }
}
