# Evidence for plans/06-settings.md

Gathered 19/10/2026 while planning; the tables and choices are in the plan.
Line numbers are as of commit `27b1462` plus the working tree of that day.

## What the design asks for

Read from `design/settings--light.png`, `--dark`, `--editing`, `--saved`,
`--disconnected` and `tokens--sheet.png`, with their captions.

| Section | Setting | Control | Default shown |
| --- | --- | --- | --- |
| Input | Pace | Human or Fast | Human |
| Input | Typing speed | slider, "Multiplies the gap between keys. 0.5 is twice as fast." | 1.0x |
| Input | Mouse speed | slider, "Scales how fast the cursor travels." | 1.0x |
| Sessions | Default profile | select of profiles | Personal |
| Sessions | Open a new window | toggle, "Off puts the tab group in your current window." | on |
| Sessions | Close tabs when the session ends | toggle, "Off leaves Claude's tabs open for you." | off |
| Site access | Blocked sites | pattern list, "Claude never opens or acts on these." | `*.bank.com/*`, `hr.example.com/*` (examples) |
| Site access | Read-only sites | pattern list, "Claude can read these but not click, type or run scripts." | `mail.google.com/*` (example) |
| Capture | Screenshot size | select | 1280 x 800 |
| Capture | Screenshot quality | slider, "JPEG quality." | 80 |
| Capture | GIF folder | text, "Where recordings and saved screenshots go." | `~/Downloads/browser-hand` |
| Capture | GIF frame delay | number, ms | 700 |
| Debugger | Detach after idle | number, s | 30 |

The header says "Settings apply to every Chrome profile and are saved to
`~/.config/browser-hand/config.toml`", with a Connected or Not connected
pill. Site access says "Enforced in the extension, so a request from the
server cannot get past it. One pattern per line, * matches anything." The
footer shows `browser-hand 0.1.0`.

States: light and dark follow the system; editing shows a bottom bar "2
unsaved changes" with Discard and Save, and an invalid pattern
(`https//docs.google`) refused inline with "Not a pattern. Use host/path,
for example docs.google.com/*"; saved shows a toast "Saved" with the path,
closing after 4 seconds ("The host wrote config.toml"); disconnected shows
a warning banner "The browser-hand host is not running. Settings are
read-only until it connects. Start a Claude session with the browser-hand
plugin, then reload this page." with Retry, every control dimmed, and the
caption "Values are the last ones the extension saw".

The design shows no extension icon, no list of screenshot sizes beyond
1280 x 800, and no slider ranges.

## Where each setting lives today

| Setting | Today | Reader |
| --- | --- | --- |
| Pace | `BROWSER_HAND_PACE` env var, `pace_from_env` in `host/src/mcp.rs`, sent as `pace` on every `computer` call | extension `Input.run` |
| Typing, mouse speed | none; constants in `extension/src/humane/params.ts` (`keyGap*`, `fittsA`, `fittsB`) | `Input` takes a `Params` |
| Default profile | none; `Server::call` binds the only claimed profile, else asks for `select_profile` | MCP server |
| New window | always: `TabTools.createGroup` calls `windows.create` | extension |
| Close tabs on end | never: `TabTools.end` forgets the group, tabs stay | extension |
| Blocked, read-only sites | none; `ownTab` checks only group membership | extension |
| Screenshot size | `MAX_WIDTH = 1280`, `MAX_HEIGHT = 800` in `extension/src/screenshot.ts` | extension |
| Screenshot quality | `JPEG_QUALITY = 80`, same file | extension |
| GIF folder | `gif::output_dir`, `BROWSER_HAND_OUTPUT_DIR` override, used by `images::save` too | MCP server |
| GIF frame delay | `GIF_FRAME_DELAY_MS = 700` in `host/src/mcp.rs` | MCP server |
| Detach after idle | `IDLE_DETACH_MS = 30_000` in `extension/src/debugger.ts` | extension |

So five settings are read by the MCP server and the rest by the service
worker. The MCP server is Claude Code's child and may run with no profile
bound (default profile is read exactly then), so it cannot get its
settings through an extension.

## Connection state

`extension/src/background.ts` `connect()` calls `connectNative` and, on
`onDisconnect`, sets `port = null` and retries with backoff from 1 s to
30 s. The host sends nothing to the extension on connect today, so the
worker cannot tell "the port is open" from "a host answered". Chrome reports
a missing host as "Specified native messaging host not found."
(`docs/external/chrome-native-messaging.md` § Errors). The native host is
installed by `browser-hand install` (README step), not by starting Claude,
so the design's banner text points the person at the wrong step.

## Decision 1: where the page lives

- `options_ui` embedded fails the must: the design is a 1280 px wide tab,
  and embedded options cannot use the Tabs API.
- An action popup fails: a popup suppresses `action.onClicked`, which plan
  05 uses for Record (`docs/external/chrome-extension-apis.md`
  § chrome.action).
- `options_page` and `options_ui` with `open_in_tab: true` behave the same
  for the person; the second keeps embedding one flag away.

## Decision 2: where settings are stored

- Must "every profile": the header says so. `storage.sync` follows the
  Google account, so two local profiles signed in to different accounts (or
  none) do not share it; `storage.local` is per profile.
- Must "the MCP server reads it with no profile connected": only a file
  passes.
- Efficiency 5 for the file: the native host reads it once at start and
  stats it every 2 s (Decision 4); the MCP server reads a file under 2 KB
  when it needs a value.
- Security 3 for the file alone: Claude Code's Bash tool runs as the same
  user and can edit `config.toml`. The design's own claim is narrower ("a
  request from the server cannot get past it"), which the file meets: no
  MCP frame reaches the settings.
- The hybrid (site lists also held per profile, loosened only from that
  profile's page) scores security 4 but fit 3: removing a block takes a
  visit to every profile's page, against the header's "apply to every
  Chrome profile".

Sensitivity: the hybrid wins only with security weighted above about 60.
Risk: the person or Claude edits the file by hand into something invalid;
the host keeps the last good settings and reports the field as a warning.

## Decision 3: how settings travel

- Frames on the open port: no process start, and the pill maps to the
  port's real state.
- `sendNativeMessage` starts a new host process per message
  (`docs/external/chrome-native-messaging.md` § sendNativeMessage), 2 MB
  resident and 0.00 to 0.01 s warm each (`docs/research/runtime-baseline.md`).
  It also needs a second entry mode in the binary, since Chrome passes only
  the origin.
- Settings carried by the MCP server in each call fail the must: the
  server could leave the site lists out.

Compatibility: `docs/protocol.md` says unknown frame types are skipped and
the stream continues, so an older host ignores `settings_set` (the page
times out and says the host is older) and an older extension ignores
`settings`.

Sensitivity: `sendNativeMessage` would win only if saving had to work while
the port is down, which the design rules out (disconnected is read-only).
Risk: a host that never sends `settings` reads as Not connected; the page
says which version it saw.

## Decision 4: how other profiles hear of a change

- Polling: one `stat` per 2 s per host process; three profiles make 1.5
  stats a second. No new dependency.
- `notify`: FSEvents reports a rename as two unrelated events, and atomic
  saves replace the inode, so the watcher must watch the directory and pair
  events; its docs suggest the poll watcher where events are missed
  (search below).
- Reload only: a site blocked in one profile would stay open in another
  until Chrome restarts, failing the must.

## Decision 5: file format and parser

- `toml` 1.1.8 and `toml_edit` 0.25.17 are current; OSV.dev lists no
  advisory for either (`docs/external/toml.md`).
- `toml_edit` keeps comments a person adds by hand; the page rewrites the
  whole file on Save, so comments matter only for hand edits. Fit 4 against
  3.

Sensitivity: fragile (4.30 against 4.25); broken on efficiency. Revisit if
people edit the file by hand.

## Decision 6: where site rules are enforced

- The gate alone: a click Claude makes on an allowed page can follow a link
  to a blocked site, which then loads ("opens").
- DNR session rules with `tabIds` stop the request in the network stack
  before it is sent; `declarativeNetRequestWithHostAccess` has no warning
  and works with the `<all_urls>` the extension holds
  (`docs/external/chrome-extension-apis.md` § chrome.declarativeNetRequest).
- `webNavigation.onBeforeNavigate` cannot cancel; the request is sent and
  the page starts to load before a redirect lands.
- Not stated in the docs: whether a `tabs.update` navigation by the
  extension is matched. The proof finds out; if not, the gate already
  checks `navigate`'s URL first.
- A blocked site inside an iframe of an allowed page: content scripts run
  with `all_frames: false`, so the gate never sees it, but a `sub_frame`
  rule stops it loading in Claude's tabs.

## Decision 7: pattern syntax and matching

- The design's patterns have no scheme; Chrome match patterns need one.
- URLPattern's hostname `*` "will match all characters except the dot", so
  `*.bank.com` misses `bank.com` and `a.b.bank.com` (MDN, search below), and
  its compiled regex is not exposed for a DNR `regexFilter`.
- One glob compiled once serves both the gate (JavaScript `RegExp`) and the
  DNR rule (RE2 `regexFilter`), since the output uses only `^`, `$`,
  `[^/]`, `.*` and escaped literals, which both accept.

## Decision 8: keeping the CSS in step with theme.md

- `design/theme.md` holds the 15 colours per mode and the type scale; the
  `global` tokens (space, radius, border width, size, opacity) are only in
  `design/penpot/tokens.js`. The plan adds them to `theme.md` as a table so
  it is the whole source.
- Generated CSS has no runtime cost; neither does hand-written CSS. A
  generator cannot drift; a hand copy can, until a test fails.
- Penpot's token export is not the source and the plan does not touch
  Penpot.

## Decision 9: the page's code

- Preact is about 3 KB min+gzip; in one measured landing page Preact was
  4.87 KB gzip and Lit 6.91 KB gzip (etch.co, search below). Plain DOM
  code adds nothing.
- The page has 13 controls and four states; Preact would make the state to
  DOM step shorter to change. Totals 4.30 against 4.35: fragile, broken on
  efficiency.

## Decision 10: fonts

- Inter is already in the repository (`host/assets/Inter.ttf`, 876,576
  bytes, OFL). JetBrains Mono is OFL; the latest tagged release found is
  v2.304.
- A local font file loads from the extension's own folder; no network
  request, and extension pages do not load remote fonts without a CSP
  change.

## Decision 11: pace when `BROWSER_HAND_PACE` is set

- README and the skill tell people to set `BROWSER_HAND_PACE=fast`. Dropping
  it silently changes their setup; keeping it as a per-server override means
  the page can show Human while that one server runs fast.

## Storage shared with plan 05

The extension keeps its last-seen settings under one `storage.local` key,
`settings:last`, capped at 64 KB: each site list holds at most 200
patterns of at most 100 characters, about 40 KB at the limit.
This shares the `storage.local` budget plan 05 sets for recordings.

## Searches

- 19/10/2026: "chrome extension manifest options_ui open_in_tab vs
  options_page"; the options page guide and the runtime reference.
- 19/10/2026: the permissions list (`unlimitedStorage`,
  `declarativeNetRequest*` warnings), the declarativeNetRequest and storage
  references.
- 19/10/2026: "toml crate rust latest toml_edit serde"; docs.rs `toml`,
  `cargo search`, OSV.dev.
- 19/10/2026: "rust notify crate macOS FSEvents atomic rename"; notify's
  README (via docs.rs and the fuchsia vendor copy).
- 19/10/2026: "URLPattern hostname wildcard apex"; MDN URLPattern hostname.
- 19/10/2026: "preact bundle size gzip vs lit vs vanilla"; etch.co's build
  comparison, preactjs.com size claim.
- 19/10/2026: "JetBrains Mono latest release woff2 OFL";
  github.com/JetBrains/JetBrainsMono releases.
