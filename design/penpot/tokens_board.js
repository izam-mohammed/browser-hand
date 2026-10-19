// tokens--sheet: every browser-hand design token on one board, on the Tokens page.
// Light and dark chips are literal; the "active" chip is bound to the token,
// so it changes when the mode theme is switched.
const pd = storage.pd, T = storage.T;
const MONO = "JetBrains Mono";
const cat = penpot.library.local.tokens;
const tok = (set, name) => cat.sets.find(s => s.name === set).tokens.find(t => t.name === name);

// New shapes land on the current page, and openPage takes effect only after
// this call returns: when Tokens is not current, open it and stop; run again.
const pages = penpot.currentFile.pages;
let page = pages.find(p => p.name === "Tokens");
if (!page) { page = penpot.createPage(); page.name = "Tokens"; }
if (penpot.currentPage.id !== page.id) { penpot.openPage(page); return "opened Tokens; run again to draw"; }
for (const s of [...page.root.children]) if (s.name === "tokens--sheet") s.remove();

const L = k => T["light/" + k];
const W = 1440, H = 948, PAD = 48;
const board = pd.box(null, 0, 0, W, H, { fill: L("bg"), name: "tokens--sheet" });
pd.text(board, PAD, 40, "browser-hand design tokens", { size: 24, weight: 600, color: L("text"), name: "title" });
pd.text(board, PAD, 76, "Sets: global, mode/light, mode/dark. Themes: mode / light, mode / dark. Source: design/theme.md",
  { size: 14, color: L("text2"), name: "subtitle" });

// ---- Colour table -------------------------------------------------------
const colours = [
  ["bg", "page background", "", ""], ["surface", "cards, panels", "", ""],
  ["raised", "hover, section header, input fill", "", ""], ["border", "dividers, card edges", "", ""],
  ["control", "input, toggle, checkbox edges", "3.48", "3.51"], ["text", "primary text", "17.07", "15.01"],
  ["text2", "secondary text, help, placeholders", "7.29", "7.42"], ["text3", "disabled text only", "3.48", "3.51"],
  ["accent", "primary button, toggle on, focus ring", "3.19", "8.27"], ["accentText", "links, accent text", "5.02", "10.63"],
  ["onAccent", "text on accent fills", "5.36", "7.95"], ["success", "saved, connected", "5.02", "10.19"],
  ["warning", "needs attention", "4.92", "11.59"], ["danger", "blocked sites, errors", "4.83", "6.42"],
  ["info", "notes", "5.17", "6.98"],
];
const CX = PAD, CY = 128, CW = 836, RH = 40;
const ct = pd.box(board, CX, CY, CW, 56 + 32 + colours.length * RH + 16, { fill: L("surface"), stroke: L("border"), radius: 12, name: "colour tokens" });
pd.text(ct, 24, 20, "Colour", { size: 16, weight: 600, color: L("text"), name: "heading" });
const cols = [["token", 24], ["light", 190], ["dark", 310], ["active", 430], ["use", 496]];
for (const [h, x] of cols) pd.text(ct, x, 60, h, { size: 12, weight: 600, color: L("text2"), caps: true, tracking: 0.6, name: h + " header" });
pd.text(ct, 716, 60, "L / D", { size: 12, weight: 600, color: L("text2"), caps: true, tracking: 0.6, name: "contrast header" });
colours.forEach(([k, use, cl, cd], i) => {
  const y = 88 + i * RH;
  pd.rule(ct, 24, y, CW - 48, { color: L("border"), name: "row rule" });
  pd.text(ct, 24, y + 12, "color." + k, { font: MONO, size: 12, weight: 500, color: L("text"), name: "name" });
  for (const [mode, x] of [["light", 190], ["dark", 310]]) {
    pd.rect(ct, x, y + 8, 24, 24, { fill: T[mode + "/" + k], stroke: L("control"), radius: 6, name: mode + " chip" });
    pd.text(ct, x + 32, y + 12, T[mode + "/" + k].c, { font: MONO, size: 12, color: L("text2"), name: mode + " hex" });
  }
  const live = pd.rect(ct, 430, y + 8, 24, 24, { fill: L(k), stroke: L("control"), radius: 6, name: "active chip" });
  live.applyToken(tok("mode/light", "color." + k), ["fill"]);
  pd.text(ct, 496, y + 12, use, { size: 12, color: L("text2"), name: "use" });
  if (cl) pd.text(ct, 716, y + 12, cl + " / " + cd, { font: MONO, size: 12, color: L("text2"), name: "contrast" });
});

// ---- Global tokens, right column ---------------------------------------
const RX = CX + CW + 32, RW = W - PAD - RX;   // 476
const section = (y, h, title) => {
  const s = pd.box(board, RX, y, RW, h, { fill: L("surface"), stroke: L("border"), radius: 12, name: title.toLowerCase() + " tokens" });
  pd.text(s, 24, 20, title, { size: 16, weight: 600, color: L("text"), name: "heading" });
  return s;
};
const label = (s, x, y, chars) => pd.text(s, x, y, chars, { font: MONO, size: 12, color: L("text2"), name: chars });

// Type
const ty = section(CY, 268, "Type");
label(ty, 24, 60, "font.text  Inter");
label(ty, 240, 60, "font.mono  JetBrains Mono");
[["title", 24], ["heading", 16], ["body", 14], ["caption", 12]].forEach(([k, sz], i) => {
  const y = 92 + i * 36;
  label(ty, 24, y + 4, "font.size." + k + "  " + sz);
  pd.text(ty, 240, y + (24 - sz) / 2, "Blocked sites", { size: sz, weight: sz >= 16 ? 600 : 400, color: L("text"), name: "sample " + sz });
});
[["regular", 400], ["medium", 500], ["semibold", 600]].forEach(([k, w], i) => {
  pd.text(ty, 24 + i * 148, 236, k + " " + w, { size: 14, weight: w, color: L("text"), name: "weight " + w });
});

// Spacing
const sp = section(CY + 268 + 24, 220, "Spacing");
[["xs", 4], ["sm", 8], ["md", 12], ["lg", 16], ["xl", 24], ["xxl", 32], ["page", 48]].forEach(([k, v], i) => {
  const y = 56 + i * 22;
  label(sp, 24, y, "space." + k);
  pd.rect(sp, 160, y + 3, v * 4, 10, { fill: L("accent"), radius: 2, name: "bar " + v });
  label(sp, 160 + v * 4 + 8, y, String(v));
});

// Radius, border, sizing, opacity
const sh = section(CY + 268 + 24 + 220 + 24, 236, "Shape");
[["sm", 6], ["md", 8], ["lg", 12], ["pill", 999]].forEach(([k, v], i) => {
  const x = 24 + i * 108;
  pd.rect(sh, x, 56, k === "pill" ? 64 : 40, 40, { fill: L("raised"), stroke: L("control"), radius: Math.min(v, 20), name: "radius " + k });
  label(sh, x, 104, "radius." + k);
});
pd.rect(sh, 24, 140, 40, 28, { fill: L("surface"), stroke: L("control"), strokeWidth: 1, radius: 6, name: "hairline" });
label(sh, 72, 146, "border.width.hairline 1");
pd.rect(sh, 260, 140, 40, 28, { fill: L("surface"), stroke: L("accent"), strokeWidth: 2, radius: 6, name: "focus" });
label(sh, 308, 146, "focus 2");
pd.rect(sh, 24, 188, 88, 32, { fill: L("raised"), stroke: L("control"), radius: 6, name: "control height" });
label(sh, 120, 196, "size.control.height 32");
const tg = pd.box(sh, 290, 194, 36, 20, { fill: L("accent"), radius: 10, name: "toggle" });
pd.ellipse(tg, 18, 2, 16, 16, { fill: L("onAccent") });
const tint = pd.rect(sh, 338, 190, 28, 28, { fill: L("danger"), opacity: 0.14, radius: 6, name: "tint" });
label(sh, 374, 196, "opacity.tint");

await pd.reflow(board);
return { page: page.name, board: board.name, h: board.height, outside: pd.audit(board).outside };
