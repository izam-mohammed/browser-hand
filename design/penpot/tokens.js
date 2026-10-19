// Design tokens for the browser-hand settings page, from design/theme.md.
const cat = penpot.library.local.tokens;
// Run tokens_clear.js first: a set removed in this same call still blocks
// addSet with "A set with the same name already exists".

const T = storage.T;
const colorKeys = ["bg", "surface", "raised", "border", "control", "text", "text2", "text3",
  "accent", "accentText", "onAccent", "success", "warning", "danger", "info"];

const errors = [];
const add = (set, type, name, value) => {
  try { set.addToken({ type, name, value: String(value) }); }
  catch (e) { errors.push(set.name + " " + name + ": " + e.message); }
};

const g = cat.addSet({ name: "global" });
add(g, "fontFamilies", "font.text", "Inter");
add(g, "fontFamilies", "font.mono", "JetBrains Mono");
for (const [k, v] of [["caption", 12], ["body", 14], ["heading", 16], ["title", 24]]) add(g, "fontSizes", "font.size." + k, v);
for (const [k, v] of [["regular", 400], ["medium", 500], ["semibold", 600]]) add(g, "fontWeights", "font.weight." + k, v);
for (const [k, v] of [["xs", 4], ["sm", 8], ["md", 12], ["lg", 16], ["xl", 24], ["xxl", 32], ["page", 48]]) add(g, "spacing", "space." + k, v);
for (const [k, v] of [["sm", 6], ["md", 8], ["lg", 12], ["pill", 999]]) add(g, "borderRadius", "radius." + k, v);
add(g, "borderWidth", "border.width.hairline", 1);
add(g, "borderWidth", "border.width.focus", 2);
add(g, "sizing", "size.control.height", 32);
add(g, "sizing", "size.toggle.width", 36);
add(g, "sizing", "size.toggle.height", 20);
add(g, "opacity", "opacity.tint", 0.14);

for (const mode of ["light", "dark"]) {
  const s = cat.addSet({ name: "mode/" + mode });
  for (const k of colorKeys) add(s, "color", "color." + k, T[mode + "/" + k].c);
}

return {
  sets: cat.sets.map(s => ({ name: s.name, active: s.active, n: s.tokens.length })),
  themes: cat.themes.map(t => ({ group: t.group, name: t.name, active: t.active, sets: t.activeSets.map(s => s.name) })),
  errors,
};
