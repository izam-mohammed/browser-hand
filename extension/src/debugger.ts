// Attaches chrome.debugger to a tab only when a tool needs it, and detaches
// after 30 s idle (the settings' "detach after idle") so Chrome's "started
// debugging this browser" bar goes away
// (docs/external/chrome-debugger-cdp.md § Infobar while attached).
import { ToolError } from "./wire";

export const PROTOCOL_VERSION = "1.3";
export const IDLE_DETACH_MS = 30_000;

const CANNOT_DRIVE =
  "Pages under chrome://, other extensions' pages, the Chrome Web Store and PDFs cannot be driven; a tab with DevTools open or another automation extension attached cannot either, nor a page where another extension puts its own frame (password managers such as iCloud Passwords do on login forms: turn it off for this site to let Claude act). Reading tools still work.";

type DebuggerApi = Pick<typeof chrome.debugger, "attach" | "detach" | "sendCommand"> & {
  onDetach: { addListener(cb: (source: chrome.debugger.Debuggee, reason: string) => void): void };
};

export class DebuggerManager {
  private attached = new Set<number>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private api: DebuggerApi,
    private idleMs = IDLE_DETACH_MS,
  ) {
    api.onDetach.addListener((source) => {
      if (source.tabId !== undefined) this.forget(source.tabId);
    });
  }

  /** A new idle time from the settings; it counts from each tab's next use. */
  setIdleMs(ms: number) {
    this.idleMs = ms;
  }

  isAttached(tabId: number) {
    return this.attached.has(tabId);
  }

  private forget(tabId: number) {
    this.attached.delete(tabId);
    clearTimeout(this.timers.get(tabId));
    this.timers.delete(tabId);
  }

  private touch(tabId: number) {
    clearTimeout(this.timers.get(tabId));
    this.timers.set(
      tabId,
      setTimeout(() => void this.detach(tabId), this.idleMs),
    );
  }

  async attach(tabId: number) {
    if (this.attached.has(tabId)) return this.touch(tabId);
    try {
      await this.api.attach({ tabId }, PROTOCOL_VERSION);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new ToolError(
        "debugger_refused",
        `Chrome refused to attach to tab ${tabId}: ${why}. ${CANNOT_DRIVE}`,
      );
    }
    this.attached.add(tabId);
    this.touch(tabId);
  }

  async detach(tabId: number) {
    if (!this.attached.has(tabId)) return;
    this.forget(tabId);
    try {
      await this.api.detach({ tabId });
    } catch {
      // already gone
    }
  }

  /** Sends one CDP command, attaching first if needed. */
  async send<T = any>(
    tabId: number,
    method: string,
    params: { [key: string]: unknown } = {},
  ): Promise<T> {
    await this.attach(tabId);
    try {
      return (await this.api.sendCommand({ tabId }, method, params)) as T;
    } catch (e) {
      // Chrome drops the debugger, or refuses it, when another extension's
      // frame is in the page; iCloud Passwords does this on login forms.
      const why = e instanceof Error ? e.message : String(e);
      if (!/not attached|different extension/i.test(why)) throw e;
      this.forget(tabId);
      throw new ToolError(
        "debugger_refused",
        `Chrome stopped the debugger on tab ${tabId}: ${why}. ${CANNOT_DRIVE}`,
      );
    } finally {
      this.touch(tabId);
    }
  }
}
