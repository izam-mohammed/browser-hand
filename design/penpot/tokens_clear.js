// Removes the browser-hand token sets and themes, so tokens.js can run again.
const cat = penpot.library.local.tokens;
const OURS = ["global", "mode/light", "mode/dark"];
for (const t of [...cat.themes]) if (t.group === "mode") t.remove();
for (const s of [...cat.sets]) if (OURS.includes(s.name)) s.remove();
return "cleared";
