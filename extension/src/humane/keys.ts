// Key definitions for CDP Input.dispatchKeyEvent on a US layout: what a key
// sends as `key`, `code`, `windowsVirtualKeyCode` and `text`.
import { ToolError } from "../wire";

export interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
  /** Text the key types, when it types any. */
  text?: string;
  /** Needs Shift held on a US layout. */
  shift?: boolean;
}

/** CDP modifier bits. */
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

const MODIFIER_KEYS: Record<keyof typeof MOD, KeyDef> = {
  alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
  ctrl: { key: "Control", code: "ControlLeft", keyCode: 17 },
  meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
};

const PUNCT: Record<string, [code: string, keyCode: number, shift: boolean]> = {
  " ": ["Space", 32, false],
  "`": ["Backquote", 192, false],
  "~": ["Backquote", 192, true],
  "-": ["Minus", 189, false],
  _: ["Minus", 189, true],
  "=": ["Equal", 187, false],
  "+": ["Equal", 187, true],
  "[": ["BracketLeft", 219, false],
  "{": ["BracketLeft", 219, true],
  "]": ["BracketRight", 221, false],
  "}": ["BracketRight", 221, true],
  "\\": ["Backslash", 220, false],
  "|": ["Backslash", 220, true],
  ";": ["Semicolon", 186, false],
  ":": ["Semicolon", 186, true],
  "'": ["Quote", 222, false],
  '"': ["Quote", 222, true],
  ",": ["Comma", 188, false],
  "<": ["Comma", 188, true],
  ".": ["Period", 190, false],
  ">": ["Period", 190, true],
  "/": ["Slash", 191, false],
  "?": ["Slash", 191, true],
  "!": ["Digit1", 49, true],
  "@": ["Digit2", 50, true],
  "#": ["Digit3", 51, true],
  $: ["Digit4", 52, true],
  "%": ["Digit5", 53, true],
  "^": ["Digit6", 54, true],
  "&": ["Digit7", 55, true],
  "*": ["Digit8", 56, true],
  "(": ["Digit9", 57, true],
  ")": ["Digit0", 48, true],
};

/** The key that types `ch`, or null when no US key does (use insertText). */
export function charKey(ch: string): KeyDef | null {
  if (ch === "\n" || ch === "\r") return named("Enter");
  if (ch === "\t") return named("Tab");
  if (/^[a-z]$/.test(ch))
    return {
      key: ch,
      code: `Key${ch.toUpperCase()}`,
      keyCode: ch.toUpperCase().charCodeAt(0),
      text: ch,
    };
  if (/^[A-Z]$/.test(ch))
    return { key: ch, code: `Key${ch}`, keyCode: ch.charCodeAt(0), text: ch, shift: true };
  if (/^[0-9]$/.test(ch))
    return { key: ch, code: `Digit${ch}`, keyCode: ch.charCodeAt(0), text: ch };
  const p = PUNCT[ch];
  if (p) return { key: ch, code: p[0], keyCode: p[1], text: ch, shift: p[2] };
  return null;
}

const NAMED: Record<string, KeyDef> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};
for (let i = 1; i <= 12; i++) NAMED[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };

const ALIASES: Record<string, string> = {
  return: "enter",
  esc: "escape",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  pgup: "pageup",
  pgdn: "pagedown",
  " ": "space",
};

export function named(name: string): KeyDef | null {
  const n = name.toLowerCase();
  return NAMED[ALIASES[n] ?? n] ?? null;
}

const MOD_NAMES: Record<string, keyof typeof MOD> = {
  cmd: "meta",
  command: "meta",
  meta: "meta",
  win: "meta",
  windows: "meta",
  super: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
};

export function modifierKey(m: keyof typeof MOD): KeyDef {
  return MODIFIER_KEYS[m];
}

export interface Combo {
  mods: (keyof typeof MOD)[];
  key: KeyDef;
}

/** "cmd+shift+z", "Enter", "a" into modifiers and the main key. */
export function parseCombo(s: string): Combo {
  const parts = s.split("+");
  // "cmd++" means cmd and the plus key.
  if (s.endsWith("++")) parts.splice(parts.length - 2, 2, "+");
  const main = parts.pop() ?? "";
  const mods: (keyof typeof MOD)[] = [];
  for (const m of parts) {
    const mod = MOD_NAMES[m.toLowerCase()];
    if (!mod) throw new ToolError("bad_args", `Unknown modifier "${m}" in "${s}"`);
    if (!mods.includes(mod)) mods.push(mod);
  }
  const key =
    named(main) ?? (main.length === 1 ? (charKey(main) ?? charKey(main.toLowerCase())) : null);
  if (!key) throw new ToolError("bad_args", `Unknown key "${main}" in "${s}"`);
  return { mods, key };
}

export function modifiersBits(mods: (keyof typeof MOD)[]): number {
  return mods.reduce((bits, m) => bits | MOD[m], 0);
}

/** Page zoom shortcuts are refused, as Claude in Chrome does; use zoom. */
export function isZoomShortcut(c: Combo): boolean {
  return (
    (c.mods.includes("meta") || c.mods.includes("ctrl")) && ["=", "+", "-", "0"].includes(c.key.key)
  );
}

/** macOS editing commands a Meta shortcut should run (CDP `commands`), since
 * a synthetic key event alone may not trigger them. */
export function macCommands(c: Combo): string[] {
  if (!c.mods.includes("meta")) return [];
  const k = c.key.key.toLowerCase();
  const shift = c.mods.includes("shift");
  if (k === "a") return ["selectAll"];
  if (k === "c") return ["copy"];
  if (k === "x") return ["cut"];
  if (k === "v") return ["paste"];
  if (k === "z") return [shift ? "redo" : "undo"];
  return [];
}
