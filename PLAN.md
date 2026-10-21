# browser-hand: what is left to build, in order

Claude drives the user's own Chrome profiles through a local Rust MCP server
and a TypeScript extension, with the tools Claude in Chrome has
(`reference/claude-in-chrome/`) and input that moves like a person's.

### Phase 1: the pipe

- [ ] `plans/01-bridge.md` - Claude lists the Chrome profiles, picks one and
  manages tabs in it.

### Phase 2: reading and forms

- [ ] `plans/02-page-tools.md` - page structure, text, console, network,
  forms, scripts and uploads.

### Phase 3: hands

- [ ] `plans/03-humane-input.md` - clicks, typing, scrolling and drags that
  move like a person, and screenshots.

### Phase 4: the skill and the package

- [ ] `plans/04-skill.md` - GIF recording, the skill, and one plugin to
  install it all.

### Phase 5: recording

- [ ] `plans/05-record-steps.md` - the person records steps from a toolbar
  button, and Claude reads and replays them.

### Phase 6: settings

- [ ] `plans/06-settings.md` - one settings page, saved by the host for
  every profile: pace, sessions, blocked and read-only sites, capture and
  the debugger.

### Phase 7: install without Load unpacked

- [ ] `plans/07-install-extension.md` - browser-hand on the Chrome Web Store,
  unlisted, offered to every profile with one Enable click.

### Phase 8: the button asks first

- [ ] `plans/08-recorder-popup.md` - the toolbar button opens a small
  popup to start a recording, read old ones and reach settings; while
  recording, one click stops.
