# What we learned building browser-hand

Findings that cost time once. Read before each phase.

- **npm drops vitest's native binding after `npm i <pkg>`.** Adding a
  package to `extension/` can remove `@rolldown/binding-*` (npm bug
  npm/cli#4828), and vitest fails with "Cannot find native binding". Fix:
  `rm -rf extension/node_modules extension/package-lock.json && npm --prefix extension install`.
- **Cargo config is found from the working directory, not the crate.** The
  ts-rs export path lives in the root `.cargo/config.toml` so `cargo test`
  writes `extension/src/wire.gen.ts` whether run from the root or `host/`.
  A config under `host/.cargo/` was skipped from the root, and ts-rs wrote to
  `host/bindings/` instead.
- **Content scripts are classic scripts.** `extension/build.mjs` bundles the
  service worker and claim page as ESM, but `content.js` and `main-world.js`
  as IIFE; an `export` in a content script is a syntax error in Chrome.
- **Chrome starts the native host with only the extension origin as an
  argument**, so `browser-hand` treats a `chrome-extension://` first argument
  as the `native-host` mode; no subcommand reaches it.
- **The socket dir comes from `confstr(_CS_DARWIN_USER_TEMP_DIR)`**, not
  `$TMPDIR`, so Chrome's child and Claude Code's child agree on it.
- **A plugin's `bin/` directory goes on the Bash tool's PATH**, and claude.ai
  and Cowork refuse plugins that have one, so the binary lives in
  `plugin/server/`.
- **`#[tool_handler(instructions = ...)]` takes only a string literal**; the
  server writes `get_info` by hand to use `include_str!("instructions.md")`.
- **jsdom leaves `MessageEvent.source` null for `postMessage`**, while Chrome
  sets it to the window; tests that cross worlds deliver messages with the
  source set (`extension/test/page.test.ts`).
