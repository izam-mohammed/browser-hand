// Entry for the isolated-world content script: answers the service worker's
// page operations, and captures the person's steps while their window
// records. Runs in every frame; page operations go to the top frame only.
// Also injected on demand into tabs that were open before the extension
// loaded.
import { ConsoleBuffer } from "./console";
import { Cursor, pageEnv } from "./cursor";
import { find, formatFind } from "./find";
import { PageError, dropFiles, element, formInput, setFiles } from "./forms";
import { Capture, Outbox, fieldKind, resolveSelectors, type Selector, type StepMsg } from "./record";
import { pageText } from "./text";
import { readPage, refFor } from "./walker";

export type PageOp =
  | { op: "read_page"; filter?: "interactive" | "all"; depth?: number; ref_id?: string; max_chars?: number }
  | { op: "find"; query: string }
  | { op: "text" }
  | { op: "console"; pattern?: string; onlyErrors?: boolean; limit?: number; clear?: boolean }
  | { op: "form_input"; ref: string; value: string | number | boolean }
  | { op: "set_files"; ref: string; files: { name: string; mimeType: string; data: string }[] }
  | { op: "drop_files"; x: number; y: number; files: { name: string; mimeType: string; data: string }[] }
  | { op: "rect"; ref: string }
  | { op: "scroll_into_view"; ref: string }
  | { op: "viewport" }
  | { op: "cursor_move"; path: { x: number; y: number }[]; intervalMs: number }
  | { op: "cursor_hide" }
  | { op: "cursor_show" }
  | { op: "record_start" }
  | { op: "record_stop" }
  | { op: "resolve"; selectors: Selector[] }
  | { op: "scroll_xy"; ref?: string; x: number; y: number };

/** Messages the content script sends the service worker about recording. */
export type RecMsg = { __bhRec: "hello" } | ({ __bhRec: "step" } & StepMsg);

export type PageReply = { ok: true; value: unknown } | { ok: false; code: string; message: string };

const marker = "__browserHandContent";
const g = globalThis as unknown as Record<string, unknown>;

if (!g[marker]) {
  g[marker] = true;
  const consoleBuffer = new ConsoleBuffer();
  consoleBuffer.listen(window);
  const cursor = new Cursor(document, pageEnv(window));

  // Steps wait in the outbox until the service worker takes them; it
  // answers `on: false` once this window stops recording.
  const outbox = new Outbox(async (msg) => {
    const r = (await chrome.runtime.sendMessage({ __bhRec: "step", ...msg } satisfies RecMsg)) as { on?: boolean } | undefined;
    if (r && r.on === false) capture.stop();
  });
  const capture = new Capture(window, (msg) => outbox.push(msg));
  chrome.runtime
    .sendMessage({ __bhRec: "hello" } satisfies RecMsg)
    .then((r: { on?: boolean } | undefined) => {
      if (r?.on) capture.start();
    })
    .catch(() => {});

  const run = (msg: PageOp): unknown => {
    switch (msg.op) {
      case "read_page":
        return readPage(document, msg);
      case "find":
        return formatFind(msg.query, find(document.body ?? document.documentElement, msg.query));
      case "text":
        return pageText(document);
      case "console":
        return consoleBuffer.read(msg);
      case "form_input":
        return formInput(msg.ref, msg.value);
      case "set_files":
        return setFiles(msg.ref, msg.files);
      case "drop_files":
        return dropFiles(msg.x, msg.y, msg.files);
      case "rect": {
        const r = element(msg.ref).getBoundingClientRect();
        return {
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          width: r.width,
          height: r.height,
          inViewport: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
        };
      }
      case "scroll_into_view":
        element(msg.ref).scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        return true;
      case "viewport":
        return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX, scrollY };
      case "cursor_move":
        cursor.move(msg.path, msg.intervalMs);
        return true;
      case "cursor_hide":
        cursor.hide();
        return true;
      case "cursor_show":
        cursor.show();
        return true;
      case "record_start":
        capture.start();
        return true;
      case "record_stop":
        capture.stop();
        return true;
      case "resolve": {
        const { el, tried } = resolveSelectors(document, msg.selectors);
        if (!el) throw new PageError("page_error", `No element matches. Tried: ${tried.join("; ")}`);
        return { ref: refFor(el), kind: fieldKind(el), tried };
      }
      case "scroll_xy":
        if (msg.ref) element(msg.ref).scrollTo({ left: msg.x, top: msg.y, behavior: "instant" });
        else scrollTo({ left: msg.x, top: msg.y, behavior: "instant" });
        return true;
    }
  };

  chrome.runtime.onMessage.addListener((msg: PageOp & { __bh?: true }, _sender, reply: (r: PageReply) => void) => {
    if (!msg?.__bh) return;
    // Recording reaches every frame; everything else is the top frame's.
    if (msg.op !== "record_start" && msg.op !== "record_stop" && window !== window.top) return;
    try {
      reply({ ok: true, value: run(msg) });
    } catch (e) {
      const code = e instanceof PageError ? e.code : ((e as { code?: string }).code ?? "page_error");
      reply({ ok: false, code, message: e instanceof Error ? e.message : String(e) });
    }
  });
}
