# browser-hand colour theme

The palette for the extension's settings page, in a light and a dark mode
that follow the system setting. It is the token source: the Penpot board
`settings--theme` is drawn from this table, and the extension's CSS will be
written from it.

The accent is the orange browser-hand already uses: its tab groups are
Chrome's `orange`, and GIF click indicators are `#D97706`
(`host/src/gif.rs`).

Contrast ratios are WCAG 2.2, measured on 18/10/2026 against `surface`
(light `#FFFFFF`, dark `#17181B`). Text under 24 px needs 4.5:1 (1.4.3 AA);
control edges and meaningful icons need 3:1 (1.4.11 AA).

| Token | Value | Use | Contrast |
| --- | --- | --- | --- |
| `light/bg` | `#FAFAF9` | page background | |
| `light/surface` | `#FFFFFF` | cards, panels | |
| `light/raised` | `#F4F4F2` | hover, section header, input fill | |
| `light/border` | `#E4E4E0` | dividers, card edges (decorative) | |
| `light/control` | `#8A8A82` | input, toggle and checkbox edges | 3.48 |
| `light/text` | `#1C1C1A` | primary text | 17.07 |
| `light/text2` | `#57574F` | secondary text, help, placeholders | 7.29 |
| `light/text3` | `#8A8A82` | disabled text only | 3.48 |
| `light/accent` | `#D97706` | primary button, toggle on, focus ring | 3.19 |
| `light/accentText` | `#B45309` | links, accent text | 5.02 |
| `light/onAccent` | `#1C1C1A` | text on accent fills | 5.36 |
| `light/success` | `#15803D` | saved, connected | 5.02 |
| `light/warning` | `#A16207` | needs attention | 4.92 |
| `light/danger` | `#DC2626` | blocked sites, errors | 4.83 |
| `light/info` | `#2563EB` | notes | 5.17 |
| `dark/bg` | `#0F1012` | page background | |
| `dark/surface` | `#17181B` | cards, panels | |
| `dark/raised` | `#1F2024` | hover, section header, input fill | |
| `dark/border` | `#2C2D32` | dividers, card edges (decorative) | |
| `dark/control` | `#6F6F69` | input, toggle and checkbox edges | 3.51 |
| `dark/text` | `#ECECEA` | primary text | 15.01 |
| `dark/text2` | `#A8A8A1` | secondary text, help, placeholders | 7.42 |
| `dark/text3` | `#6F6F69` | disabled text only | 3.51 |
| `dark/accent` | `#F59E0B` | primary button, toggle on, focus ring | 8.27 |
| `dark/accentText` | `#FBBF24` | links, accent text | 10.63 |
| `dark/onAccent` | `#1C1C1A` | text on accent fills | 7.95 |
| `dark/success` | `#4ADE80` | saved, connected | 10.19 |
| `dark/warning` | `#FACC15` | needs attention | 11.59 |
| `dark/danger` | `#F87171` | blocked sites, errors | 6.42 |
| `dark/info` | `#60A5FA` | notes | 6.98 |

## Rules the numbers set

- White on the accent fails (3.19 light, 2.15 dark): text on accent fills is
  always `onAccent`.
- `text3` is for disabled text only; WCAG exempts disabled controls.
  Placeholders use `text2`.
- `border` is decorative; anything a person operates is edged in `control`.

## Type

Inter for everything (the face already bundled in `host/assets/`, OFL), and
JetBrains Mono for values a person copies: URL patterns, paths, numbers with
units. Sizes from the 8-based scale: 24 page title, 16 section heading,
14 body and labels, 12 help text and captions (the floor).
