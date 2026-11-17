// `form_input` (the fast path: values set directly, with the events a page
// listens for) and file setting for `file_upload` and `upload_image`.
import { resolveRef } from "./walker";

export class PageError extends Error {
  constructor(
    readonly code: "bad_args" | "page_error",
    message: string,
  ) {
    super(message);
  }
}

export function element(ref: string): Element {
  const el = resolveRef(ref);
  if (!el)
    throw new PageError(
      "bad_args",
      `${ref} is not on the page any more. Call read_page or find again.`,
    );
  return el;
}

function fire(el: Element, ...types: string[]) {
  for (const type of types) el.dispatchEvent(new Event(type, { bubbles: true }));
}

/** Sets `value` through the prototype setter, so frameworks that track
 * the value property (React) see the change. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

export function formInput(ref: string, value: string | number | boolean): string {
  const el = element(ref);
  const tag = el.tagName.toLowerCase();

  if (tag === "select") {
    const sel = el as HTMLSelectElement;
    const wanted = String(value);
    const option =
      [...sel.options].find((o) => o.value === wanted) ??
      [...sel.options].find((o) => o.text.trim().toLowerCase() === wanted.trim().toLowerCase());
    if (!option) {
      const choices = [...sel.options].map((o) => `"${o.text.trim()}"`).join(", ");
      throw new PageError("bad_args", `No option "${wanted}" in ${ref}. Options: ${choices}`);
    }
    sel.value = option.value;
    fire(sel, "input", "change");
    return `Selected "${option.text.trim()}" in ${ref}`;
  }

  if (tag === "input" && ["checkbox", "radio"].includes((el as HTMLInputElement).type)) {
    const input = el as HTMLInputElement;
    const want = typeof value === "boolean" ? value : value === "true" || value === 1;
    if (input.checked !== want) {
      input.checked = want;
      fire(input, "input", "change");
    }
    return `${ref} is now ${want ? "checked" : "unchecked"}`;
  }

  if (tag === "input" || tag === "textarea") {
    const input = el as HTMLInputElement;
    if (input.type === "file")
      throw new PageError("bad_args", `${ref} is a file input; use file_upload`);
    input.focus();
    setNativeValue(input, String(value));
    fire(input, "input", "change");
    return `Set ${ref} to "${input.type === "password" ? "••••" : String(value)}"`;
  }

  if ((el as HTMLElement).isContentEditable) {
    (el as HTMLElement).focus();
    el.textContent = String(value);
    fire(el, "input");
    return `Set the text of ${ref}`;
  }

  throw new PageError("bad_args", `${ref} is a <${tag}>, not a form field`);
}

export interface FilePayload {
  name: string;
  mimeType: string;
  /** base64 bytes */
  data: string;
}

function toFiles(files: FilePayload[]): DataTransfer {
  const dt = new DataTransfer();
  for (const f of files) {
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], f.name, { type: f.mimeType }));
  }
  return dt;
}

/** Puts files into a file input, as choosing them in the picker would. */
export function setFiles(ref: string, files: FilePayload[]): string {
  const el = element(ref);
  if (!(el instanceof HTMLInputElement) || el.type !== "file") {
    throw new PageError(
      "bad_args",
      `${ref} is not a file input. Use find("file input") to locate it.`,
    );
  }
  el.files = toFiles(files).files;
  fire(el, "input", "change");
  return `Set ${files.length} file(s) on ${ref}: ${files.map((f) => f.name).join(", ")}`;
}

/** Drops files on whatever is at (x, y), as a drag from the desktop would. */
export function dropFiles(x: number, y: number, files: FilePayload[]): string {
  const target = document.elementFromPoint(x, y);
  if (!target) throw new PageError("bad_args", `Nothing at (${x}, ${y}) to drop on`);
  const dt = toFiles(files);
  for (const type of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        dataTransfer: dt,
      }),
    );
  }
  return `Dropped ${files.length} file(s) on <${target.tagName.toLowerCase()}> at (${x}, ${y})`;
}
