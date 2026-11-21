// `wait_for`: one call that returns when the page shows what Claude waits for
// (plans/17-hands-free-and-guarded.md, Decision 5). The extension polls, not
// the page: a content script dies with the page on a navigation, and the poll
// has to outlive it. Each poll swallows a failed read, because during a load
// the page has no content script yet.
import { RESOLVE_POLL_MS } from "./replay";
import { ToolError } from "./wire";

export const WAIT_DEFAULT_S = 15;
export const WAIT_MAX_S = 60;

export interface WaitArgs {
  tabId: number;
  /** Text the page must show, matched without regard to case. */
  text?: string;
  /** An element ref that must be on the page. */
  ref?: string;
  /** A substring the tab's URL must hold. */
  url_contains?: string;
  /** Wait for the condition to stop holding. */
  gone?: boolean;
  /** 1 to 60, default 15. */
  timeout_s?: number;
}

export interface WaitDeps {
  /** The page's text, from the content script. */
  pageText(tabId: number): Promise<string>;
  /** Whether the content script still finds the ref. */
  hasRef(tabId: number, ref: string): Promise<boolean>;
  /** The tab's URL now. */
  url(tabId: number): Promise<string>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

type Condition = { what: string; holds(tabId: number, d: WaitDeps): Promise<boolean> };

/** The one condition `a` names; anything else is a bad call. */
function condition(a: WaitArgs): Condition {
  const named = [a.text, a.ref, a.url_contains].filter((v) => v !== undefined);
  if (named.length !== 1) {
    throw new ToolError("bad_args", "wait_for needs exactly one of text, ref or url_contains");
  }
  if (a.text !== undefined) {
    const want = a.text.toLowerCase();
    return {
      what: `the text "${a.text}"`,
      holds: async (tabId, d) => (await d.pageText(tabId)).toLowerCase().includes(want),
    };
  }
  if (a.ref !== undefined) {
    const ref = a.ref;
    return { what: `the element ${ref}`, holds: (tabId, d) => d.hasRef(tabId, ref) };
  }
  const part = a.url_contains as string;
  return {
    what: `a URL containing "${part}"`,
    holds: async (tabId, d) => (await d.url(tabId)).includes(part),
  };
}

/** Polls until the condition holds (or stops holding, with `gone`). */
export async function waitFor(d: WaitDeps, a: WaitArgs): Promise<string> {
  const seconds = a.timeout_s ?? WAIT_DEFAULT_S;
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > WAIT_MAX_S) {
    throw new ToolError("bad_args", `timeout_s must be 1 to ${WAIT_MAX_S}`);
  }
  const cond = condition(a);
  const gone = a.gone === true;
  const started = d.now();
  for (;;) {
    // A failed read means the page is between loads: not there yet, and not
    // gone either, so it settles nothing.
    const holds = await cond.holds(a.tabId, d).then(
      (v) => v,
      () => undefined,
    );
    if (holds !== undefined && holds !== gone) {
      const took = Math.round((d.now() - started) / 100) / 10;
      return gone ? `${cond.what} is gone after ${took} s` : `Found ${cond.what} after ${took} s`;
    }
    if (d.now() - started >= seconds * 1000) {
      throw new ToolError(
        "timeout",
        gone
          ? `${cond.what} was still there after ${seconds} s`
          : `${cond.what} did not appear within ${seconds} s`,
      );
    }
    await d.sleep(RESOLVE_POLL_MS);
  }
}
