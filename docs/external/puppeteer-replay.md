# Chrome DevTools Recorder format (@puppeteer/replay `UserFlow`)

Fetched: 18/10/2026 from
https://github.com/puppeteer/replay/blob/main/src/Schema.ts and the selector
types in chrome-devtools-frontend's bundled copy
(https://app.unpkg.com/chrome-devtools-frontend@1.0.1669021/files/front_end/third_party/puppeteer-replay/package/lib/main.d.ts),
plus https://developer.chrome.com/blog/new-in-devtools-112 on pierce selectors.
Used by `plans/05-record-steps.md`. Nothing is installed: the project writes
JSON in this shape and reads it back.

## UserFlow

```text
UserFlow { title: string; timeout?: number; selectorAttribute?: string; steps: Step[] }
```

## Step types

`change`, `click`, `close`, `customStep`, `doubleClick`,
`emulateNetworkConditions`, `hover`, `keyDown`, `keyUp`, `navigate`,
`scroll`, `setViewport`, `waitForElement`, `waitForExpression`.

Fields this project uses:

```text
click        { type, selectors, offsetX, offsetY, button?, deviceType?, duration? }
doubleClick  same as click
change       { type, selectors, value: string }
keyDown      { type, key }            keyUp { type, key }
navigate     { type, url }
scroll       { type, x?, y?, selectors? }   absolute px; selectors => element scroll
setViewport  { type, width, height, deviceScaleFactor, isMobile, hasTouch, isLandscape }
```

Every step may carry `assertedEvents?: [{ type: "navigation", url?, title? }]`,
`frame?: number[]` (path of child-frame indexes, default main frame),
`target?: string` (default `"main"`), `timeout?: number`.

## Selectors

`selectors: Selector[]`, `Selector = string | string[]`; tried in order. In
an array the last element is the target and earlier ones are ancestors
(shadow roots, frames). Prefixes: none (CSS), `aria/<name>` or
`aria/<name>[role="<role>"]`, `text/<text>`, `xpath/<expr>`, `pierce/<css>`.
The DevTools settings note that only CSS, pierce and XPath are guaranteed to
be recorded, "since ARIA and text selectors may not be unique".

## Gotchas

- `change` carries the field's final value, not each key; DevTools records
  keys only for keys that are not typing (Enter, Tab, shortcuts).
- `offsetX`/`offsetY` are relative to the element's box, not the viewport.
- Unknown fields: the schema has no extension point other than `customStep`;
  a reader that validates strictly may reject extra fields on a step.
