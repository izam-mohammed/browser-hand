// MAIN-world script at document_start: copies console output and uncaught
// errors to the isolated content script (plans/plan-page-tools.md,
// decision 3). It calls the original console methods unchanged.
export const HOOK_TAG = "__browserHandConsole";

export interface ConsoleEntry {
  level: string;
  text: string;
  time: number;
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export function installHooks(win: Window & typeof globalThis) {
  const post = (level: string, text: string) =>
    win.postMessage({ [HOOK_TAG]: true, level, text: text.slice(0, 4000), time: Date.now() }, "*");

  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = win.console[level];
    win.console[level] = function (...args: unknown[]) {
      try {
        post(level, args.map(stringify).join(" "));
      } catch {
        // never break the page's own logging
      }
      return original.apply(this, args);
    };
  }
  win.addEventListener("error", (e) => post("exception", `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`));
  win.addEventListener("unhandledrejection", (e) => post("exception", `Unhandled rejection: ${stringify(e.reason)}`));
}
