# design

The extension's settings page, drawn in Penpot.

- **Penpot:** project `browser-hand`, file `Settings`.
- **Pages:** `Tokens` holds the token sheet; `Settings` holds the screens.
- **Colours and type:** `theme.md` is the source. The Penpot design tokens
  and the extension's CSS are both written from it.
- **Naming:** a board is `<area>--<state>`, and its export is
  `<board name>.png` in this folder.
- **Layout:** boards sit on one row, left to right, 1480 px apart
  (a 1360 px board plus a 120 px gap). Each shows a 1280 px wide Chrome
  window at 1:1, with a caption under it saying what the state is. The
  icon and the 360 px popup boards follow, 120 px apart.

## Design tokens

In the file's Tokens panel:

| Set | Holds |
| --- | --- |
| `global` | `font.*`, `space.*`, `radius.*`, `border.width.*`, `size.*`, `opacity.tint` |
| `mode/light` | `color.*`, 15 colours |
| `mode/dark` | `color.*`, the same 15 names |

Themes: group `mode`, with `light` (global + mode/light) and `dark`
(global + mode/dark).

## Boards

| File | Shows |
| --- | --- |
| `tokens--sheet.png` | every token, both modes side by side |
| `settings--light.png` | the settings page, default state, light mode |
| `settings--dark.png` | the same, dark mode |
| `settings--editing.png` | a pattern added, an invalid one refused inline, the unsaved-changes bar |
| `settings--saved.png` | the toast after Save |
| `settings--disconnected.png` | native host not running: banner, controls read-only |
| `icon--app.png` | the extension's app icon, 128 px; 48 px is in `extension/icons/` |
| `popup--idle.png` | the toolbar popup when not recording: Start recording, recent recordings, Settings (not exported yet) |
| `popup--empty.png` | the same popup before the first recording (not exported yet) |
| `popup--steps.png` | one recording's actions, Back, Delete (not exported yet) |

No plan builds these yet.

## Redrawing

`penpot/` has the scripts that drew everything. Run them with the penpot
skill's `penpot_mcp.py code FILE`, after the skill's bootstrap
(`make_bootstrap.py . --source design/theme.md`) and `builder.js`:

1. Tokens: `tokens_clear.js`, then `tokens.js`, then `themes.js`. Each one
   is a separate call, because a set removed in a call still blocks a new
   set with the same name in that call.
2. Token sheet: `tokens_board.js`. If the Tokens page isn't open, the first
   run opens it and stops, so run it twice.
3. Screens: `settings_kit.js` once, then `s_<state>.js` for each board,
   with the Settings page open.
