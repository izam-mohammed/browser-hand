// Blocked and read-only sites (plans/06-settings.md, Decisions 6 and 7).
// A pattern is `host/path` with `*` for any run of characters, no scheme,
// port or query; `*.x.com` also matches `x.com`. Each pattern compiles once
// to a regex for the tool gate here and to a DNR `regexFilter` for the
// network rules (`site-rules.ts`), from the same pieces, so the two agree.
// `host/src/config.rs` holds the same grammar.
import { ToolError } from "./wire";

export const MAX_PATTERNS = 200;
export const MAX_PATTERN_CHARS = 100;
/** The settings page's words for a pattern it cannot read
 * (`design/settings--editing.png`). */
export const NOT_A_PATTERN = "Not a pattern. Use host/path, for example docs.google.com/*";

/** Whether `p` follows the grammar; the host has a dot, or is `localhost` or `*`. */
export function isPattern(p: string): boolean {
  if (!p || p.trim() !== p || /[\s?#\\]/.test(p) || /[\u0000-\u001f\u007f]/.test(p)) return false;
  const slash = p.indexOf("/");
  if (slash <= 0) return false;
  const host = p.slice(0, slash);
  if (!/^[A-Za-z0-9.*-]+$/.test(host)) return false;
  if (host === "*" || host.toLowerCase() === "localhost") return true;
  return host.includes(".") && host.split(".").every((label) => label.length > 0);
}

/** Why the page cannot add `p` to `list`, or null when it can. */
export function patternProblem(p: string, list: readonly string[]): string | null {
  if ([...p].length > MAX_PATTERN_CHARS) return `Longer than ${MAX_PATTERN_CHARS} characters.`;
  if (!isPattern(p)) return NOT_A_PATTERN;
  if (list.includes(p)) return "Already in the list.";
  if (list.length >= MAX_PATTERNS) return `At most ${MAX_PATTERNS} patterns.`;
  return null;
}

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** The pattern as two regex pieces: its host (no `*` crosses a `/`) and its path. */
function pieces(p: string): { host: string; path: string } {
  const slash = p.indexOf("/");
  let host = p.slice(0, slash).toLowerCase();
  let prefix = "";
  if (host.startsWith("*.")) {
    prefix = "(?:[^/]*\\.)?";
    host = host.slice(2);
  }
  return {
    host: prefix + host.split("*").map(escape).join("[^/]*"),
    path: p.slice(slash).split("*").map(escape).join(".*"),
  };
}

/** For the gate: matched against `hostname + pathname`. */
export function gateRegex(p: string): RegExp {
  const { host, path } = pieces(p);
  return new RegExp(`^${host}${path}$`);
}

/** For a DNR rule: matched against the whole request URL. */
export function dnrRegex(p: string): string {
  const { host, path } = pieces(p);
  return `^(?:https?|wss?)://(?:[^/@]*@)?${host}(?::[0-9]+)?${path}(?:[?#].*)?$`;
}

export type Access = "blocked" | "read_only" | "open";

/** The two lists, compiled once. Patterns that fail the grammar are skipped
 * (the host already refused or dropped them). */
export class SiteRules {
  private blocked: RegExp[];
  private readOnly: RegExp[];

  constructor(blocked: readonly string[] = [], readOnly: readonly string[] = []) {
    this.blocked = blocked.filter(isPattern).map(gateRegex);
    this.readOnly = readOnly.filter(isPattern).map(gateRegex);
  }

  /** What the settings allow on `url`. URLs with no host are open. */
  access(url: string | undefined): Access {
    let u: URL;
    try {
      u = new URL(url ?? "");
    } catch {
      return "open";
    }
    if (!u.hostname) return "open";
    const target = u.hostname.toLowerCase() + (u.pathname || "/");
    if (this.blocked.some((r) => r.test(target))) return "blocked";
    if (this.readOnly.some((r) => r.test(target))) return "read_only";
    return "open";
  }
}

/** How a tool uses a tab: `read` passes read-only sites, `act` does not,
 * `any` (closing a tab) is never refused. */
export type Use = "read" | "act" | "any";

/** `computer` actions that only look (Edge cases: screenshot, zoom, scroll, scroll_to). */
const LOOKING = new Set(["screenshot", "zoom", "scroll", "scroll_to"]);
/** Tools that only read the page, or touch the window and not the page. */
const READING = new Set(["read_page", "find", "get_page_text", "read_console_messages", "read_network_requests", "resize_window"]);

/** What `tool` (with its `action` for `computer`) does to its tab.
 * `navigate` checks its own way (`TabTools.navigate`): leaving a site is
 * never refused, arriving at a blocked one is. */
export function useFor(tool: string, args: { action?: string } = {}): Use {
  if (tool === "tabs_close") return "any";
  if (READING.has(tool)) return "read";
  if (tool === "computer" && LOOKING.has(args.action ?? "")) return "read";
  return "act";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** Throws `blocked` when the settings refuse `use` on `url`. */
export function gate(rules: SiteRules, url: string | undefined, use: Use) {
  if (use === "any") return;
  const access = rules.access(url);
  if (access === "blocked") {
    throw new ToolError("blocked", `${hostOf(url!)} is blocked in browser-hand settings; ask the person.`);
  }
  if (access === "read_only" && use === "act") {
    throw new ToolError(
      "blocked",
      `${hostOf(url!)} is read-only in browser-hand settings: Claude may read it but not click, type or run scripts there; ask the person.`,
    );
  }
}
