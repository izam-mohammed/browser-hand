// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeCount,
  type PagePort,
  SettingsPage,
  speedLabel,
  TOAST_MS,
} from "../src/options/page";
import {
  DEFAULTS,
  type HubDeps,
  LAST_KEY,
  OLDER_AFTER_MS,
  type PageMsg,
  type PageState,
  PORT_NAME,
  type PortLike,
  SAVE_TIMEOUT_MS,
  type Settings,
  SettingsHub,
  type WorkerMsg,
} from "../src/settings";
import { NOT_A_PATTERN } from "../src/sites";
import type { Frame } from "../src/wire";

const ID = "ednpkicgdjiiihmophoifehfeeoabjdc";
const OPTIONS = `chrome-extension://${ID}/options.html`;
const settingsWith = (edit: (s: Settings) => void): Settings => {
  const s = structuredClone(DEFAULTS);
  edit(s);
  return s;
};
const frame = (settings: Settings, revision = "100"): Frame => ({
  type: "settings",
  settings,
  revision,
  path: "/Users/someone/.config/browser-hand/config.toml",
  profiles: [
    { dir: "Default", name: "Personal", id: "Default", browser: "Google Chrome" },
    { dir: "Profile 3", name: "Work", id: "Profile 3", browser: "Google Chrome" },
  ],
  warnings: [],
});

/** A hub with storage in memory and the frames it posts kept. */
function hub(portUp = true) {
  const local = new Map<string, unknown>();
  const posted: Frame[] = [];
  const reconnect = vi.fn();
  const deps: HubDeps = {
    local: {
      get: async (k) => (local.has(k) ? { [k]: structuredClone(local.get(k)) } : {}),
      set: async (items) =>
        void Object.entries(items).forEach(([k, v]) => local.set(k, structuredClone(v))),
    },
    post: (f) => {
      if (!portUp) return false;
      posted.push(f);
      return true;
    },
    reconnect,
    version: "0.1.0",
    extensionId: ID,
    optionsUrl: OPTIONS,
  };
  return { h: new SettingsHub(deps), local, posted, reconnect };
}

/** A page port as the hub sees it; `sent` holds what the hub posted to it. */
function pagePort(sender: { id?: string; url?: string }, name = PORT_NAME) {
  const sent: WorkerMsg[] = [];
  let onMessage: (m: PageMsg) => void = () => {};
  const port: PortLike = {
    name,
    sender,
    postMessage: (m) => void sent.push(m as WorkerMsg),
    onMessage: { addListener: (cb) => void (onMessage = cb) },
    onDisconnect: { addListener: () => {} },
  };
  return { port, sent, send: (m: PageMsg) => onMessage(m) };
}

describe("the settings in the worker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refuses other senders: a content script, another page, another extension", () => {
    const { h } = hub();
    expect(h.accept(pagePort({ id: ID, url: "https://evil.test/" }).port)).toBe(false);
    expect(h.accept(pagePort({ id: ID, url: `chrome-extension://${ID}/claim.html` }).port)).toBe(
      false,
    );
    expect(h.accept(pagePort({ id: "otherextensionid", url: OPTIONS }).port)).toBe(false);
    expect(h.accept(pagePort({ id: ID, url: OPTIONS }, "rec").port)).toBe(false);
    expect(h.accept(pagePort({ id: ID, url: OPTIONS }).port)).toBe(true);
  });

  it("fills the keys an older host does not send from the defaults", () => {
    const { h } = hub();
    const old = structuredClone(DEFAULTS) as unknown as Record<string, Record<string, unknown>>;
    delete old.audit;
    delete old.sites?.allowed;
    delete old.capture?.save_screenshots;
    delete old.capture?.screenshot_folder;
    h.portOpened();
    h.onFrame(frame(old as unknown as Settings));
    expect(h.settings.audit).toEqual({ enabled: false, file: "" });
    expect(h.settings.sites.allowed).toEqual([]);
    expect(h.settings.capture.save_screenshots).toBe(false);
    expect(h.state().settings).toEqual(DEFAULTS);
  });

  it("is the defaults until the host speaks, then the host's, kept in settings:last", async () => {
    const { h, local } = hub();
    const seen: Settings[] = [];
    h.onChange((s) => seen.push(s));
    expect(h.settings).toEqual(DEFAULTS);
    const s = settingsWith((x) => (x.sites.blocked = ["*.bank.com/*"]));
    h.portOpened();
    h.onFrame(frame(s));
    expect(h.settings).toEqual(s);
    expect(seen.at(-1)).toEqual(s);
    await Promise.resolve();
    expect((local.get(LAST_KEY) as { settings: Settings }).settings).toEqual(s);

    // A new worker with no host reads the last ones back.
    const next = hub();
    next.local.set(LAST_KEY, local.get(LAST_KEY));
    await next.h.load();
    expect(next.h.settings).toEqual(s);
    expect(next.h.connected).toBe(false);
    expect(next.h.state().seen).toBe(true);
  });

  it("is connected only between a settings frame and the port closing", () => {
    const { h } = hub();
    expect(h.state()).toMatchObject({ connected: false, down: "connecting" });
    h.portOpened();
    expect(h.connected).toBe(false);
    h.onFrame(frame(DEFAULTS));
    expect(h.state()).toMatchObject({ connected: true });
    expect(h.state().down).toBeUndefined();
    h.portClosed("Specified native messaging host not found.");
    expect(h.state()).toMatchObject({
      connected: false,
      down: "not_running",
      detail: "Specified native messaging host not found.",
    });
  });

  it("an open port with no settings after a while is an older host", () => {
    const { h } = hub();
    h.portOpened();
    vi.advanceTimersByTime(OLDER_AFTER_MS);
    expect(h.state()).toMatchObject({ connected: false, down: "older" });
  });

  it("a save goes out as settings_set and comes back as the host answered", async () => {
    const { h, posted } = hub();
    h.portOpened();
    h.onFrame(frame(DEFAULTS, "7"));
    const s = settingsWith((x) => (x.input.pace = "fast"));
    const answer = h.save(s, "7");
    expect(posted).toEqual([{ type: "settings_set", id: 1, settings: s, revision: "7" }]);
    h.onFrame({ type: "settings_saved", id: 1, ok: true, path: "/x/config.toml" });
    expect(await answer).toEqual({ type: "saved", ok: true, path: "/x/config.toml" });
  });

  it("a host that never answers a save times out as maybe older; a closed port refuses at once", async () => {
    const { h } = hub();
    h.portOpened();
    h.onFrame(frame(DEFAULTS));
    const answer = h.save(DEFAULTS, "100");
    vi.advanceTimersByTime(SAVE_TIMEOUT_MS);
    expect(await answer).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/did not answer/) },
    });
    h.portClosed();
    expect(await h.save(DEFAULTS, "100")).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/not connected/) },
    });
  });

  it("serves the page: state at once, saves, and Retry reconnects", async () => {
    const { h, posted, reconnect } = hub();
    h.portOpened();
    h.onFrame(frame(DEFAULTS, "3"));
    const page = pagePort({ id: ID, url: OPTIONS });
    h.accept(page.port);
    expect(page.sent[0]).toMatchObject({
      type: "state",
      state: { connected: true, revision: "3", version: "0.1.0" },
    });
    page.send({ op: "retry" });
    expect(reconnect).toHaveBeenCalledOnce();
    page.send({ op: "save", settings: DEFAULTS, revision: "3" });
    await Promise.resolve();
    expect(posted.at(-1)).toMatchObject({ type: "settings_set", revision: "3" });
    h.onFrame({
      type: "settings_saved",
      id: 1,
      ok: false,
      error: { field: "sites.blocked", message: "bad" },
    });
    await vi.waitFor(() =>
      expect(page.sent.at(-1)).toEqual({
        type: "saved",
        ok: false,
        error: { field: "sites.blocked", message: "bad" },
      }),
    );
  });
});

/** The page in jsdom, with a fake worker on the other end of its port. */
function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app")!;
  const sent: PageMsg[] = [];
  let toPage: (m: WorkerMsg) => void = () => {};
  const port: PagePort = {
    postMessage: (m) => void sent.push(structuredClone(m)),
    onMessage: { addListener: (cb) => void (toPage = cb) },
    onDisconnect: { addListener: () => {} },
  };
  const page = new SettingsPage(root, port);
  const state = (over: Partial<PageState> = {}): PageState => ({
    connected: true,
    settings: settingsWith((s) => {
      s.sites.blocked = ["*.bank.com/*", "hr.example.com/*"];
      s.sites.read_only = ["mail.google.com/*"];
      s.sessions.default_profile = "Default";
    }),
    revision: "100",
    path: "/Users/someone/.config/browser-hand/config.toml",
    profiles: [
      { dir: "Default", name: "Personal", id: "Default", browser: "Google Chrome" },
      { dir: "Profile 3", name: "Work", id: "Profile 3", browser: "Google Chrome" },
    ],
    warnings: [],
    version: "0.1.0",
    seen: true,
    ...over,
  });
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => page.get<T>(id);
  const click = (id: string) => $(id).click();
  const type = (id: string, value: string) => {
    const e = $<HTMLInputElement>(id);
    e.value = value;
    e.dispatchEvent(new Event("input"));
  };
  const addPattern = (key: string, value: string) => {
    type(`${key}-input`, value);
    click(`${key}-add`);
  };
  const patterns = (key: string) =>
    [...$(`${key}-list`).querySelectorAll("code")].map((c) => c.textContent);
  return {
    root,
    page,
    sent,
    send: (m: WorkerMsg) => toPage(m),
    state,
    $,
    click,
    type,
    addPattern,
    patterns,
  };
}

describe("the settings page", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows every section of the design with the values the host sent", () => {
    const p = mount();
    p.send({ type: "state", state: p.state() });
    expect([...p.root.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      "Input",
      "Sessions",
      "Site access",
      "Capture",
      "Audit log",
      "Debugger",
    ]);
    expect(p.$("pill").textContent).toBe("Connected");
    expect(p.root.textContent).not.toContain("config.toml");
    expect(p.$("pace-human").getAttribute("aria-checked")).toBe("true");
    expect(p.$("typing-value").textContent).toBe("1.0×");
    expect(p.$<HTMLSelectElement>("default-profile").value).toBe("Default");
    expect([...p.$<HTMLSelectElement>("default-profile").options].map((o) => o.text)).toEqual([
      "Ask each time",
      "Personal",
      "Work",
    ]);
    expect(p.$("new-window").getAttribute("aria-checked")).toBe("false");
    expect(p.$("close-tabs").getAttribute("aria-checked")).toBe("false");
    expect(p.patterns("blocked")).toEqual(["*.bank.com/*", "hr.example.com/*"]);
    expect(p.patterns("read_only")).toEqual(["mail.google.com/*"]);
    expect(p.$<HTMLSelectElement>("shot-size").value).toBe("1280x800");
    expect(p.$("shot-quality-value").textContent).toBe("80");
    expect(p.$<HTMLInputElement>("gif-folder").value).toBe("~/Downloads/browser-hand");
    expect(p.$<HTMLInputElement>("gif-delay").value).toBe("700");
    expect(p.$<HTMLInputElement>("idle").value).toBe("30");
    expect(p.$("version").textContent).toBe("browser-hand 0.1.0");
    expect(p.$("savebar").hidden).toBe(true);
    expect(p.$("banner").hidden).toBe(true);
  });

  it("editing: the bar counts changes, a bad pattern is refused inline, Discard reverts", () => {
    const p = mount();
    p.send({ type: "state", state: p.state() });
    p.addPattern("blocked", "payroll.example.com/*");
    p.addPattern("read_only", "https//docs.google");
    expect(p.patterns("blocked")).toContain("payroll.example.com/*");
    expect(p.$("read_only-error").textContent).toBe(NOT_A_PATTERN);
    expect(p.$("read_only-input").classList.contains("invalid")).toBe(true);
    expect(p.patterns("read_only")).toEqual(["mail.google.com/*"]);
    p.click("pace-fast");
    expect(p.$("savebar").hidden).toBe(false);
    expect(p.$("count").textContent).toBe("2 unsaved changes");

    p.click("discard");
    expect(p.$("savebar").hidden).toBe(true);
    expect(p.patterns("blocked")).toEqual(["*.bank.com/*", "hr.example.com/*"]);
    expect(p.$("pace-human").getAttribute("aria-checked")).toBe("true");
    expect(p.$("read_only-error").hidden).toBe(true);
  });

  it("shows the allow list, the screenshot saving and the audit rows, and edits them", () => {
    const p = mount();
    p.send({ type: "state", state: p.state() });
    expect(p.patterns("allowed")).toEqual([]);
    expect(p.$("save-shots").getAttribute("aria-checked")).toBe("false");
    expect(p.$<HTMLInputElement>("shot-folder").value).toBe("");
    expect(p.$("audit-on").getAttribute("aria-checked")).toBe("false");
    expect(p.$<HTMLInputElement>("audit-file").value).toBe("");

    p.addPattern("allowed", "docs.google.com/*");
    p.click("save-shots");
    p.click("audit-on");
    p.type("shot-folder", "~/Pictures/bh");
    p.type("audit-file", "~/logs/bh.jsonl");
    expect(p.patterns("allowed")).toEqual(["docs.google.com/*"]);
    expect(p.$("save-shots").getAttribute("aria-checked")).toBe("true");
    expect(p.$("count").textContent).toBe("5 unsaved changes");

    // An empty path is allowed (it means the default); a wrong one waits Save.
    p.type("shot-folder", "");
    expect(p.$("shot-folder-error").hidden).toBe(true);
    p.type("shot-folder", "pictures");
    expect(p.$("shot-folder-error").textContent).toMatch(/Start with/);
    p.type("audit-file", "/a/../b");
    expect(p.$("audit-file-error").textContent).toMatch(/\.\./);
    expect(p.$<HTMLButtonElement>("save").disabled).toBe(true);
  });

  it("removing a pattern and flipping a toggle are changes too", () => {
    const p = mount();
    p.send({ type: "state", state: p.state() });
    p.$("blocked-list")
      .querySelector<HTMLButtonElement>('[aria-label="Remove hr.example.com/*"]')!
      .click();
    p.click("close-tabs");
    expect(p.patterns("blocked")).toEqual(["*.bank.com/*"]);
    expect(p.$("close-tabs").getAttribute("aria-checked")).toBe("true");
    expect(p.$("count").textContent).toBe("2 unsaved changes");
  });

  it("a number out of range is marked and Save waits for it", () => {
    const p = mount();
    p.send({ type: "state", state: p.state() });
    p.type("gif-delay", "50");
    expect(p.$("gif-delay-error").textContent).toMatch(/100 to 5000 ms/);
    expect(p.$<HTMLButtonElement>("save").disabled).toBe(true);
    p.click("save");
    expect(p.sent).toEqual([]);
    p.type("gif-delay", "900");
    expect(p.$<HTMLButtonElement>("save").disabled).toBe(false);
  });

  it("saving: sends the draft on the revision it was made from, then a 4 s toast with the path", () => {
    const p = mount();
    p.send({ type: "state", state: p.state() });
    p.click("pace-fast");
    p.click("save");
    expect(p.sent).toEqual([
      {
        op: "save",
        settings: expect.objectContaining({ input: expect.objectContaining({ pace: "fast" }) }),
        revision: "100",
      },
    ]);
    expect(p.$("save").textContent).toBe("Saving");
    p.send({ type: "saved", ok: true, path: "/Users/someone/.config/browser-hand/config.toml" });
    p.send({
      type: "state",
      state: p.state({ settings: (p.sent[0] as { settings: Settings }).settings, revision: "200" }),
    });
    expect(p.$("toast").hidden).toBe(false);
    expect(p.$("toast-title").textContent).toBe("Saved");
    expect(p.$("toast-body").hidden).toBe(true);
    expect(p.$("toast").textContent).toBe("Saved");
    expect(p.$("savebar").hidden).toBe(true);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(p.$("toast").hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(p.$("toast").hidden).toBe(true);
  });

  it("a stale revision says changed in another profile and shows the file as it is now", () => {
    const p = mount();
    p.send({ type: "state", state: p.state() });
    p.click("pace-fast");
    // Another profile saved meanwhile: the page keeps the edit for now.
    const theirs = settingsWith((s) => (s.input.mouse_speed = 2));
    p.send({ type: "state", state: p.state({ settings: theirs, revision: "150" }) });
    expect(p.$("count").textContent).toBe("1 unsaved change");
    p.click("save");
    expect((p.sent[0] as { revision: string }).revision).toBe("100");
    p.send({
      type: "saved",
      ok: false,
      error: {
        field: null,
        message:
          "Settings changed in another profile. The page now shows them; make your change again.",
      },
    });
    expect(p.$("toast-title").textContent).toMatch(/changed in another profile/);
    expect(p.$("mouse-value").textContent).toBe("2.0×");
    expect(p.$("pace-human").getAttribute("aria-checked")).toBe("true");
    expect(p.$("savebar").hidden).toBe(true);
  });

  it("a refused value from the host shows under its list and in the bar", () => {
    const p = mount();
    p.send({ type: "state", state: p.state() });
    p.addPattern("blocked", "x.example.com/*");
    p.click("save");
    p.send({
      type: "saved",
      ok: false,
      error: { field: "sites.blocked", message: "sites.blocked: at most 200 patterns" },
    });
    expect(p.$("blocked-error").textContent).toBe("sites.blocked: at most 200 patterns");
    expect(p.$("save-error").textContent).toBe("sites.blocked: at most 200 patterns");
  });

  it("disconnected: the pill and banner follow the port, controls are read-only, Retry asks at once", () => {
    const p = mount();
    p.send({
      type: "state",
      state: p.state({
        connected: false,
        down: "not_running",
        detail: "Specified native messaging host not found.",
      }),
    });
    expect(p.$("pill").textContent).toBe("Not connected");
    expect(p.$("pill").className).toContain("warning");
    expect(p.$("banner").hidden).toBe(false);
    expect(p.$("banner-title").textContent).toBe("The browser-hand host is not running");
    expect(p.$("banner-body").textContent).toMatch(/Run browser-hand install, then Retry/);
    expect(p.$("banner-body").textContent).toMatch(/last ones the extension saw/);
    expect(p.$("sections").classList.contains("readonly")).toBe(true);
    expect(p.$<HTMLButtonElement>("pace-fast").disabled).toBe(true);
    expect(p.$<HTMLInputElement>("blocked-input").disabled).toBe(true);
    expect(p.patterns("blocked"), "the last values still show").toEqual([
      "*.bank.com/*",
      "hr.example.com/*",
    ]);
    p.click("pace-fast");
    expect(p.$("savebar").hidden).toBe(true);
    p.click("retry");
    expect(p.sent).toEqual([{ op: "retry" }]);

    p.send({ type: "state", state: p.state() });
    expect(p.$("banner").hidden).toBe(true);
    expect(p.$<HTMLButtonElement>("pace-fast").disabled).toBe(false);
  });

  it("an older host is named as older", () => {
    const p = mount();
    p.send({ type: "state", state: p.state({ connected: false, down: "older" }) });
    expect(p.$("banner-title").textContent).toBe(
      "The browser-hand host is older than this extension",
    );
  });

  it("warnings about the file show while connected", () => {
    const p = mount();
    p.send({
      type: "state",
      state: p.state({ warnings: ["input.mouse_speed: must be 0.25 to 3.0; using the default"] }),
    });
    expect(p.$("warnings").hidden).toBe(false);
    expect(p.$("warnings").textContent).toContain("input.mouse_speed");
    expect(p.$("warnings").textContent).not.toContain("config.toml");
  });

  describe("with profiles from more than one browser", () => {
    const two = (want: string) => {
      const p = mount();
      const s = p.state({
        profiles: [
          { dir: "Default", name: "Me", id: "chrome:Default", browser: "Google Chrome" },
          { dir: "Default", name: "Bee", id: "brave:Default", browser: "Brave" },
        ],
      });
      s.settings.sessions.default_profile = want;
      p.send({ type: "state", state: s });
      const select = p.$<HTMLSelectElement>("default-profile");
      return { select, labels: [...select.options].map((o) => o.text) };
    };

    it("offers each id and names the browser", () => {
      const { select, labels } = two("brave:Default");
      expect(labels).toEqual(["Ask each time", "Me (Google Chrome)", "Bee (Brave)"]);
      expect([...select.options].map((o) => o.value)).toEqual([
        "",
        "chrome:Default",
        "brave:Default",
      ]);
      expect(select.value).toBe("brave:Default");
    });

    it("shows a stored bare dir as the first browser's profile with that dir", () => {
      expect(two("Default").select.value).toBe("chrome:Default");
    });

    it("keeps a stored id the browsers no longer have as not found", () => {
      expect(two("edge:Default").labels.at(-1)).toBe("edge:Default (not found)");
    });
  });

  it("an older host's profiles, with no id, are offered by dir", () => {
    const p = mount();
    const s = p.state({
      profiles: [{ dir: "Default", name: "Personal" } as never],
    });
    s.settings.sessions.default_profile = "Default";
    p.send({ type: "state", state: s });
    const select = p.$<HTMLSelectElement>("default-profile");
    expect([...select.options].map((o) => o.value)).toEqual(["", "Default"]);
    expect(select.value).toBe("Default");
    expect(select.selectedOptions[0]!.text).toBe("Personal");
  });

  it("a default profile Chrome no longer has stays visible as not found", () => {
    const p = mount();
    const s = p.state();
    s.settings.sessions.default_profile = "Profile 9";
    p.send({ type: "state", state: s });
    expect(p.$<HTMLSelectElement>("default-profile").selectedOptions[0]!.text).toBe(
      "Profile 9 (not found)",
    );
  });
});

describe("page helpers", () => {
  it("count one change per value and per pattern", () => {
    const a = structuredClone(DEFAULTS);
    const b = settingsWith((s) => {
      s.sites.blocked = ["a.com/*", "b.com/*"];
      s.capture.screenshot_quality = 70;
    });
    expect(changeCount(a, b)).toBe(3);
    expect(changeCount(a, a)).toBe(0);
    const c = settingsWith((s) => {
      s.sites.allowed = ["a.com/*"];
      s.capture.save_screenshots = true;
      s.audit.enabled = true;
    });
    expect(changeCount(a, c)).toBe(3);
  });

  it("write speeds the way the design does", () => {
    expect([speedLabel(1), speedLabel(0.5), speedLabel(0.25), speedLabel(3)]).toEqual([
      "1.0×",
      "0.5×",
      "0.25×",
      "3.0×",
    ]);
  });
});
