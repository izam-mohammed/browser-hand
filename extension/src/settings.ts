// The settings in the service worker (plans/06-settings.md). The native host
// owns `config.toml` and sends it as a `settings` frame on each hello and
// on each change; this keeps the last copy (also in `storage.local` under
// `settings:last`, for when the host is down), tells the worker's parts
// when it changes, and serves the settings page over a `runtime.connect`
// port: the page's state, its saves as `settings_set`, and Retry.
import type { Frame, ProfileRef, Settings } from "./wire.gen";

export type { ProfileRef, Settings };
export type SettingsFrame = Extract<Frame, { type: "settings" }>;
export type SavedFrame = Extract<Frame, { type: "settings_saved" }>;

export const LAST_KEY = "settings:last";
/** `settings:last` stays under this (plan 05's storage budget counts it). */
export const LAST_MAX_BYTES = 64 * 1024;
export const PORT_NAME = "settings";
/** A host that answers hello without `settings` is older than this extension. */
export const OLDER_AFTER_MS = 3_000;
export const SAVE_TIMEOUT_MS = 5_000;

/** The Contract's defaults, the constants from before the settings. */
export const DEFAULTS: Settings = {
  version: 1,
  input: { pace: "human", typing_speed: 1.0, mouse_speed: 1.0 },
  sessions: { default_profile: "", new_window: false, close_tabs_on_end: false },
  sites: { blocked: [], read_only: [] },
  capture: {
    screenshot_size: "1280x800",
    screenshot_quality: 80,
    gif_folder: "~/Downloads/browser-hand",
    gif_frame_delay_ms: 700,
  },
  debugger: { detach_after_idle_s: 30 },
};

/** Why the page cannot save: the host is not there, or never sent settings. */
export type Down = "not_running" | "older" | "connecting";

/** What the settings page shows. */
export interface PageState {
  connected: boolean;
  down?: Down;
  /** Chrome's words when the port closed. */
  detail?: string;
  settings: Settings;
  revision: string;
  path: string;
  profiles: ProfileRef[];
  warnings: string[];
  version: string;
  /** False until the extension has ever seen settings from a host. */
  seen: boolean;
}

/** Page to worker. */
export type PageMsg = { op: "save"; settings: Settings; revision: string } | { op: "retry" };
/** Worker to page. */
export type WorkerMsg =
  | { type: "state"; state: PageState }
  | {
      type: "saved";
      ok: boolean;
      path?: string;
      error?: { field: string | null; message: string };
    };

/** The parts of a `runtime.Port` the hub uses. */
export interface PortLike {
  name: string;
  sender?: { id?: string; url?: string };
  postMessage(msg: unknown): void;
  // biome-ignore lint/suspicious/noExplicitAny: the port carries whatever the native host sends.
  onMessage: { addListener(cb: (msg: any) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

export interface HubDeps {
  local: {
    get(key: string): Promise<{ [k: string]: unknown }>;
    set(items: { [k: string]: unknown }): Promise<void>;
  };
  /** Sends a frame on the native port; false when the port is down. */
  post(frame: Frame): boolean;
  /** Retry: connect the native port again now. */
  reconnect(): void;
  version: string;
  extensionId: string;
  /** `chrome.runtime.getURL("options.html")`. */
  optionsUrl: string;
}

interface Last {
  settings: Settings;
  revision: string;
  path: string;
  profiles: ProfileRef[];
  warnings: string[];
}

export class SettingsHub {
  private last: Last | null = null;
  private portUp = false;
  private heard = false;
  private down: Down = "connecting";
  private detail: string | undefined;
  private olderTimer: ReturnType<typeof setTimeout> | null = null;
  private pages = new Set<PortLike>();
  private listeners: ((s: Settings) => void)[] = [];
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (f: SavedFrame | null) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(private d: HubDeps) {}

  /** The settings to act on now: the host's, else the last seen, else the defaults. */
  get settings(): Settings {
    return this.last?.settings ?? DEFAULTS;
  }

  get connected(): boolean {
    return this.portUp && this.heard;
  }

  /** Called now and on every change of the settings. */
  onChange(fn: (s: Settings) => void) {
    this.listeners.push(fn);
    fn(this.settings);
  }

  private changed() {
    for (const fn of this.listeners) fn(this.settings);
  }

  /** Reads `settings:last`, so a worker that starts with no host acts on
   * the last settings it saw. */
  async load() {
    try {
      const saved = (await this.d.local.get(LAST_KEY))[LAST_KEY] as Last | undefined;
      if (saved?.settings && !this.last) {
        this.last = saved;
        this.changed();
        this.broadcast();
      }
    } catch (e) {
      console.warn("browser-hand: could not read the last settings", e);
    }
  }

  state(): PageState {
    const last = this.last;
    return {
      connected: this.connected,
      ...(this.connected
        ? {}
        : { down: this.down, ...(this.detail ? { detail: this.detail } : {}) }),
      settings: this.settings,
      revision: last?.revision ?? "0",
      path: last?.path ?? "",
      profiles: last?.profiles ?? [],
      warnings: last?.warnings ?? [],
      version: this.d.version,
      seen: last !== null,
    };
  }

  private broadcast() {
    const msg: WorkerMsg = { type: "state", state: this.state() };
    for (const p of this.pages) p.postMessage(msg);
  }

  // The native port.

  /** `connectNative` returned a port and hello went out. */
  portOpened() {
    this.portUp = true;
    this.heard = false;
    this.down = "connecting";
    this.detail = undefined;
    if (this.olderTimer) clearTimeout(this.olderTimer);
    this.olderTimer = setTimeout(() => {
      if (this.portUp && !this.heard) {
        this.down = "older";
        this.broadcast();
      }
    }, OLDER_AFTER_MS);
    this.broadcast();
  }

  /** The port closed (`onDisconnect`), with Chrome's reason. */
  portClosed(detail?: string) {
    this.portUp = false;
    this.heard = false;
    this.down = "not_running";
    this.detail = detail;
    if (this.olderTimer) clearTimeout(this.olderTimer);
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve(null);
      this.pending.delete(id);
    }
    this.broadcast();
  }

  /** A `settings` or `settings_saved` frame from the host. */
  onFrame(frame: Frame) {
    if (frame.type === "settings") {
      this.heard = true;
      const { settings, revision, path, profiles, warnings } = frame;
      this.last = { settings, revision, path, profiles, warnings };
      const json = JSON.stringify(this.last);
      if (json.length <= LAST_MAX_BYTES) {
        this.d.local
          .set({ [LAST_KEY]: this.last })
          .catch((e) => console.warn("browser-hand: could not keep the settings", e));
      }
      this.changed();
      this.broadcast();
    } else if (frame.type === "settings_saved") {
      const p = this.pending.get(frame.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(frame.id);
      p.resolve(frame);
    }
  }

  // The settings page.

  /** Serves a port from this extension's own `options.html` and nothing
   * else: a content script or another page cannot change the settings. */
  accept(port: PortLike): boolean {
    if (port.name !== PORT_NAME) return false;
    if (port.sender?.id !== this.d.extensionId || !port.sender?.url?.startsWith(this.d.optionsUrl))
      return false;
    this.pages.add(port);
    port.onDisconnect.addListener(() => this.pages.delete(port));
    port.onMessage.addListener((msg: PageMsg) => void this.fromPage(port, msg));
    port.postMessage({ type: "state", state: this.state() } satisfies WorkerMsg);
    return true;
  }

  private async fromPage(port: PortLike, msg: PageMsg) {
    if (msg?.op === "retry") {
      this.d.reconnect();
    } else if (msg?.op === "save" && msg.settings && typeof msg.revision === "string") {
      port.postMessage(await this.save(msg.settings, msg.revision));
    }
  }

  /** Asks the host to save; answers as the page shows it. */
  async save(settings: Settings, revision: string): Promise<WorkerMsg> {
    const refused = (message: string): WorkerMsg => ({
      type: "saved",
      ok: false,
      error: { field: null, message },
    });
    if (!this.connected)
      return refused("The browser-hand host is not connected; nothing was saved.");
    const id = this.nextId++;
    const answer = new Promise<SavedFrame | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, SAVE_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
    });
    if (!this.d.post({ type: "settings_set", id, settings, revision })) {
      clearTimeout(this.pending.get(id)?.timer);
      this.pending.delete(id);
      return refused("The browser-hand host is not connected; nothing was saved.");
    }
    const f = await answer;
    if (!f)
      return refused(
        "The browser-hand host did not answer. It may be older than this extension: rebuild it and run browser-hand install.",
      );
    return {
      type: "saved",
      ok: f.ok,
      ...(f.path ? { path: f.path } : {}),
      ...(f.error ? { error: { field: f.error.field, message: f.error.message } } : {}),
    };
  }
}
