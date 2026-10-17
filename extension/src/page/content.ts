// Entry for the isolated-world content script: answers the service worker's
// page operations. Also injected on demand into tabs that were open before
// the extension loaded.
import { ConsoleBuffer } from "./console";
import { find, formatFind } from "./find";
import { PageError, dropFiles, element, formInput, setFiles } from "./forms";
import { pageText } from "./text";
import { readPage } from "./walker";

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
  | { op: "viewport" };

export type PageReply = { ok: true; value: unknown } | { ok: false; code: string; message: string };

const marker = "__browserHandContent";
const g = globalThis as unknown as Record<string, unknown>;

if (!g[marker]) {
  g[marker] = true;
  const consoleBuffer = new ConsoleBuffer();
  consoleBuffer.listen(window);

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
    }
  };

  chrome.runtime.onMessage.addListener((msg: PageOp & { __bh?: true }, _sender, reply: (r: PageReply) => void) => {
    if (!msg?.__bh) return;
    try {
      reply({ ok: true, value: run(msg) });
    } catch (e) {
      const code = e instanceof PageError ? e.code : ((e as { code?: string }).code ?? "page_error");
      reply({ ok: false, code, message: e instanceof Error ? e.message : String(e) });
    }
  });
}
