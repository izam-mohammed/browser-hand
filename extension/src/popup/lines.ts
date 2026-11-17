// A recording's steps as the lines `recording_get` gives Claude: a port of
// `step_line` in `host/src/tools/recording.rs`, held to it by the golden file
// `host/tests/fixtures/recording-lines.txt`, which both test suites read
// (plans/08-recorder-popup.md, Decision 3). A change to one changes the other.
import { MASKED, type Step } from "../page/record";
import type { Meta } from "../recorder";

const TARGET_MAX = 120;
const VALUE_MAX = 200;
const URL_MAX = 200;

/** Page data on one line: control characters flattened, cut at `max` characters. */
export function clip(s: string, max: number): string {
  const chars = Array.from(s.replace(/\p{Cc}/gu, " "));
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

const json = (v: unknown) => JSON.stringify(v ?? null);

function selectorText(sel: unknown): string {
  if (typeof sel === "string") return sel;
  if (Array.isArray(sel))
    return sel.filter((p): p is string => typeof p === "string").join(" >>> ");
  return "";
}

/** The selector a person reads best: the aria/ one, else the first. */
function target(step: Step): string | undefined {
  const all = Array.isArray(step.selectors)
    ? step.selectors.map(selectorText).filter((t) => t)
    : [];
  const t = all.find((s) => s.startsWith("aria/")) ?? all[0];
  return t === undefined ? undefined : clip(t, TARGET_MAX);
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** `<n>. [<actor>] <type> <aria or first selector> <value>`, with where a
 * step led and which frame it was in. */
export function stepLine(n: number, step: Step, meta?: Partial<Meta>): string {
  const actor = str(meta?.actor) ?? "person";
  const kind = str(step.type) ?? "?";
  const parts = [`${n}. [${clip(actor, 10)}] ${clip(kind, 30)}`];
  const add = (s: string) => parts.push(s);
  switch (kind) {
    case "navigate":
      add(clip(str(step.url) ?? "", URL_MAX));
      break;
    case "keyDown":
    case "keyUp":
      add(clip(str(step.key) ?? "", 30));
      break;
    case "setViewport":
      add(`${json(step.width)}x${json(step.height)}`);
      break;
    case "scroll": {
      const t = target(step);
      if (t !== undefined) add(t);
      const int = (v: unknown) => (Number.isSafeInteger(v) ? v : 0);
      add(`to ${int(step.x)},${int(step.y)}`);
      break;
    }
    default: {
      const t = target(step);
      if (t !== undefined) add(t);
    }
  }
  if ("value" in step) {
    const v = str(step.value) ?? json(step.value);
    add(meta?.masked === true || v === MASKED ? MASKED : JSON.stringify(clip(v, VALUE_MAX)));
  }
  const events = Array.isArray(step.assertedEvents)
    ? (step.assertedEvents as { type?: unknown; url?: unknown }[])
    : [];
  const loads = str(events.find((e) => e?.type === "navigation")?.url);
  if (loads && kind !== "navigate") add(`(then loads ${clip(loads, URL_MAX)})`);
  if (Array.isArray(step.frame) && step.frame.length)
    add(`(in frame ${step.frame.map(json).join(".")})`);
  if (meta?.unrecorded === true)
    add("(Chrome lets no extension into this page: nothing on it was recorded)");
  if (meta?.blocked === true)
    add(
      "(a site blocked in browser-hand settings: nothing on it was recorded, not even its address)",
    );
  return parts.join(" ");
}
