// The isolated world's buffer of what the MAIN-world hooks saw. A new
// document starts a new buffer, which is what "current domain only" means
// for a page that navigated.
import { HOOK_TAG, MAX_ENTRY_CHARS, type ConsoleEntry } from "./hooks";

export const MAX_ENTRIES = 1000;

export class ConsoleBuffer {
  private entries: ConsoleEntry[] = [];

  listen(win: Window) {
    win.document.addEventListener(HOOK_TAG, (e) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail !== "string") return;
      let d: { level?: unknown; text?: unknown; time?: unknown };
      try {
        d = JSON.parse(detail);
      } catch {
        return;
      }
      if (!d || typeof d !== "object") return;
      // The page can dispatch the event itself, so cap it here too.
      this.push({
        level: String(d.level),
        text: String(d.text).slice(0, MAX_ENTRY_CHARS),
        time: Number(d.time),
      });
    });
  }

  push(entry: ConsoleEntry) {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  read(opts: { pattern?: string; onlyErrors?: boolean; limit?: number; clear?: boolean }): string {
    let re: RegExp | undefined;
    if (opts.pattern) {
      try {
        re = new RegExp(opts.pattern, "i");
      } catch (e) {
        throw Object.assign(new Error(`Bad pattern: ${(e as Error).message}`), {
          code: "bad_args",
        });
      }
    }
    let found = this.entries.filter(
      (e) =>
        (!opts.onlyErrors || e.level === "error" || e.level === "exception") &&
        (!re || re.test(e.text)),
    );
    const total = found.length;
    found = found.slice(-(opts.limit ?? 100));
    if (opts.clear) this.entries = [];
    if (!found.length) return "No console messages match.";
    const lines = found.map(
      (e) => `[${new Date(e.time).toISOString().slice(11, 23)}] ${e.level}: ${e.text}`,
    );
    if (total > found.length) lines.unshift(`(${total} match; showing the last ${found.length})`);
    return lines.join("\n");
  }
}
