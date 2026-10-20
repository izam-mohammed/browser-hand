// Themes for the browser-hand tokens: group "mode", light and dark.
// Run after tokens.js. To redo, run tokens_clear.js, tokens.js, then this.
const cat = penpot.library.local.tokens;
for (const mode of ["light", "dark"]) {
  const th = cat.addTheme({ group: "mode", name: mode });
  // addSet wants the set (or its id); a name is rejected as "should be an uuid".
  th.addSet(cat.sets.find(s => s.name === "global"));
  th.addSet(cat.sets.find(s => s.name === "mode/" + mode));
}
const light = cat.themes.find(t => t.group === "mode" && t.name === "light");
if (light && !light.active) light.toggleActive();

return cat.themes.map(t => ({ group: t.group, name: t.name, active: t.active, sets: t.activeSets.map(s => s.name) }));
