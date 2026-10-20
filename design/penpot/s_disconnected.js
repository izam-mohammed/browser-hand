// settings--disconnected
if (penpot.currentPage.name !== "Settings") return "not on Settings";
const b = storage.bh.screen('settings--disconnected', 5920, 'light', { disconnected: true }, 'The native host is not running. Values are the last ones the extension saw; nothing can be changed until it connects.');
await storage.pd.reflow(b);
return { h: b.height, outside: storage.pd.audit(b).outside };
