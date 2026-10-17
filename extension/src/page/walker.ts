// The page as a tree of roles and names, with refs that later tools (click,
// form_input, scroll_to) resolve back to elements. Runs in the content
// script's isolated world; refs stay stable for the life of the page.

export interface WalkOptions {
  filter?: "interactive" | "all";
  depth?: number;
  ref_id?: string;
  max_chars?: number;
}

export const DEFAULT_DEPTH = 15;
export const DEFAULT_MAX_CHARS = 50_000;

const refToEl = new Map<string, WeakRef<Element>>();
const elToRef = new WeakMap<Element, string>();
let nextRef = 1;

export function refFor(el: Element): string {
  let ref = elToRef.get(el);
  if (!ref) {
    ref = `ref_${nextRef++}`;
    elToRef.set(el, ref);
    refToEl.set(ref, new WeakRef(el));
  }
  return ref;
}

/** The element behind a ref, or null when it is gone from the page. */
export function resolveRef(ref: string): Element | null {
  const el = refToEl.get(ref)?.deref();
  if (!el || !el.isConnected) return null;
  return el;
}

/** For tests: forget every ref. */
export function resetRefs() {
  refToEl.clear();
  nextRef = 1;
}

const INPUT_ROLES: Record<string, string> = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  search: "searchbox",
  file: "button",
  color: "button",
};

const TAG_ROLES: Record<string, string> = {
  button: "button",
  select: "combobox",
  textarea: "textbox",
  img: "img",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  form: "form",
  ul: "list",
  ol: "list",
  li: "listitem",
  table: "table",
  tr: "row",
  td: "cell",
  th: "columnheader",
  dialog: "dialog",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  option: "option",
  summary: "button",
  iframe: "iframe",
  video: "video",
  audio: "audio",
  label: "label",
  p: "paragraph",
};

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "slider",
  "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "spinbutton",
  "listbox", "treeitem",
]);

const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head", "meta", "link"]);

export function roleOf(el: Element): string | null {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.split(/\s+/)[0]!;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return el.hasAttribute("href") ? "link" : null;
  if (tag === "input") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    if (type === "hidden") return null;
    return INPUT_ROLES[type] ?? "textbox";
  }
  if (tag === "select" && ((el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1)) {
    return "listbox";
  }
  if ((el as HTMLElement).isContentEditable && el.getAttribute("contenteditable") !== null) return "textbox";
  return TAG_ROLES[tag] ?? null;
}

function clean(text: string | null | undefined, max = 100): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function textOf(el: Element): string {
  return clean((el as HTMLElement).innerText ?? el.textContent);
}

/** Accessible name from the common labelling sources (a subset of accname). */
export function nameOf(el: Element): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean) as Element[];
    const name = clean(parts.map(textOf).join(" "));
    if (name) return name;
  }
  const aria = clean(el.getAttribute("aria-label"));
  if (aria) return aria;

  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const name = clean([...labels].map(textOf).join(" "));
      if (name) return name;
    }
    const type = (el as HTMLInputElement).type;
    if (tag === "input" && (type === "submit" || type === "button" || type === "reset")) {
      return clean((el as HTMLInputElement).value) || clean(el.getAttribute("title"));
    }
    return clean(el.getAttribute("placeholder")) || clean(el.getAttribute("title")) || clean(el.getAttribute("name"));
  }
  if (tag === "img" || (tag === "input" && (el as HTMLInputElement).type === "image")) {
    return clean(el.getAttribute("alt")) || clean(el.getAttribute("title"));
  }
  const title = clean(el.getAttribute("title"));
  const text = textOf(el);
  return text || title;
}

function isHidden(el: Element): boolean {
  if (el.getAttribute("aria-hidden") === "true") return true;
  if ((el as HTMLElement).hidden) return true;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}

function details(el: Element, role: string): string {
  const out: string[] = [];
  const tag = el.tagName.toLowerCase();
  if (role === "heading") out.push(`level=${tag.length === 2 ? tag[1] : el.getAttribute("aria-level") ?? "?"}`);
  if (role === "link") {
    const href = el.getAttribute("href") ?? "";
    out.push(`href="${clean(href, 80)}"`);
  }
  if (tag === "input" || tag === "textarea") {
    const input = el as HTMLInputElement;
    if (input.type === "checkbox" || input.type === "radio") out.push(input.checked ? "checked" : "unchecked");
    else if (input.type !== "password" && input.value) out.push(`value="${clean(input.value, 60)}"`);
    if (input.type && input.type !== "text" && tag === "input") out.push(`type=${input.type}`);
  }
  if (tag === "select") {
    const sel = el as HTMLSelectElement;
    const chosen = sel.selectedOptions?.[0];
    if (chosen) out.push(`value="${clean(chosen.textContent, 60)}"`);
  }
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") out.push("disabled");
  const expanded = el.getAttribute("aria-expanded");
  if (expanded) out.push(`expanded=${expanded}`);
  return out.length ? ` ${out.join(" ")}` : "";
}

function children(el: Element): Element[] {
  const kids = [...el.children];
  const shadow = (el as HTMLElement).shadowRoot;
  if (shadow) kids.push(...shadow.children);
  return kids;
}

/** One line per meaningful element, indented by tree depth. */
export function walk(root: Element, opts: WalkOptions = {}): string[] {
  const filter = opts.filter ?? "all";
  const maxDepth = opts.depth ?? DEFAULT_DEPTH;
  const lines: string[] = [];

  const visit = (el: Element, depth: number, level: number) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag) || depth > maxDepth) return;
    const role = roleOf(el);
    const interactive = role !== null && INTERACTIVE_ROLES.has(role);
    if (filter === "interactive" && isHidden(el)) return;

    let shown = false;
    if (role && (filter === "all" || interactive)) {
      const name = nameOf(el);
      // Containers named only by their children's text add noise.
      const showName = interactive || ["heading", "img", "label", "option", "cell", "columnheader", "paragraph"].includes(role);
      const label = showName && name ? ` "${name}"` : "";
      lines.push(`${"  ".repeat(level)}- ${role}${label} [${refFor(el)}]${details(el, role)}`);
      shown = true;
    } else if (filter === "all" && !role) {
      // Loose text directly inside a generic element.
      const own = clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
      if (own) lines.push(`${"  ".repeat(level)}- text "${own}"`);
    }
    if (interactive && role !== "listbox" && role !== "combobox") return; // names already carry the text
    for (const child of children(el)) visit(child, depth + 1, shown ? level + 1 : level);
  };

  visit(root, 0, 0);
  return lines;
}

/** `read_page` output: the tree, truncated at a line boundary when long. */
export function readPage(doc: Document, opts: WalkOptions = {}): string {
  let root: Element | null = doc.body ?? doc.documentElement;
  if (opts.ref_id) {
    root = resolveRef(opts.ref_id);
    if (!root) throw Object.assign(new Error(`${opts.ref_id} is not on the page any more. Call read_page again.`), { code: "bad_args" });
  }
  if (!root) return "(empty page)";
  const lines = walk(root, opts);
  const header = `Page: ${clean(doc.title, 120)} (${doc.location?.href ?? ""})`;
  const full = [header, ...lines].join("\n");
  const max = opts.max_chars ?? DEFAULT_MAX_CHARS;
  if (full.length <= max) return full;
  const cut = full.lastIndexOf("\n", max);
  const kept = full.slice(0, cut > 0 ? cut : max);
  return `${kept}\n[truncated: ${full.length} characters in full; pass a larger max_chars, a smaller depth, or ref_id to focus]`;
}

export function isInteractiveRole(role: string | null): boolean {
  return role !== null && INTERACTIVE_ROLES.has(role);
}

export function allElements(root: Element): Element[] {
  const out: Element[] = [];
  const visit = (el: Element) => {
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) return;
    out.push(el);
    for (const c of children(el)) visit(c);
  };
  visit(root);
  return out;
}
