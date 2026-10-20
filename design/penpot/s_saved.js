// settings--saved
if (penpot.currentPage.name !== "Settings") return "not on Settings";
const b = storage.bh.screen('settings--saved', 4440, 'dark', { saved: true }, 'After Save. The host wrote config.toml; the toast closes after 4 seconds.');
await storage.pd.reflow(b);
return { h: b.height, outside: storage.pd.audit(b).outside };
