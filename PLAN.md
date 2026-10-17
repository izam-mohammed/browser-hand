# browser-hand: what is left to build, in order

Claude drives the user's own Chrome profiles through a local Rust MCP server
and a TypeScript extension, with the tools Claude in Chrome has
(`reference/claude-in-chrome/`) and input that moves like a person's.

### Phase 1: the pipe

- [ ] `plans/plan-bridge.md` - Claude lists the Chrome profiles, picks one and
  manages tabs in it.

### Phase 2: reading and forms

- [ ] `plans/plan-page-tools.md` - page structure, text, console, network,
  forms, scripts and uploads.

### Phase 3: hands

- [ ] `plans/plan-humane-input.md` - clicks, typing, scrolling and drags that
  move like a person, and screenshots.

### Phase 4: the skill and the package

- [ ] `plans/plan-skill.md` - GIF recording, the skill, and one plugin to
  install it all.
