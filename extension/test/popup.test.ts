// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Step } from "../src/page/record";
import { PopupPage, stateText, when, type PopupApi } from "../src/popup/page";
import { clip, stepLine } from "../src/popup/lines";
import type { Meta, PopupMsg, Recording, Summary } from "../src/recorder";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// The golden file is the host's (plans/08-recorder-popup.md, Contract):
// host/tests/mcp.rs holds `step_line` to it, and this holds `stepLine`.
describe("stepLine", () => {
  const fixture = JSON.parse(read("../../host/tests/fixtures/recordings.json")) as { records: Record<string, Recording> };

  it("writes every fixture step exactly as recording_get does (host/tests/fixtures/recording-lines.txt)", () => {
    let out = "";
    for (const id of Object.keys(fixture.records).sort()) {
      const rec = fixture.records[id]!;
      out += `# ${id}\n`;
      rec.flow.steps.forEach((step, i) => (out += `${stepLine(i + 1, step, rec.meta[i])}\n`));
    }
    expect(out).toBe(read("../../host/tests/fixtures/recording-lines.txt"));
  });

  it("masks a value the meta marks sensitive, whatever the step holds", () => {
    const step: Step = { type: "change", selectors: [["#pw"]], value: "hunter2" };
    expect(stepLine(1, step, { actor: "person", masked: true })).toBe("1. [person] change #pw <masked>");
    expect(stepLine(2, { type: "change", value: "<masked>" })).toBe("2. [person] change <masked>");
  });

  it("clips by character, not UTF-16 unit, and flattens control characters", () => {
    expect(clip("a\nb\u0007c", 10)).toBe("a b c");
    expect(clip("🐈🐈🐈", 2)).toBe("🐈🐈…");
  });

  it("takes a step with nothing it knows and still writes a line", () => {
    expect(stepLine(3, { type: "scroll" })).toBe("3. [person] scroll to 0,0");
    expect(stepLine(4, { type: "setViewport" })).toBe("4. [person] setViewport nullxnull");
    expect(stepLine(5, { type: "click", assertedEvents: [{ type: "navigation", url: "" }] })).toBe("5. [person] click");
  });
});

describe("popup text", () => {
  const NOW = new Date(2026, 9, 21, 19, 0).getTime();

  it("says when, as today, yesterday or a date", () => {
    expect(when(new Date(2026, 9, 21, 18, 9).getTime(), NOW)).toBe("Today 18:09");
    expect(when(new Date(2026, 9, 20, 11, 20).getTime(), NOW)).toBe("Yesterday 11:20");
    expect(when(new Date(2026, 9, 2, 7, 5).getTime(), NOW)).toBe("2026-10-02 07:05");
  });

  it("says how a recording ended", () => {
    const s: Summary = { id: "r", title: "", startedAt: 0, stoppedAt: 1, steps: 1 };
    expect(stateText(s, "r")).toBe("recording");
    expect(stateText(s, null)).toBe("stopped");
    expect(stateText({ ...s, stopReason: "stopped by the person" }, null)).toBe("stopped by you");
    expect(stateText({ ...s, stopReason: "its window closed" }, null)).toBe("stopped: its window closed");
  });
});

// The page, on a fake worker.

const NOW = new Date(2026, 9, 21, 19, 0).getTime();
const at = (h: number, m: number, daysAgo = 0) => new Date(2026, 9, 21 - daysAgo, h, m).getTime();

function recording(id: string, title: string, steps: Step[], meta: Partial<Meta>[] = []): Recording {
  return { id, title, startedAt: at(18, 9), stoppedAt: at(18, 20), windowId: 1, flow: { title, steps }, meta: meta as Meta[], stopReason: "stopped by the person" };
}

const WALK = recording(
  "rec_walk",
  "record walk",
  [
    { type: "navigate", url: "http://127.0.0.1:8765/rec.html" },
    { type: "change", selectors: [['aria/Username[role="textbox"]']], value: "hisham" },
    { type: "change", selectors: [['aria/Password[role="textbox"]']], value: "<masked>" },
  ],
  [{ actor: "person" }, { actor: "person" }, { actor: "person", masked: true }],
);

const LIST: Summary[] = [
  { id: "rec_walk", title: "record walk", startedAt: at(18, 9), stoppedAt: at(18, 20), steps: 3, stopReason: "stopped by the person" },
  { id: "rec_hands", title: "hands walk", startedAt: at(16, 51), stoppedAt: at(17, 0), steps: 9, stopReason: "no step for 30 minutes" },
  { id: "rec_flights", title: "Search flights", startedAt: at(11, 20, 1), stoppedAt: at(11, 40, 1), steps: 1, stopReason: "stopped by the person" },
];

function fakeApi(list: Summary[] = LIST, recordingId: string | null = null) {
  const sent: PopupMsg[] = [];
  const records = new Map([[WALK.id, WALK]]);
  const ctl = { closed: 0, settings: 0, fail: null as string | null };
  const api: PopupApi = {
    async send(msg) {
      sent.push(msg);
      if (ctl.fail) throw new Error(ctl.fail);
      switch (msg.__bhPopup) {
        case "list":
          return { recordings: list, recording: recordingId };
        case "get": {
          const r = records.get(msg.id);
          if (!r) throw new Error(`No recording ${msg.id}.`);
          return r;
        }
        case "delete":
          return `Deleted recording ${msg.id}.`;
        case "start":
          return true;
        case "stop":
          return undefined;
      }
    },
    windowId: async () => 7,
    openSettings: () => void ctl.settings++,
    close: () => void ctl.closed++,
    now: () => NOW,
  };
  return { api, sent, ctl, records };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const ops = (sent: PopupMsg[]) => sent.map((m) => m.__bhPopup);
const visible = (e: HTMLElement) => !e.hidden && !e.closest("[hidden]");

describe("popup page", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById("app")!;
  });

  async function mount(list?: Summary[], recordingId: string | null = null) {
    const f = fakeApi(list, recordingId);
    const page = new PopupPage(root, f.api);
    await page.ready;
    const rows = () => [...root.querySelectorAll<HTMLButtonElement>("button.row")];
    return { ...f, page, rows };
  }

  it("lists recordings newest first with title, time and step count, and starts with focus on Start", async () => {
    const { page, rows, sent } = await mount();
    expect(ops(sent)).toEqual(["list"]);
    expect(document.activeElement).toBe(page.get("start"));
    expect(rows().map((r) => r.querySelector(".row-title")!.textContent)).toEqual(["record walk", "hands walk", "Search flights"]);
    expect(rows().map((r) => r.querySelector(".row-meta")!.textContent)).toEqual([
      "Today 18:09 · 3 steps",
      "Today 16:51 · 9 steps · stopped: no step for 30 minutes",
      "Yesterday 11:20 · 1 step",
    ]);
    expect(visible(page.get("recent"))).toBe(true);
    expect(visible(page.get("empty"))).toBe(false);
  });

  it("shows the empty state with Start and Settings when there are no recordings", async () => {
    const { page, rows } = await mount([]);
    expect(rows()).toHaveLength(0);
    expect(visible(page.get("empty"))).toBe(true);
    expect(page.get("empty").textContent).toContain("No recordings yet");
    expect(visible(page.get("recent"))).toBe(false);
    expect(visible(page.get("foot"))).toBe(false);
    expect(visible(page.get("start"))).toBe(true);
    expect(visible(page.get("settings"))).toBe(true);
  });

  it("Start records the popup's own window and closes the popup", async () => {
    const { page, sent, ctl } = await mount();
    page.get("start").click();
    await flush();
    expect(sent.at(-1)).toEqual({ __bhPopup: "start", windowId: 7 });
    expect(ctl.closed).toBe(1);
  });

  it("Start that fails says why and stays open", async () => {
    const { page, ctl } = await mount();
    ctl.fail = "That window has no tab to record.";
    page.get("start").click();
    await flush();
    expect(ctl.closed).toBe(0);
    expect(visible(page.get("error"))).toBe(true);
    expect(page.get("error").textContent).toBe("That window has no tab to record.");
    expect(page.get<HTMLButtonElement>("start").disabled).toBe(false);
  });

  it("Settings opens the settings page", async () => {
    const { page, ctl } = await mount();
    page.get("settings").click();
    expect(ctl.settings).toBe(1);
  });

  it("opens a recording to its steps as Claude reads them, with a back control", async () => {
    const { page, rows, sent } = await mount();
    rows()[0]!.click();
    await flush();
    expect(sent.at(-1)).toEqual({ __bhPopup: "get", id: "rec_walk" });
    expect(visible(page.get("steps-view"))).toBe(true);
    expect(visible(page.get("list-view"))).toBe(false);
    expect(page.get("rec-title").textContent).toBe("record walk");
    expect(page.get("rec-meta").textContent).toBe("Today 18:09 · 3 steps · stopped by you");
    expect([...page.get("steps").children].map((li) => li.textContent)).toEqual([
      "1. [person] navigate http://127.0.0.1:8765/rec.html",
      '2. [person] change aria/Username[role="textbox"] "hisham"',
      '3. [person] change aria/Password[role="textbox"] <masked>',
    ]);
    expect(document.activeElement).toBe(page.get("back"));
    page.get("back").click();
    expect(visible(page.get("list-view"))).toBe(true);
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("a recording that cannot be read says so and stays on the list", async () => {
    const { page, rows } = await mount();
    rows()[1]!.click();
    await flush();
    expect(visible(page.get("list-view"))).toBe(true);
    expect(page.get("error").textContent).toBe("No recording rec_hands.");
  });

  it("deletes only after Delete for good, in place, then returns to the list", async () => {
    const { page, rows, sent } = await mount();
    rows()[0]!.click();
    await flush();
    page.get("delete").click();
    expect(ops(sent)).not.toContain("delete");
    expect(visible(page.get("confirm"))).toBe(true);
    expect(page.get("confirm").textContent).toBe("Delete for good");
    expect(visible(page.get("delete"))).toBe(false);
    // Focus is on Keep it, where Delete was: a second Enter by reflex keeps it.
    expect(document.activeElement).toBe(page.get("cancel"));
    page.get("cancel").click();
    expect(visible(page.get("delete"))).toBe(true);
    expect(document.activeElement).toBe(page.get("delete"));

    page.get("delete").click();
    page.get("confirm").click();
    await flush();
    expect(sent.at(-1)).toEqual({ __bhPopup: "delete", id: "rec_walk" });
    expect(visible(page.get("list-view"))).toBe(true);
    expect(rows().map((r) => r.dataset.id)).toEqual(["rec_hands", "rec_flights"]);
    expect(document.activeElement).toBe(page.get("start"));
  });

  it("a refused delete says why and keeps the recording", async () => {
    const { page, rows, ctl } = await mount();
    rows()[0]!.click();
    await flush();
    page.get("delete").click();
    ctl.fail = "rec_walk is recording now; the person stops it with the toolbar button first.";
    page.get("confirm").click();
    await flush();
    expect(visible(page.get("steps-view"))).toBe(true);
    expect(page.get("error").textContent).toMatch(/recording now/);
    expect(visible(page.get("delete"))).toBe(true);
  });

  it("works by keyboard: every recording is a button after Start, Escape steps back", async () => {
    const { page, rows } = await mount();
    const focusable = [...root.querySelectorAll<HTMLElement>("button, [tabindex]")].filter(visible);
    expect(focusable.indexOf(page.get("start"))).toBeLessThan(focusable.indexOf(rows()[0]!));
    expect(rows().every((r) => r.type === "button")).toBe(true);
    rows()[0]!.click(); // Enter on a button clicks it
    await flush();
    page.get("delete").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(visible(page.get("delete"))).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(visible(page.get("list-view"))).toBe(true);
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("renders page text as text", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    const { page, rows, records } = await mount([{ ...LIST[0]!, title: evil }]);
    records.set("rec_walk", { ...WALK, title: evil, flow: { title: evil, steps: [{ type: "click", selectors: [[`aria/${evil}`]] }] }, meta: [] });
    expect(rows()[0]!.querySelector(".row-title")!.textContent).toBe(evil);
    rows()[0]!.click();
    await flush();
    expect(page.get("rec-title").textContent).toBe(evil);
    expect(page.get("steps").textContent).toContain(evil);
    expect(root.querySelector("img")).toBeNull();
  });

  it("opened while recording (the popup switch was lost), it stops and closes", async () => {
    const { sent, ctl } = await mount(LIST, "rec_walk");
    expect(ops(sent)).toEqual(["list", "stop"]);
    expect(ctl.closed).toBe(1);
  });

  it("with the worker not answering, says so and still offers Start", async () => {
    const f = fakeApi();
    f.ctl.fail = "browser-hand's service worker did not answer. Reload the extension.";
    const page = new PopupPage(root, f.api);
    await page.ready;
    expect(page.get("error").textContent).toMatch(/did not answer/);
    expect(visible(page.get("start"))).toBe(true);
  });

  it("renders 5,000 steps in one scrolling list", async () => {
    const { page, rows, records } = await mount();
    const steps: Step[] = Array.from({ length: 5_000 }, (_, i) => ({ type: "click", selectors: [[`aria/b${i}`]] }));
    records.set("rec_walk", { ...WALK, flow: { title: "big", steps }, meta: [] });
    rows()[0]!.click();
    await flush();
    expect(page.get("steps").children).toHaveLength(5_000);
    expect(page.get("steps").lastElementChild!.textContent).toBe("5000. [person] click aria/b4999");
  });
});

describe("the popup's CSS", () => {
  const css = read("../src/popup/popup.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it("names no colour: every colour is a theme.gen.css token", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("is 360 px wide and never taller than 600 px", () => {
    expect(css).toMatch(/width: 360px;/);
    const heights = [...css.matchAll(/max-height: (\d+)px/g)].map((m) => Number(m[1]));
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.max(...heights)).toBeLessThanOrEqual(600);
  });

  it("the popup page loads the shared tokens before its own CSS", () => {
    const html = read("../popup.html");
    expect(html.indexOf("theme.gen.css")).toBeGreaterThan(0);
    expect(html.indexOf("theme.gen.css")).toBeLessThan(html.indexOf("popup.css"));
    expect(html).not.toMatch(/<script>(?!<)/);
  });
});
