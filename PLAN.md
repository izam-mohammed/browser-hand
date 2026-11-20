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

### Phase 9: repository hygiene

- [x] `plans/12-repo-hygiene.md` - topics, Dependabot, a security policy
  and an MIT licence.

### Phase 10: one check, held at 90 %

- [ ] `plans/09-quality-gates.md` - `make check` formats, lints, tests to a
  90 % floor and scans for secrets and advisories, and CI runs it through
  the shared security gate.

### Phase 11: a page for users

- [ ] `plans/10-site.md` - a one-page site in `site/`, published as a page
  of the personal site while the repository stays private.

### Phase 12: documentation for users

- [ ] `plans/11-docs.md` - an mdBook book at `/browser-hand/docs/` beside
  the landing page: getting started, guides, and a reference of tools,
  commands and settings generated from the host, checked by
  `make check`.

### Phase 13: keeping up with Claude in Chrome

- [ ] `plans/13-chrome-parity.md` - a cursor the person can see, tokens
  hidden in network reads, a steady reconnect and plain-spoken argument
  errors, from the 14/11/2026 reference refresh.

### Phase 14: keeping up with Claude in Chrome, again

- [ ] `plans/14-chrome-parity-2.md` - Linux and other Chromium browsers,
  big reads kept in the conversation, and uploads that refuse credential
  files, from the 17/11/2026 reference refresh.

### Phase 15: two browsers, one Default

- [ ] `plans/15-browser-identity.md` - the native host says which browser it
  runs in, matching and the default-profile list use `<browser>:<dir>`,
  from the plan 14 follow-ups.

### Phase 16: Windows

- [ ] `plans/16-windows.md` - the host installs through the registry, talks
  over named pipes and launches Chrome, Edge, Brave, Chromium and Vivaldi on
  Windows, the one parity gap left from plan 14.

### Phase 17: hands-free and guarded

- [ ] `plans/17-hands-free-and-guarded.md` - a recording replays without
  Claude, sites can be allow-listed, every call can be logged, screenshots
  can save to a folder of the person's choice, and `wait_for` replaces
  guessed waits.
