// `recording_replay`'s hands: one recorded step at a time, through the same
// humane `Input` the `computer` tool uses (plans/05-record-steps.md, Phase 4).
// The MCP server walks the steps, swaps in values and stops at the first
// failure; this finds each step's element by its selectors in order and acts.
import type { ComputerArgs } from "./input";
import type { Selector, Step } from "./page/record";
import { ToolError } from "./wire";

/** An element can take a moment to appear after a load or a click. */
export const RESOLVE_WAIT_MS = 5_000;
export const RESOLVE_POLL_MS = 250;
export const LOAD_WAIT_MS = 30_000;

export interface Resolved {
  ref: string;
  kind: "select" | "check" | "text" | "editable" | "other";
  tried: string[];
}

export interface ReplayDeps {
  resolve(tabId: number, selectors: Selector[]): Promise<Resolved>;
  act(tabId: number, args: ComputerArgs): Promise<string>;
  /** Brings the tab to the front: a link that opened a new tab hides the
   * replay tab, and mouse and keys sent to a hidden tab do nothing. */
  show(tabId: number): Promise<void>;
  formInput(tabId: number, ref: string, value: string): Promise<unknown>;
  scroll(tabId: number, ref: string | undefined, x: number, y: number): Promise<unknown>;
  navigate(tabId: number, url: string): Promise<unknown>;
  waitForLoad(tabId: number, timeoutMs: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
  isMac: boolean;
}

const expectsLoad = (step: Step) =>
  Array.isArray(step.assertedEvents) &&
  step.assertedEvents.some((e) => (e as { type?: string })?.type === "navigation");

async function find(d: ReplayDeps, tabId: number, step: Step): Promise<Resolved> {
  const selectors = step.selectors ?? [];
  if (!selectors.length) throw new ToolError("bad_args", `A ${step.type} step needs selectors`);
  const deadline = d.now() + RESOLVE_WAIT_MS;
  let why = "";
  for (;;) {
    try {
      return await d.resolve(tabId, selectors);
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    if (d.now() >= deadline) break;
    await d.sleep(RESOLVE_POLL_MS);
  }
  throw new ToolError("page_error", `Not found within ${RESOLVE_WAIT_MS / 1000} s. ${why}`);
}

/** Acts, and when the step loaded a page, waits for that load. */
async function withLoad(d: ReplayDeps, tabId: number, step: Step, act: () => Promise<unknown>) {
  const load = expectsLoad(step) ? d.waitForLoad(tabId, LOAD_WAIT_MS) : null;
  await act();
  if (load && !(await load)) return " (the page was still loading after 30 s)";
  return "";
}

/** Replays one step on `tabId`, saying what it did. */
export async function replayStep(d: ReplayDeps, tabId: number, step: Step): Promise<string> {
  if (Array.isArray(step.frame) && step.frame.length) {
    throw new ToolError(
      "page_error",
      "This step is inside a frame; replay reaches the top frame only. Do it with computer instead.",
    );
  }
  switch (step.type) {
    case "setViewport":
      return "skipped: the window keeps its size";
    case "navigate":
      await d.navigate(tabId, String(step.url ?? ""));
      return `opened ${step.url}`;
    case "click":
    case "doubleClick": {
      const r = await find(d, tabId, step);
      await d.show(tabId);
      const action =
        step.type === "doubleClick"
          ? "double_click"
          : step.button === "secondary"
            ? "right_click"
            : "left_click";
      const note = await withLoad(d, tabId, step, () => d.act(tabId, { action, ref: r.ref }));
      return `${action.replace("_", " ")} on ${r.tried.at(-1)}${note}`;
    }
    case "change": {
      const r = await find(d, tabId, step);
      const value = String(step.value ?? "");
      if (r.kind === "select" || r.kind === "check") {
        await d.formInput(tabId, r.ref, value);
        return `set ${r.tried.at(-1)}`;
      }
      // Click into the field, select what is there, and type over it.
      await d.show(tabId);
      const note = await withLoad(d, tabId, step, async () => {
        await d.act(tabId, { action: "left_click", ref: r.ref });
        await d.act(tabId, { action: "key", text: d.isMac ? "cmd+a" : "ctrl+a" });
        if (value) await d.act(tabId, { action: "type", text: value });
        else await d.act(tabId, { action: "key", text: "Delete" });
      });
      return `typed into ${r.tried.at(-1)}${note}`;
    }
    case "keyDown":
      return "skipped: the key is pressed at its keyUp";
    case "keyUp": {
      const key = String(step.key ?? "");
      if (!key) throw new ToolError("bad_args", "A keyUp step needs key");
      await d.show(tabId);
      const note = await withLoad(d, tabId, step, () => d.act(tabId, { action: "key", text: key }));
      return `pressed ${key}${note}`;
    }
    case "scroll": {
      const x = Number(step.x ?? 0);
      const y = Number(step.y ?? 0);
      if (step.selectors?.length) {
        const r = await find(d, tabId, step);
        await d.scroll(tabId, r.ref, x, y);
        return `scrolled ${r.tried.at(-1)} to ${x},${y}`;
      }
      await d.scroll(tabId, undefined, x, y);
      return `scrolled the page to ${x},${y}`;
    }
    default:
      return `skipped: ${step.type} steps are not replayed`;
  }
}
