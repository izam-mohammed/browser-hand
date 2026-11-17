// Recording the person's steps (plans/05-record-steps.md). The popup's Start
// button, or Alt+Shift+R, starts a recording of its window, and of windows
// its tabs open (plans/08-recorder-popup.md); content
// scripts send steps, which land in `chrome.storage.local` under `rec:<id>`
// with a parallel `meta` array, so the flow stays a DevTools Recorder
// `UserFlow`. Which recording is on lives in `storage.session`, so it
// survives the service worker stopping. Steps that arrive while Claude's
// `Input` acts on a tab are marked `actor: "claude"`. While one records, the
// toolbar popup is off, so a click reaches `onClicked` and stops it.
import { MASKED, type Step, type StepMsg } from "./page/record";
import { ToolError } from "./wire";

export const MAX_RECORDINGS = 20;
export const MAX_STEPS = 5_000;
/** All `rec:*` keys together; `settings:last` (plans/06-settings.md) shares the area. */
export const BUDGET_BYTES = 50 * 1024 * 1024;
export const BUDGET_EVERY_STEPS = 500;
export const IDLE_MS = 30 * 60_000;
export const FLUSH_MS = 500;
/** Events still in flight after Claude's action ends count as Claude's. */
export const BUSY_TAIL_MS = 300;
/** A page load this soon after a step is that step's doing. */
export const NAV_JOIN_MS = 10_000;

export const ACTIVE_KEY = "rec:active";
export const INDEX_KEY = "recordings";
const recKey = (id: string) => `rec:${id}`;

export const ICONS = {
  idle: { 16: "icons/idle-16.png", 32: "icons/idle-32.png" },
  rec: { 16: "icons/rec-16.png", 32: "icons/rec-32.png" },
};
/** The popup page; `""` switches it off, so a click reaches `onClicked`. */
export const POPUP = "popup.html";
export const IDLE_TITLE =
  "browser-hand: click to record your steps or see past ones (Alt+Shift+R records at once)";
const REC_TITLE = "browser-hand is recording this window: click to stop (Alt+Shift+R)";

export interface Meta {
  ts: number;
  tabId: number;
  actor: "person" | "claude";
  masked?: true;
  /** Chrome lets no extension into this page, so nothing on it was recorded. */
  unrecorded?: true;
  /** A site the settings block (plans/06-settings.md): this step stands for
   * everything done there, none of it recorded, not even the URL. */
  blocked?: true;
}

/** The step that stands in for time on a blocked site. */
export const BLOCKED_STEP: Step = { type: "navigate", url: "about:blank" };

export interface Recording {
  id: string;
  title: string;
  startedAt: number;
  stoppedAt: number | null;
  windowId: number;
  flow: { title: string; steps: Step[] };
  meta: Meta[];
  stopReason?: string;
}

export interface Summary {
  id: string;
  title: string;
  startedAt: number;
  stoppedAt: number | null;
  steps: number;
  stopReason?: string;
}

interface Active {
  id: string;
  homeWindowId: number;
  windowIds: number[];
  lastStepAt: number;
}

export interface TabLike {
  id?: number;
  windowId: number;
  url?: string;
  title?: string;
  width?: number;
  height?: number;
  openerTabId?: number;
}

type Items = { [key: string]: unknown };

export interface RecorderDeps {
  action: {
    setBadgeText(d: { text: string; tabId?: number }): Promise<void>;
    setBadgeBackgroundColor(d: { color: string; tabId?: number }): Promise<void>;
    setTitle(d: { title: string; tabId?: number }): Promise<void>;
    setIcon(d: { path: { [size: number]: string }; tabId?: number }): Promise<void>;
    setPopup(d: { popup: string }): Promise<void>;
  };
  tabs: {
    query(q: { windowId: number }): Promise<{ id?: number }[]>;
    get(tabId: number): Promise<TabLike>;
    sendMessage(tabId: number, msg: unknown): Promise<unknown>;
  };
  /** Whether the settings block this URL; steps there are dropped. */
  blocked?(url: string): boolean;
  local: {
    get(keys: string | string[]): Promise<Items>;
    set(items: Items): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
    getBytesInUse(keys: string[]): Promise<number>;
  };
  session: {
    get(keys: string): Promise<Items>;
    set(items: Items): Promise<void>;
    remove(keys: string): Promise<void>;
  };
  now(): number;
}

/** Pages Chrome keeps every extension out of. */
export function isRestricted(url: string): boolean {
  return (
    /^(chrome|chrome-extension|chrome-untrusted|devtools|edge|view-source):/i.test(url) ||
    /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url)
  );
}

function titleFor(tab: TabLike): string {
  const t = (tab.title ?? "").replace(/\s+/g, " ").trim();
  if (t) return t.slice(0, 120);
  try {
    return new URL(tab.url ?? "").hostname || "Recording";
  } catch {
    return "Recording";
  }
}

const summary = (r: Recording): Summary => ({
  id: r.id,
  title: r.title,
  startedAt: r.startedAt,
  stoppedAt: r.stoppedAt,
  steps: r.flow.steps.length,
  ...(r.stopReason ? { stopReason: r.stopReason } : {}),
});

const sameTarget = (a: Step, b: Step) =>
  JSON.stringify(a.selectors?.[0]) === JSON.stringify(b.selectors?.[0]);

export class Recorder {
  /** `undefined` until read back from storage.session. */
  private active: Active | null | undefined;
  private rec: Recording | null = null;
  private index: Summary[] | null = null;
  private busyTabs = new Map<number, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private d: RecorderDeps) {}

  /** Runs `fn` after every earlier event, so steps and stops never interleave. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => {});
    return p;
  }

  private async load(): Promise<Active | null> {
    if (this.active === undefined) {
      const saved = (await this.d.session.get(ACTIVE_KEY))[ACTIVE_KEY] as Active | undefined;
      this.active = saved ?? null;
      if (saved) {
        this.rec = await this.read(saved.id);
        if (!this.rec) {
          this.active = null;
          await this.d.session.remove(ACTIVE_KEY);
        } else {
          this.armIdle();
        }
      }
    }
    return this.active;
  }

  private async read(id: string): Promise<Recording | null> {
    return ((await this.d.local.get(recKey(id)))[recKey(id)] as Recording | undefined) ?? null;
  }

  private async loadIndex(): Promise<Summary[]> {
    if (!this.index)
      this.index = ((await this.d.local.get(INDEX_KEY))[INDEX_KEY] as Summary[] | undefined) ?? [];
    return this.index;
  }

  private actor(tabId: number): Meta["actor"] {
    return (this.busyTabs.get(tabId) ?? 0) > 0 ? "claude" : "person";
  }

  private isBlocked(url: string | undefined): boolean {
    return !!url && (this.d.blocked?.(url) ?? false);
  }

  /** Notes, once per stay, that the tab is on a blocked site. */
  private gap(tabId: number, actor: Meta["actor"]) {
    if (!this.rec) return;
    const { meta } = this.rec;
    for (let i = meta.length - 1; i >= 0; i--) {
      if (meta[i]!.tabId !== tabId) continue;
      if (meta[i]!.blocked) return;
      break;
    }
    this.rec.flow.steps.push({ ...BLOCKED_STEP });
    meta.push({ ts: this.d.now(), tabId, actor, blocked: true });
  }

  // Badge and content scripts.

  private async badgeTab(tabId: number, mode: "rec" | "idle" | "full", reason = "") {
    const a = this.d.action;
    const text = { rec: "REC", idle: "", full: "FULL" }[mode];
    const title = {
      rec: REC_TITLE,
      idle: IDLE_TITLE,
      full: `browser-hand stopped recording: ${reason}. The steps up to then are kept. Click to open browser-hand.`,
    }[mode];
    await Promise.all([
      a.setBadgeText({ tabId, text }),
      a.setBadgeBackgroundColor({ tabId, color: mode === "full" ? "#b06000" : "#d93025" }),
      a.setTitle({ tabId, title }),
      a.setIcon({ tabId, path: mode === "rec" ? ICONS.rec : ICONS.idle }),
    ]).catch(() => {});
  }

  /** One recording at a time, so one global value says it all (plans/08-recorder-popup.md, Decision 1). */
  private async popup(on: boolean) {
    await this.d.action.setPopup({ popup: on ? POPUP : "" }).catch(() => {});
  }

  private async tabsOf(windowId: number): Promise<number[]> {
    try {
      return (await this.d.tabs.query({ windowId }))
        .map((t) => t.id)
        .filter((id): id is number => id !== undefined);
    } catch {
      return []; // the window is gone
    }
  }

  private async eachTab(windowIds: number[], fn: (tabId: number) => Promise<unknown>) {
    for (const w of windowIds)
      await Promise.all((await this.tabsOf(w)).map((t) => fn(t).catch(() => {})));
  }

  /** Every frame of every tab in the windows starts or stops listening. */
  private async tell(windowIds: number[], op: "record_start" | "record_stop") {
    await this.eachTab(windowIds, (t) => this.d.tabs.sendMessage(t, { __bh: true, op }));
  }

  // Storage.

  private async write(): Promise<boolean> {
    const rec = this.rec;
    if (!rec) return true;
    const index = await this.loadIndex();
    const i = index.findIndex((s) => s.id === rec.id);
    if (i >= 0) index[i] = summary(rec);
    else index.unshift(summary(rec));
    try {
      await this.d.local.set({ [recKey(rec.id)]: rec, [INDEX_KEY]: index });
      return true;
    } catch (e) {
      await this.full(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** A write failed: stop, keep what was written last, and say so on the badge. */
  private async full(reason: string) {
    const windows = this.active?.windowIds ?? [];
    const id = this.active?.id;
    this.clearTimers();
    this.active = null;
    this.rec = null;
    this.index = null; // re-read: the failed write never landed
    await this.d.session.remove(ACTIVE_KEY).catch(() => {});
    await this.popup(true);
    // The index is small, so it may still take the reason the popup shows.
    try {
      const index = await this.loadIndex();
      const s = index.find((x) => x.id === id);
      if (s) {
        s.stoppedAt = this.d.now();
        s.stopReason = `could not save: ${reason}`;
        await this.d.local.set({ [INDEX_KEY]: index });
      }
    } catch {
      this.index = null;
    }
    await this.eachTab(windows, (t) => this.badgeTab(t, "full", reason));
    await this.tell(windows, "record_stop");
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.run(() => this.flushNow());
    }, FLUSH_MS);
  }

  private async flushNow() {
    if (!this.active || !this.rec) return;
    await this.d.session.set({ [ACTIVE_KEY]: this.active });
    await this.write();
  }

  /** Over 50 MB or past 20 recordings, the oldest stopped one goes; never the one recording. */
  private async budget() {
    try {
      const index = await this.loadIndex();
      const used = () => this.d.local.getBytesInUse(index.map((s) => recKey(s.id)));
      let bytes = await used();
      while (bytes > BUDGET_BYTES || index.length > MAX_RECORDINGS) {
        const at = index.findLastIndex((s) => s.id !== this.active?.id);
        if (at < 0) break;
        const [gone] = index.splice(at, 1);
        await this.d.local.remove(recKey(gone!.id));
        await this.d.local.set({ [INDEX_KEY]: index });
        bytes = await used();
      }
    } catch (e) {
      console.warn("browser-hand: recording budget check failed", e);
    }
  }

  private clearTimers() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.flushTimer = this.idleTimer = null;
  }

  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.run(() => this.idleCheck()), IDLE_MS + 1_000);
  }

  private async idleCheck(): Promise<boolean> {
    if (!this.active || this.d.now() - this.active.lastStepAt < IDLE_MS) return false;
    await this.stopNow("no step for 30 minutes");
    return true;
  }

  // Start and stop.

  private async startNow(tab: TabLike) {
    const now = this.d.now();
    const id = `rec_${now.toString(36)}`;
    const tabId = tab.id ?? -1;
    const steps: Step[] = [];
    const meta: Meta[] = [];
    if (tab.width && tab.height) {
      steps.push({
        type: "setViewport",
        width: tab.width,
        height: tab.height,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: tab.width >= tab.height,
      });
      meta.push({ ts: now, tabId, actor: "person" });
    }
    const blocked = this.isBlocked(tab.url);
    if (blocked) {
      steps.push({ ...BLOCKED_STEP });
      meta.push({ ts: now, tabId, actor: "person", blocked: true });
    } else if (tab.url) {
      steps.push({
        type: "navigate",
        url: tab.url,
        assertedEvents: [{ type: "navigation", url: tab.url, title: tab.title ?? "" }],
      });
      meta.push({
        ts: now,
        tabId,
        actor: "person",
        ...(isRestricted(tab.url) ? { unrecorded: true as const } : {}),
      });
    }
    const title = blocked ? "Recording" : titleFor(tab);
    this.rec = {
      id,
      title,
      startedAt: now,
      stoppedAt: null,
      windowId: tab.windowId,
      flow: { title, steps },
      meta,
    };
    this.active = { id, homeWindowId: tab.windowId, windowIds: [tab.windowId], lastStepAt: now };
    await this.d.session.set({ [ACTIVE_KEY]: this.active });
    await this.popup(false);
    if (!(await this.write())) return;
    await this.eachTab([tab.windowId], (t) => this.badgeTab(t, "rec"));
    await this.tell([tab.windowId], "record_start");
    this.armIdle();
    await this.budget();
  }

  private async stopNow(reason: string) {
    const rec = this.rec;
    const windows = this.active?.windowIds ?? [];
    if (!rec) return;
    rec.stoppedAt = this.d.now();
    rec.stopReason = reason;
    this.clearTimers();
    if (!(await this.write())) return;
    this.active = null;
    this.rec = null;
    await this.d.session.remove(ACTIVE_KEY);
    await this.popup(true);
    await this.eachTab(windows, (t) => this.badgeTab(t, "idle"));
    await this.tell(windows, "record_stop");
    await this.budget();
  }

  // Events from Chrome and the content scripts.

  /** Alt+Shift+R, or the toolbar button while recording (the popup is off
   * then): stops the recording, or starts one for the tab's window. */
  toggle(tab: TabLike): Promise<void> {
    return this.run(async () => {
      if (await this.load()) await this.stopNow("stopped by the person");
      else await this.startNow(tab);
    });
  }

  /** The popup's Start: records the tab's window, and never stops one.
   * False when a recording is already on. */
  start(tab: TabLike): Promise<boolean> {
    return this.run(async () => {
      if (await this.load()) return false;
      await this.startNow(tab);
      return true;
    });
  }

  /** The popup opened while recording (its switch was lost): that click meant stop. */
  stop(): Promise<void> {
    return this.run(async () => {
      if (await this.load()) await this.stopNow("stopped by the person");
    });
  }

  /** The service worker woke: the popup is off exactly while recording. */
  syncPopup(): Promise<void> {
    return this.run(async () => this.popup(!(await this.load())));
  }

  isRecording(windowId: number): Promise<boolean> {
    return this.run(async () => {
      const a = await this.load();
      return !!a && a.windowIds.includes(windowId) && !(await this.idleCheck());
    });
  }

  /** A step from a content script on `url`. False tells it to stop listening. */
  step(tabId: number, windowId: number, msg: StepMsg, url?: string): Promise<boolean> {
    return this.run(async () => {
      const a = await this.load();
      if (!a || !this.rec || !a.windowIds.includes(windowId)) return false;
      if (await this.idleCheck()) return false;
      if (this.isBlocked(url)) {
        // Dropped: the settings block this site. The gap is noted once.
        this.gap(tabId, this.actor(tabId));
        a.lastStepAt = this.d.now();
        this.scheduleFlush();
        return true;
      }
      const { steps } = this.rec.flow;
      const { meta } = this.rec;
      const step = { ...msg.step };
      if (msg.masked) step.value = MASKED;
      // A double click arrives after its two clicks; the Recorder keeps one step.
      if (step.type === "doubleClick") {
        for (let n = 0; n < 2; n++) {
          const i = steps.length - 1;
          if (
            i >= 0 &&
            steps[i]!.type === "click" &&
            meta[i]!.tabId === tabId &&
            sameTarget(steps[i]!, step)
          ) {
            steps.pop();
            meta.pop();
          }
        }
      }
      steps.push(step);
      meta.push({
        ts: msg.ts,
        tabId,
        actor: this.actor(tabId),
        ...(msg.masked ? { masked: true as const } : {}),
      });
      a.lastStepAt = this.d.now();
      if (steps.length >= MAX_STEPS) {
        await this.stopNow(`reached ${MAX_STEPS} steps`);
        return false;
      }
      this.armIdle();
      if (steps.length % BUDGET_EVERY_STEPS === 0) {
        await this.flushNow();
        await this.budget();
      } else {
        this.scheduleFlush();
      }
      return true;
    });
  }

  /** A top-frame page load in some tab (webNavigation.onCommitted). */
  navigated(d: {
    tabId: number;
    frameId: number;
    url: string;
    transitionType?: string;
    transitionQualifiers?: string[];
  }): Promise<void> {
    return this.run(async () => {
      const a = await this.load();
      if (!a || !this.rec || d.frameId !== 0 || d.url === "about:blank") return;
      let tab: TabLike;
      try {
        tab = await this.d.tabs.get(d.tabId);
      } catch {
        return;
      }
      if (!a.windowIds.includes(tab.windowId)) return;
      if (this.isBlocked(d.url)) {
        this.gap(d.tabId, this.actor(d.tabId));
        a.lastStepAt = this.d.now();
        this.scheduleFlush();
        return;
      }
      const { steps } = this.rec.flow;
      const { meta } = this.rec;
      const q = d.transitionQualifiers ?? [];
      const byPage =
        ["link", "form_submit"].includes(d.transitionType ?? "") ||
        q.includes("client_redirect") ||
        q.includes("server_redirect");
      let last = -1;
      for (let i = meta.length - 1; i >= 0; i--) {
        if (meta[i]!.tabId === d.tabId) {
          last = i;
          break;
        }
      }
      const prev = last >= 0 ? steps[last]! : undefined;
      const recent = last >= 0 && this.d.now() - meta[last]!.ts < NAV_JOIN_MS;
      const nav = { type: "navigation", url: d.url, title: "" };
      if (
        prev &&
        recent &&
        byPage &&
        ["click", "doubleClick", "keyUp", "change"].includes(prev.type) &&
        !prev.assertedEvents
      ) {
        prev.assertedEvents = [nav];
      } else if (
        prev &&
        recent &&
        q.includes("server_redirect") &&
        (prev.type === "navigate" || prev.assertedEvents)
      ) {
        // A redirect: the step that started the load now names where it ended.
        if (prev.type === "navigate") prev.url = d.url;
        prev.assertedEvents = [nav];
      } else {
        steps.push({ type: "navigate", url: d.url, assertedEvents: [nav] });
        meta.push({
          ts: this.d.now(),
          tabId: d.tabId,
          actor: this.actor(d.tabId),
          ...(isRestricted(d.url) ? { unrecorded: true as const } : {}),
        });
        a.lastStepAt = this.d.now();
      }
      this.scheduleFlush();
    });
  }

  /** A tab opened from a recorded tab brings its window into the recording. */
  tabCreated(tab: TabLike): Promise<void> {
    return this.run(async () => {
      const a = await this.load();
      if (!a || tab.id === undefined) return;
      if (!a.windowIds.includes(tab.windowId) && tab.openerTabId !== undefined) {
        let opener: TabLike;
        try {
          opener = await this.d.tabs.get(tab.openerTabId);
        } catch {
          return;
        }
        if (!a.windowIds.includes(opener.windowId)) return;
        a.windowIds.push(tab.windowId);
        await this.d.session.set({ [ACTIVE_KEY]: a });
        await this.eachTab([tab.windowId], (t) => this.badgeTab(t, "rec"));
        await this.tell([tab.windowId], "record_start");
        return;
      }
      if (a.windowIds.includes(tab.windowId)) await this.badgeTab(tab.id, "rec");
    });
  }

  /** webNavigation.onCreatedNavigationTarget: window.open and target=_blank, opener known. */
  async openedFrom(sourceTabId: number, tabId: number): Promise<void> {
    let tab: TabLike;
    try {
      tab = await this.d.tabs.get(tabId);
    } catch {
      return;
    }
    await this.tabCreated({ ...tab, id: tabId, openerTabId: sourceTabId });
  }

  /** A tab loading in a recorded window: Chrome may have reset its badge. */
  tabUpdated(tabId: number, windowId: number): Promise<void> {
    return this.run(async () => {
      const a = await this.load();
      if (a && a.windowIds.includes(windowId)) await this.badgeTab(tabId, "rec");
    });
  }

  windowRemoved(windowId: number): Promise<void> {
    return this.run(async () => {
      const a = await this.load();
      if (!a || !a.windowIds.includes(windowId)) return;
      if (windowId === a.homeWindowId) {
        await this.stopNow("its window closed");
        return;
      }
      a.windowIds = a.windowIds.filter((w) => w !== windowId);
      await this.d.session.set({ [ACTIVE_KEY]: a });
    });
  }

  /** Runs Claude's action on a tab; steps from the tab meanwhile are Claude's. */
  async busy<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
    this.busyTabs.set(tabId, (this.busyTabs.get(tabId) ?? 0) + 1);
    try {
      return await fn();
    } finally {
      setTimeout(() => {
        const n = (this.busyTabs.get(tabId) ?? 1) - 1;
        if (n > 0) this.busyTabs.set(tabId, n);
        else this.busyTabs.delete(tabId);
      }, BUSY_TAIL_MS);
    }
  }

  // The tools.

  list(): Promise<{ recordings: Summary[]; recording: string | null }> {
    return this.run(async () => {
      await this.load();
      const index = [...(await this.loadIndex())];
      if (this.rec) {
        const i = index.findIndex((s) => s.id === this.rec!.id);
        if (i >= 0) index[i] = summary(this.rec);
      }
      return { recordings: index, recording: this.active?.id ?? null };
    });
  }

  /** One recording, the newest when `id` is not given. */
  get(id?: string): Promise<Recording> {
    return this.run(async () => {
      await this.load();
      const index = await this.loadIndex();
      const want = id ?? index[0]?.id;
      if (!want)
        throw new ToolError(
          "bad_args",
          "No recordings in this profile. The person records from the browser-hand toolbar button's popup.",
        );
      if (this.rec?.id === want) return this.rec;
      const rec = await this.read(want);
      if (!rec)
        throw new ToolError("bad_args", `No recording ${want}. Call recording_list for the ids.`);
      return rec;
    });
  }

  remove(id: string): Promise<string> {
    return this.run(async () => {
      await this.load();
      if (this.active?.id === id) {
        throw new ToolError(
          "bad_args",
          `${id} is recording now; the person stops it with the toolbar button first.`,
        );
      }
      const index = await this.loadIndex();
      const at = index.findIndex((s) => s.id === id);
      if (at < 0)
        throw new ToolError("bad_args", `No recording ${id}. Call recording_list for the ids.`);
      index.splice(at, 1);
      await this.d.local.remove(recKey(id));
      await this.d.local.set({ [INDEX_KEY]: index });
      return `Deleted recording ${id}.`;
    });
  }
}

// The toolbar popup's ops (plans/08-recorder-popup.md, Decision 4): the
// popup reads and deletes through the worker, whose `Recorder` holds the
// index, so a delete stays deleted.

export type PopupMsg =
  | { __bhPopup: "list" }
  | { __bhPopup: "get"; id: string }
  | { __bhPopup: "delete"; id: string }
  | { __bhPopup: "start"; windowId: number }
  | { __bhPopup: "stop" };

export type PopupReply = { ok: true; value: unknown } | { ok: false; error: string };

export interface SenderLike {
  id?: string;
  tab?: unknown;
  url?: string;
}

/** Only the extension's own popup page: never a tab, a content script or another extension. */
export function fromPopup(sender: SenderLike, extensionId: string, popupUrl: string): boolean {
  return sender.id === extensionId && sender.tab === undefined && sender.url === popupUrl;
}

/** One popup op; `activeTab` finds the tab of the window Start records. */
export async function popupOp(
  rec: Recorder,
  msg: PopupMsg,
  activeTab: (windowId: number) => Promise<TabLike | undefined>,
): Promise<unknown> {
  switch (msg.__bhPopup) {
    case "list":
      return rec.list();
    case "get":
    case "delete":
      if (typeof msg.id !== "string") throw new ToolError("bad_args", "Needs a recording id.");
      return msg.__bhPopup === "get" ? rec.get(msg.id) : rec.remove(msg.id);
    case "stop":
      return rec.stop();
    case "start": {
      if (!Number.isInteger(msg.windowId)) throw new ToolError("bad_args", "Needs a window id.");
      const tab = await activeTab(msg.windowId);
      if (!tab) throw new ToolError("bad_args", "That window has no tab to record.");
      return rec.start(tab);
    }
    default:
      throw new ToolError("bad_args", "Unknown popup op.");
  }
}
