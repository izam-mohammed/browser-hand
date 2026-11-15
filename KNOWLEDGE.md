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
- **jsdom cannot make a trusted event**: `isTrusted` is a non-configurable
  getter on each event, so `defineProperty` throws. Code that drops
  untrusted events takes the test as an argument (`Capture` in
  `extension/src/page/record.ts`), and tests pass a `WeakSet` of the events
  they mean as the person's.
- **jsdom has no `isContentEditable`** (it is `undefined`), so the walker
  gives a `contenteditable` element no role there and code checks the
  attribute too.
- **Listing tools in a test needs `#[tool_router(vis = "pub")]`**: the
  macro's `tool_router()` is private by default; with it public,
  `Server::tool_router().list_all()` gives every tool's name
  (`host/tests/mcp.rs`).
- **`Frame`'s tag is `snake_case`, not `lowercase`.** With `lowercase`
  serde writes `SettingsSet` as `settingsset`; `snake_case` gives
  `settings_set` and leaves the one-word frames as they were. A field held
  as `serde_json::Value` (so a bad value is refused by key, not by the
  frame failing to parse) still gets a real TypeScript type with
  `#[ts(as = "Settings")]`.
- **A test importing `extension/theme.mjs` needs `theme.d.mts` beside
  it**: tsc is strict and has no `allowJs`, so a plain `.mjs` import is
  TS7016. `build.mjs` imports the same module, so the generator stays
  JavaScript Node runs as is.
- **The settings page can be looked at without loading the extension**:
  bundle a preview that mounts `SettingsPage` on a fake port (esbuild from
  `extension/node_modules`), serve it over HTTP (module scripts refuse
  `file://`), and screenshot it with headless Chrome and a throwaway
  `--user-data-dir`; `--blink-settings=preferredColorScheme=0` gives dark
  mode, `1` light.
- **A Penpot board's text and colours can be read without an export
  login**: `export_file` writes a `.penpot` zip whose
  `files/<file>/pages/<page>/<shape>.json` hold each shape's fills, strokes,
  radius and text runs (size, weight, colour); `get_page_tree` gives only
  names and boxes. The popup was built from these (plans/08-recorder-popup.md).
