// storage.bh: furniture for the browser-hand settings screens.
// Every helper takes the parent it draws on. storage.bh.screen(name, x, mode, state)
// draws one whole board on the current page.
const pd = storage.pd, T = storage.T;
const MONO = "JetBrains Mono";

// Colours of the browser around the page, not app tokens.
T["Board/frame/light"] = { c: "#DEE1E6", o: 1 };
T["Board/frame/dark"] = { c: "#202124", o: 1 };
T["Board/tab/light"] = { c: "#FFFFFF", o: 1 };
T["Board/tab/dark"] = { c: "#35363A", o: 1 };
T["Board/ground"] = { c: "#E9E9E6", o: 1 };
T["Board/caption"] = { c: "#57574F", o: 1 };

const CHEV = '<path d="M6 9l6 6 6-6"/>';
const CROSS = '<path d="M6 6l12 12M18 6L6 18"/>';
const DOT = 8;

const bh = {
  m: mode => k => T[mode + "/" + k],

  window(board, mode, x, y, w, h, url) {
    const m = bh.m(mode);
    const win = pd.box(board, x, y, w, h, { fill: m("bg"), stroke: m("border"), radius: 10, clip: true, name: "Chrome window" });
    pd.rect(win, 0, 0, w, 84, { fill: T["Board/frame/" + mode], name: "frame" });
    ["#FF5F57", "#FEBC2E", "#28C840"].forEach((c, i) => pd.ellipse(win, 16 + i * 20, 15, 12, 12, { fill: c, name: "light " + i }));
    const tab = pd.box(win, 88, 8, 240, 34, { fill: T["Board/tab/" + mode], radius: 8, name: "tab" });
    pd.text(tab, 14, 9, "browser-hand settings", { size: 12, weight: 500, color: m("text"), name: "tab title" });
    pd.rect(win, 0, 42, w, 42, { fill: T["Board/tab/" + mode], name: "toolbar" });
    const bar = pd.box(win, 88, 48, w - 176, 30, { fill: T["Board/frame/" + mode], radius: 15, name: "address bar" });
    pd.text(bar, 16, 7, url, { size: 12, color: m("text2"), name: "url" });
    pd.rule(win, 0, 84, w, { color: m("border"), name: "toolbar edge" });
    return win;
  },

  section(parent, mode, x, y, w, h, title, desc) {
    const m = bh.m(mode);
    const s = pd.box(parent, x, y, w, h, { fill: m("surface"), stroke: m("border"), radius: 12, name: title + " section" });
    pd.text(s, 24, 20, title, { size: 16, weight: 600, color: m("text"), name: "heading" });
    if (desc) pd.text(s, 24, 44, desc, { size: 12, color: m("text2"), width: w - 48, name: "description" });
    return s;
  },

  // A setting row: label and help on the left, divider above. Returns the right edge x.
  row(sec, mode, y, label, help, first) {
    const m = bh.m(mode);
    if (!first) pd.rule(sec, 24, y, sec.width - 48, { color: m("border"), name: "divider" });
    pd.text(sec, 24, y + 14, label, { size: 14, weight: 500, color: m("text"), name: label + " label" });
    if (help) pd.text(sec, 24, y + 36, help, { size: 12, color: m("text2"), width: 440, name: label + " help" });
    return sec.width - 24;
  },

  toggle(parent, mode, x, y, on, name) {
    const m = bh.m(mode);
    const t = pd.box(parent, x, y, 36, 20, { fill: on ? m("accent") : m("raised"), stroke: on ? null : m("control"), radius: 10, name: name || (on ? "toggle on" : "toggle off") });
    pd.ellipse(t, on ? 18 : 2, 2, 16, 16, { fill: on ? m("onAccent") : m("control"), name: "knob" });
    return t;
  },

  segmented(parent, mode, x, y, options, sel, name) {
    const m = bh.m(mode), sw = 72;
    const g = pd.box(parent, x, y, sw * options.length + 4, 32, { fill: m("raised"), stroke: m("control"), radius: 8, name: name || "segmented" });
    options.forEach((o, i) => {
      const on = i === sel;
      const seg = pd.box(g, 2 + i * sw, 2, sw, 28, { fill: on ? m("accent") : null, radius: 6, name: o + (on ? " selected" : "") });
      pd.text(seg, 0, 6, o, { size: 13, weight: on ? 600 : 500, color: on ? m("onAccent") : m("text"), width: sw, align: "center", name: "label" });
    });
    return g;
  },

  slider(parent, mode, x, y, frac, value, name) {
    const m = bh.m(mode), tw = 160;
    const g = pd.box(parent, x, y, tw + 64, 20, { fill: null, name: name || "slider" });
    pd.rect(g, 0, 8, tw, 4, { fill: m("raised"), stroke: m("control"), strokeWidth: 1, radius: 2, name: "track" });
    pd.rect(g, 0, 8, tw * frac, 4, { fill: m("accent"), radius: 2, name: "fill" });
    pd.ellipse(g, tw * frac - 8, 2, 16, 16, { fill: m("surface"), stroke: m("control"), name: "thumb" });
    pd.text(g, tw + 16, 2, value, { font: MONO, size: 12, color: m("text"), name: "value" });
    return g;
  },

  field(parent, mode, x, y, w, value, o = {}) {
    const m = bh.m(mode);
    const f = pd.box(parent, x, y, w, 32, { fill: m("raised"), stroke: o.error ? m("danger") : o.focus ? m("accent") : m("control"),
      strokeWidth: o.focus || o.error ? 2 : 1, radius: 6, name: o.name || "field" });
    pd.text(f, 10, 8, value, { font: o.mono ? MONO : undefined, size: o.mono ? 12 : 14, color: o.placeholder ? m("text2") : m("text"),
      name: o.placeholder ? "placeholder" : "value" }).y = f.y + (o.mono ? 9 : 7);
    if (o.unit) pd.text(f, w - 10 - o.unit.length * 7, 9, o.unit, { size: 12, color: m("text2"), name: "unit" });
    if (o.select) pd.glyph(f, w - 26, 8, 16, CHEV, { color: m("text2"), name: "chevron" });
    return f;
  },

  button(parent, mode, x, y, label, kind, name) {
    const m = bh.m(mode), w = label.length * 8 + 32;
    const primary = kind === "primary";
    const b = pd.box(parent, x, y, w, 32, { fill: primary ? m("accent") : m("surface"), stroke: primary ? null : m("control"), radius: 6, name: name || label + " button" });
    pd.text(b, 0, 7, label, { size: 14, weight: primary ? 600 : 500, color: primary ? m("onAccent") : m("text"), width: w, align: "center", name: "label" });
    return b;
  },

  pill(parent, mode, x, y, kind, label) {
    const m = bh.m(mode), w = label.length * 7 + 30;
    const p = pd.box(parent, x, y, w, 24, { fill: null, radius: 12, name: label + " pill" });
    p.fills = [{ fillColor: m(kind).c, fillOpacity: 0.14 }];
    pd.ellipse(p, 10, 9, 6, 6, { fill: m(kind), name: "dot" });
    pd.text(p, 22, 4, label, { size: 12, weight: 500, color: m(kind), name: "label" });
    return p;
  },

  // A list of URL patterns with remove buttons, then an add field. Returns its height.
  patterns(sec, mode, x, y, w, items, o = {}) {
    const m = bh.m(mode);
    const list = pd.box(sec, x, y, w, Math.max(1, items.length) * 36, { fill: m("surface"), stroke: m("border"), radius: 8, clip: true, name: o.name || "patterns" });
    if (!items.length) pd.text(list, 12, 10, "No patterns yet", { size: 12, color: m("text2"), name: "empty" });
    items.forEach((p, i) => {
      if (i) pd.rule(list, 0, i * 36, w, { color: m("border"), name: "divider" });
      pd.text(list, 12, i * 36 + 11, p, { font: MONO, size: 12, color: m("text"), name: "pattern" });
      pd.glyph(list, w - 28, i * 36 + 10, 16, CROSS, { color: m("text2"), name: "remove " + p });
    });
    let yy = y + list.height + 8;
    bh.field(sec, mode, x, yy, w - 68, o.draft || "example.com/*", { mono: true, placeholder: !o.draft, focus: o.focus, error: o.error, name: "add pattern" });
    bh.button(sec, mode, x + w - 56, yy, "Add", "secondary", "Add button");
    yy += 40;
    if (o.error) { pd.text(sec, x, yy, o.error, { size: 12, color: m("danger"), name: "error" }); yy += 20; }
    return yy - y;
  },

  // The whole settings page inside a window. state: {disconnected, editing, saved}
  page(win, mode, state = {}) {
    const m = bh.m(mode);
    const W = 720, X = (win.width - W) / 2;
    const content = pd.box(win, X, 116, W, 10, { fill: null, name: "content" });
    let y = 0;

    pd.text(content, 0, y, "browser-hand", { size: 24, weight: 600, color: m("text"), name: "page title" });
    if (state.disconnected) bh.pill(content, mode, W - 140, y + 4, "warning", "Not connected");
    else bh.pill(content, mode, W - 108, y + 4, "success", "Connected");
    pd.text(content, 0, y + 38, "Settings apply to every Chrome profile and are saved to", { size: 14, color: m("text2"), name: "intro" });
    pd.text(content, 0, y + 60, "~/.config/browser-hand/config.toml", { font: MONO, size: 12, color: m("text2"), name: "config path" });
    y += 100;

    if (state.disconnected) {
      const b = pd.box(content, 0, y, W, 72, { fill: null, stroke: m("warning"), radius: 10, name: "host banner" });
      b.fills = [{ fillColor: m("warning").c, fillOpacity: 0.1 }];
      pd.text(b, 16, 14, "The browser-hand host is not running", { size: 14, weight: 600, color: m("text"), name: "banner title" });
      pd.text(b, 16, 38, "Settings are read-only until it connects. Start a Claude session with the browser-hand plugin, then reload this page.",
        { size: 12, color: m("text2"), width: W - 160, name: "banner body" });
      bh.button(b, mode, W - 100, 20, "Retry", "secondary", "Retry button");
      y += 96;
    }
    const body = pd.box(content, 0, y, W, 10, { fill: null, name: "sections" });
    if (state.disconnected) body.opacity = 0.5;
    let sy = 0;
    const gap = 24, rw = W;

    // Input
    let s = bh.section(body, mode, 0, sy, rw, 72 + 3 * 72 + 8, "Input", "How the cursor and keyboard move. Human pace is slower and harder for sites to tell apart from you.");
    let r = bh.row(s, mode, 72, "Pace", "Fast keeps the same events without travel time.", true);
    bh.segmented(s, mode, r - 148, 72 + 16, ["Human", "Fast"], 0, "pace");
    r = bh.row(s, mode, 72 + 72, "Typing speed", "Multiplies the gap between keys. 0.5 is twice as fast.");
    bh.slider(s, mode, r - 224, 144 + 22, 0.5, "1.0×", "typing speed");
    r = bh.row(s, mode, 72 + 144, "Mouse speed", "Scales how fast the cursor travels.");
    bh.slider(s, mode, r - 224, 216 + 22, 0.5, "1.0×", "mouse speed");
    sy += s.height + gap;

    // Profiles and sessions
    s = bh.section(body, mode, 0, sy, rw, 72 + 3 * 72 + 8, "Sessions", "What Claude opens when a session starts and ends.");
    r = bh.row(s, mode, 72, "Default profile", "Used when Claude is not told which profile to drive.", true);
    bh.field(s, mode, r - 200, 72 + 16, 200, "Personal", { select: true, name: "default profile" });
    r = bh.row(s, mode, 144, "Open a new window", "Off puts the tab group in your current window.");
    bh.toggle(s, mode, r - 36, 144 + 22, true, "new window");
    r = bh.row(s, mode, 216, "Close tabs when the session ends", "Off leaves Claude's tabs open for you.");
    bh.toggle(s, mode, r - 36, 216 + 22, false, "close tabs on exit");
    sy += s.height + gap;

    // Site access
    const blocked = state.editing ? ["*.bank.com/*", "hr.example.com/*", "payroll.example.com/*"] : ["*.bank.com/*", "hr.example.com/*"];
    s = bh.section(body, mode, 0, sy, rw, 10, "Site access", "Enforced in the extension, so a request from the server cannot get past it. One pattern per line, * matches anything.");
    let yy = 84;
    pd.text(s, 24, yy, "Blocked sites", { size: 14, weight: 500, color: m("text"), name: "blocked label" });
    pd.text(s, 24, yy + 22, "Claude never opens or acts on these.", { size: 12, color: m("text2"), name: "blocked help" });
    yy += 48;
    yy += bh.patterns(s, mode, 24, yy, W - 48, blocked, { name: "blocked list" });
    yy += 16;
    pd.rule(s, 24, yy, W - 48, { color: m("border"), name: "divider" });
    yy += 16;
    pd.text(s, 24, yy, "Read-only sites", { size: 14, weight: 500, color: m("text"), name: "read-only label" });
    pd.text(s, 24, yy + 22, "Claude can read these but not click, type or run scripts.", { size: 12, color: m("text2"), name: "read-only help" });
    yy += 48;
    yy += bh.patterns(s, mode, 24, yy, W - 48, ["mail.google.com/*"], state.editing
      ? { name: "read-only list", draft: "https//docs.google", focus: true, error: "Not a pattern. Use host/path, for example docs.google.com/*" }
      : { name: "read-only list" });
    s.resize(rw, yy + 16);
    sy += s.height + gap;

    // Capture
    s = bh.section(body, mode, 0, sy, rw, 72 + 4 * 72 + 8, "Capture", "Screenshots Claude takes and GIFs it records.");
    r = bh.row(s, mode, 72, "Screenshot size", "Bigger shows more detail and costs more tokens.", true);
    bh.field(s, mode, r - 200, 72 + 16, 200, "1280 × 800", { select: true, name: "screenshot size" });
    r = bh.row(s, mode, 144, "Screenshot quality", "JPEG quality.");
    bh.slider(s, mode, r - 224, 144 + 22, 0.8, "80", "screenshot quality");
    r = bh.row(s, mode, 216, "GIF folder", "Where recordings and saved screenshots go.");
    bh.field(s, mode, r - 280, 216 + 16, 280, "~/Downloads/browser-hand", { mono: true, name: "gif folder" });
    r = bh.row(s, mode, 288, "GIF frame delay", "Playback speed of recordings.");
    bh.field(s, mode, r - 120, 288 + 16, 120, "700", { mono: true, unit: "ms", name: "frame delay" });
    sy += s.height + gap;

    // Debugger
    s = bh.section(body, mode, 0, sy, rw, 56 + 72 + 8, "Debugger", null);
    r = bh.row(s, mode, 56, "Detach after idle", "How soon the \"started debugging\" bar goes away after the last action.", true);
    bh.field(s, mode, r - 120, 56 + 16, 120, "30", { mono: true, unit: "s", name: "debugger idle" });
    sy += s.height;

    body.resize(W, sy);
    pd.text(content, 0, y + sy + 24, "browser-hand 0.1.0", { size: 12, color: m("text2"), name: "version" });
    content.resize(W, y + sy + 48);
    return content;
  },

  screen(name, x, mode, state, caption) {
    const page = penpot.currentPage;
    for (const s of [...page.root.children]) if (s.name === name) s.remove();
    const WW = 1280;
    const board = pd.box(null, x, 0, WW + 80, 10, { fill: T["Board/ground"], name: name });
    const win = bh.window(board, mode, 40, 40, WW, 10, "chrome-extension://browser-hand/options.html");
    const content = bh.page(win, mode, state);
    const wh = 116 + content.height + 48 + (state.editing ? 64 : 0);   // the save bar covers the page foot
    win.resize(WW, wh);
    const m = bh.m(mode);
    if (state.editing) {
      const bar = pd.box(win, 0, wh - 64, WW, 64, { fill: m("surface"), name: "save bar" });
      pd.rule(bar, 0, 0, WW, { color: m("border"), name: "edge" });
      pd.text(bar, (WW - 720) / 2, 22, "2 unsaved changes", { size: 14, weight: 500, color: m("text"), name: "unsaved count" });
      bh.button(bar, mode, (WW + 720) / 2 - 64, 16, "Save", "primary", "Save button");
      bh.button(bar, mode, (WW + 720) / 2 - 64 - 12 - 88, 16, "Discard", "secondary", "Discard button");
    }
    if (state.saved) {
      const t = pd.box(win, WW - 24 - 380, wh - 24 - 56, 380, 56, { fill: m("surface"), stroke: m("border"), radius: 10, name: "saved toast" });
      pd.ellipse(t, 16, 24, 8, 8, { fill: m("success"), name: "dot" });
      pd.text(t, 34, 10, "Saved", { size: 14, weight: 600, color: m("text"), name: "toast title" });
      pd.text(t, 34, 30, "~/.config/browser-hand/config.toml", { font: MONO, size: 12, color: m("text2"), name: "toast path" });
    }
    pd.text(board, 40, 40 + wh + 16, caption, { size: 14, color: T["Board/caption"], width: WW, name: "caption" });
    board.resize(WW + 80, 40 + wh + 16 + 24 + 40);
    return board;
  },
};
storage.bh = bh;
return Object.keys(bh);
