# Humane input: research

Gathered: 17/10/2026

Scope: how a Chrome MV3 extension driving the user's own Chrome profile through `chrome.debugger` and CDP `Input.*` can produce mouse, keyboard and scroll input that behaves like a person, plus screenshots and GIF encoding. All sources were accessed on 17/10/2026. The "Date" given for each source is its publication or last-updated date where the page shows one; "undated" means the page shows none. Anything marked "not found" was searched for and not located in a source worth citing. The "Proposed defaults" at the end are our own choices built on these sources, not source claims.

Purpose note: this is for a personal assistant acting on the user's own accounts. Section 4 records what is publicly documented so we understand which signals our input produces. It is not a guide to evading detection on third-party sites.

## 1. Mouse paths

### Path models

**Cubic Bezier with one-sided random anchors (ghost-cursor).**
- Two control points are placed at random positions along the start to end line, offset perpendicular to it by a "spread", both on the same randomly chosen side, which the README says avoids overly wonky curves. Anchors are then sorted by x.
- Spread defaults to the start to end distance clamped to `MIN_SPREAD = 2` and `MAX_SPREAD = 200` px, unless `spreadOverride` is given.
- The number of points sampled on the curve is `Math.ceil((Math.log2(fitts(length, width) + 1) + baseTime) * 3)` with `MIN_STEPS = 25`, sampled with `curve.getLUT(steps)`.
- Optional per-point timestamps are generated "based on the trapezoidal rule" when `useTimestamps` is set.
- Sources: https://github.com/Xetera/ghost-cursor (README, undated), https://github.com/Xetera/ghost-cursor/blob/master/src/math.ts and https://raw.githubusercontent.com/Xetera/ghost-cursor/master/src/spoof.ts (master branch, read 17/10/2026).

**WindMouse (Benjamin Land).**
- A physics-style model: a constant "gravity" pulls the cursor to the target and a random "wind" perturbs it; velocity is clipped to a max step that shrinks near the target.
- Published defaults: `G_0 = 9` (gravity), `W_0 = 3` (wind), `M_0 = 15` (max step, reduced near the destination to a minimum of 3), `D_0 = 12` (distance at which wind switches from random to damped).
- The author says these are not necessarily optimal and can be tuned (for example wind equal to gravity gives more meandering paths). His evidence that paths look human is a visual comparison, not a statistical test.
- Source: https://ben.land/post/2021/04/25/windmouse-human-mouse-movement/ (25/04/2021, page modified 24/05/2026).

**Minimum-jerk trajectories (Flash and Hogan, 1985).**
- The model chooses the trajectory that minimises the squared magnitude of hand jerk integrated over the movement. For rest to rest point-to-point moves the optimum is a fifth-order polynomial in normalised time, predicting a straight path with a bell-shaped velocity profile.
- The commonly used closed form, as implemented in a MATLAB reference based on Flash and Hogan, is `x(t) = x0 + (xT - x0)(10 tau^3 - 15 tau^4 + 6 tau^5)`, `tau = t / T`. We did not read the equation in the original paper's full text, only the abstract and secondary implementations.
- Sources: Flash T, Hogan N, "The coordination of arm movements", J Neurosci 1985, https://pmc.ncbi.nlm.nih.gov/articles/PMC6565116 (1985); https://gitea.psi.ch/mx/smargopolo/src/branch/master/MATLAB/motion/min_jerk_xy_algorithm.m (undated); https://nbviewer.jupyter.org/github/demotu/BMC/blob/master/notebooks/MinimumJerkHypothesis.ipynb (undated).

**Other libraries.** human_mouse (Python) says it uses "a combination of bezier curves and spline interpolation"; pyclick says its movements are "based on the concept of bezier curve". HumanCursor only describes a "natural motion algorithm" varying speed, acceleration and curvature. Sources: https://github.com/sarperavci/human_mouse, https://pypi.org/project/pyclick/, https://github.com/riflosnake/HumanCursor (all undated).

### Duration: Fitts's law

`MT = a + b * log2(D / W + 1)` (Shannon formulation). `a` and `b` are device-specific regression constants.

Published mouse constants, from MacKenzie (1992), Figure 11:

| Study | a (ms) | b (ms/bit) | IP (bits/s) |
|---|---|---|---|
| Card, English and Burr (1978) | 1030 | 96 | 10.4 |
| Epps (1986) | 108 | 392 | 2.6 |

The two studies disagree widely, which MacKenzie's paper uses to illustrate how much methodology affects the constants. Source: MacKenzie I S, "Fitts' law as a research and design tool in human-computer interaction", Human-Computer Interaction 7, 91 to 139, https://www.yorku.ca/mack/hci1992.html (1992).

ghost-cursor does not use Fitts's law for duration in milliseconds. Its `fitts()` uses `a = 0`, `b = 2` and the result only sets the number of path points (above). Source: spoof.ts as above.

### Overshoot and correction

- ghost-cursor: overshoot only when the distance is at least `overshootThreshold = 500` px. It moves to a random point within `OVERSHOOT_RADIUS = 120` px of the target (uniform over the disc area), then makes a corrective move with `OVERSHOOT_SPREAD = 10`. Source: spoof.ts and math.ts as above.
- HCI papers giving overshoot rates or distances for real mouse users: not found.

### Event rate

- Chrome's blog: "mice deliver input typically at 100Hz (but can be anywhere up to 2000Hz)", while "the typical refresh rate of a monitor is 60Hz". Since Chrome 60, continuous events such as `mousemove`/`pointermove` are held and dispatched just before the `requestAnimationFrame` callback; discrete events (clicks, keys) are dispatched immediately along with pending moves. `getCoalescedEvents()` (Chrome 58) exposes the full set of samples. Source: https://developer.chrome.com/blog/aligning-input-events (last updated 22/06/2017).
- So a page normally sees about one `mousemove` per frame (60 Hz on a 60 Hz display), with the higher-rate samples available through `getCoalescedEvents()`. What a page sees when CDP sends one `mouseMoved` per step, and whether those produce coalesced entries: not found.
- USB HID default polling of 10 ms is mentioned in Dhakal et al. (2018) as a timing noise source. Source: below.

### Hover dwell before click

- HCI figures for dwell between arriving on a target and pressing: not found.
- ghost-cursor `click()` options: `hesitate` (delay before the click action) default `0`; `moveDelay` default `2000` ms, randomised from 0 to that value when `randomizeMoveDelay` is true (the `move` default). Source: ghost-cursor README and spoof.ts.

### Mousedown to mouseup hold

- Peer-reviewed figures for human click hold duration: not found. One page quoting 100 to 200 ms was found but cites no study and is not used.
- ghost-cursor: `waitForClick` (delay between mousedown and mouseup) default `0`. Source: ghost-cursor README and spoof.ts.
- HumanCursor shows `click_duration=1.7` in an example only; no default is documented. Source: https://github.com/riflosnake/HumanCursor.
- For comparison, CDP's own `Input.synthesizeTapGesture` (touch) defaults to a 50 ms touchdown to touchup duration. Source: Input.pdl, below.

## 2. Typing

### Keystroke dynamics (Dhakal, Feit, Kristensson, Oulasvirta, CHI 2018)

Source: "Observations on Typing from 136 Million Keystrokes", CHI 2018, https://www.pokristensson.com/pubs/DhakalEtAlCHI2018.pdf and https://userinterfaces.aalto.fi/136Mkeystrokes/ (21 to 26/04/2018). Data from 168,000 volunteers in an online transcription test, timestamps from `Date.now()`.

- WPM: mean 51.56 (SD 20.2); fastest above 120 WPM. Skewness 0.513.
- Inter-key interval (IKI): mean 238.656 ms (SD 111.6), lower bound about 60 ms, skewness 1.98, kurtosis 7.1 (right-skewed, heavy tail). Fast typists about 120 ms (SD 11 ms); slow typists over 480 ms, sometimes up to 900 ms, SD over 120 ms.
- Keypress duration (key hold): mean 116.24 ms (SD 23.88), 80 to 150 ms even for slow typists, skewness 0.8. Fast vs slow differ by about 20 ms.
- Bigrams: left hand about 7 to 15 ms slower than right. Hand-alternation bigrams about 5 to 20 ms faster than same-hand for fast, trained and untrained typists, but about 20 to 28 ms slower for slow typists. Letter repetition over 150 ms faster for slow typists, 20 to 40 ms slower for fast typists. Bigram IKIs exclude slower cases such as a letter after a space (word-initiation effect).
- Rollover (next key down before previous key up): average rollover ratio 25% (SD 17%); most fast typists 40 to 70% of keystrokes.
- Errors: uncorrected error rate 1.167% (SD 1.43%). Error corrections average 2.29 per sentence (6.3% of keystrokes, SD 4.5%); KSPC 1.173 (SD 0.094). Substitution errors 1.65%, omission 0.8%, insertion 0.67%.

### How libraries emulate typing

- puppeteer-humanize `typeInto(element, text, config)`: README example has `mistakes: { chance: 8, delay: { min: 50, max: 500 } }` and `delays: { space: { chance: 70, min: 10, max: 50 } }`; units are not stated in the README, and full shape is in `schemas/configs.ts` (not read). How mistakes are corrected is not described in the README. Source: https://github.com/force-adverse/puppeteer-humanize (undated). A third-party article describes `chance: 8` as an 8% per-character typo rate (https://roundproxies.com/blog/puppeteer-humanize/, undated); not verified in source.

### Sending keys through CDP

From the CDP Input domain definition (https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Input.pdl, master, read 17/10/2026; rendered at https://chromedevtools.github.io/devtools-protocol/tot/Input/):

- `Input.dispatchKeyEvent` `type` is one of `keyDown`, `keyUp`, `rawKeyDown`, `char`. `text` is "Text as generated by processing a virtual key code with a keyboard layout. Not needed for for `keyUp` and `rawKeyDown` events". Other fields: `unmodifiedText`, `key` (e.g. `AltGr`), `code` (e.g. `KeyA`), `windowsVirtualKeyCode`, `nativeVirtualKeyCode`, `autoRepeat`, `isKeypad`, `location`, `modifiers` (Alt=1, Ctrl=2, Meta=4, Shift=8), and experimental `commands` (editing commands such as `selectAll`).
- So per character: `keyDown` with `key`, `code`, `windowsVirtualKeyCode` and `text`, then `keyUp`. A `rawKeyDown` carries no text. That a `keyDown` with `text` is what makes Chrome produce `keypress`, `beforeinput` and `input` (and that `rawKeyDown` alone does not insert text) is how Puppeteer's keyboard works, but we did not find an official statement of the event sequence; verify on a test page.
- `Input.insertText` (experimental): "emulates inserting text that doesn't come from a key press, for example an emoji keyboard or an IME." This is the documented use case for emoji, IME text and characters with no key on the layout (including non-BMP characters). Exactly which DOM events it fires (for example whether `keydown`/`keypress` are skipped while `beforeinput`/`input` fire): not found in the docs.
- `Input.imeSetComposition` (experimental) sets IME candidate text; commit with `imeCommitComposition`.

## 3. Scrolling

- Windows wheel tick: a Chromium blink-dev post says "For a mouse wheel tick on Windows with default settings, this translates to be 100 logical pixels"; later in the same thread Chrome is said to hardcode a "line" as 33.3 px per OS-provided line, and Windows defaults to 3 lines per tick, which is consistent with 100 px. Source: https://groups.google.com/a/chromium.org/g/blink-dev/c/U3kH6_98BuY/m/pUg0LwXyDAAJ (27/09/2019). WebKit's Windows code uses the same 100 px per three lines constant: https://opensource.apple.com/source/WebCore/WebCore-7600.8.9/platform/win/WheelEventWin.cpp.auto.html (undated). A Mozilla bug records Chrome reporting `deltaY` 100 per tick with `deltaMode` 0 (pixels) while Firefox reported 3 lines: https://bugzilla.mozilla.org/show_bug.cgi?id=1057252 (undated in what we read).
- The legacy `mousewheel` `wheelDelta` is ±120 per notch on Windows and Linux; MDN says the value changes on macOS if the device supports continuous scroll. Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/mousewheel_event (undated).
- macOS: the blink-dev post says the OS "factors in acceleration for the wheel events". A fixed px per tick figure for macOS mice or trackpads: not found.
- CDP: `Input.dispatchMouseEvent` with `type: "mouseWheel"` takes `deltaX`/`deltaY` "in CSS pixels". `Input.synthesizeScrollGesture` (experimental) issues touch-style gestures with `speed` default 800 px/s, `preventFling` default true, `repeatDelayMs` default 250. Source: Input.pdl above.
- Chromium's compositor has a separate `kPixelsPerLineStep = 40` for scrollbar line steps: https://chromium.googlesource.com/chromium/src/+/77.0.3865.90/cc/input/scrollbar.h (Chrome 77).
- Smooth vs discrete: whether a CDP `mouseWheel` event is animated by Chrome's smooth-scrolling setting the same way as a hardware tick: not found. Test.
- Reading pauses between scrolls: research figures not found. ghost-cursor's `scrollDelay` default is 200 ms and `scrollSpeed` default 100 (on its 0 to 100 scale, 100 is instant). Source: ghost-cursor README and spoof.ts.
- The Claude in Chrome `computer` schema (local copy, `reference/claude-in-chrome/tools/computer.json`) has `scroll_amount` as "The number of scroll wheel ticks", 1 to 10, default 3. Anthropic's computer use docs likewise define `scroll_amount` as the "number of scroll-wheel clicks".

## 4. Detection surface (defensive notes)

- `isTrusted`: MDN defines it as true for events generated by the user agent and false for `dispatchEvent()`; untrusted events do not run default actions in Chrome since 53. Source: https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted (undated). That CDP `Input.dispatch*Event` events arrive with `isTrusted: true` is stated only by secondary sources (for example https://zylos.ai/research/cdp-istrusted-research, undated, vendor-authored); no official Chrome statement found. Verify with a test page.
- `Runtime.enable` leak: rebrowser-patches says Puppeteer and Playwright call `Runtime.Enable` to manage execution contexts, and that anti-bot vendors (it names Cloudflare and DataDome) detect it with a few lines of page JavaScript. Its fix creates contexts manually instead. Source: https://github.com/rebrowser/rebrowser-patches (page lists releases dated 14/10/2026). The same page notes Puppeteer/Playwright launch Chrome with `--enable-automation`, which sets `navigator.webdriver` true. Implication for us: avoid calling `Runtime.enable` unless needed; it is not needed for `Input.*` or `Page.captureScreenshot`.
- `navigator.webdriver`: MDN says it is true when Chrome is started with `--enable-automation`, `--headless`, or `--remote-debugging-port=0`. Source: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver (undated). Whether attaching via `chrome.debugger` in a normal profile changes it: not found in docs. Expected false since none of those flags are used, but verify.
- Debugger infobar: an extension using `chrome.debugger` causes a banner of the form "<extension> started debugging this browser", which persists until dismissed (BrowserStack support FAQ, https://www.browserstack.com/support/faq/accessibility/basics-accessibility/why-am-i-seeing-a-banner-that-says-browserstack-accessibility-toolkit-started-debugging-this-browser, undated). A Chromium commit ties the infobar to debugger sessions (https://chromium.googlesource.com/chromium/src/+/d73ce43f031b7e5acdc5c501d9c93e08a89307eb%5E%21). The infobar is browser UI, not visible to page scripts as far as we found. Official `chrome.debugger` docs do not mention it, and list 26 available domains including Input, Page, Runtime and Emulation; DevTools opening on the tab detaches the session. Source: https://developer.chrome.com/docs/extensions/reference/api/debugger (last updated 05/10/2026). A documented switch to suppress the infobar: not found.
- Pointer properties: CDP `dispatchMouseEvent` has `force` (default 0), `tangentialPressure` (default 0), `tiltX`/`tiltY` (default 0), `twist` (default 0), `pointerType` `mouse` or `pen`. Source: Input.pdl. What real mice report for these and whether vendors check them: not found in a reputable source.
- Path shape: Benjamin Land says straight lines and discrete angles make simple interpolation easy to identify; a single DEV Community anecdote says Puppeteer/Playwright default mouse movement was detected and a custom trajectory was not (https://dev.to/ameobius/bypass-yandex-smartcaptcha-with-cdp-mouse-events-2bf4, undated, unverified). Vendor documentation of which motion features they score: not found.

## 5. Screenshots for the model

**`chrome.tabs.captureVisibleTab`** (https://developer.chrome.com/docs/extensions/reference/api/tabs, read 17/10/2026)
- "Captures the visible area of the currently active tab in the specified window." So it cannot capture a background tab.
- Needs `<all_urls>` or `activeTab`.
- `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2` (Chrome 92+).

**CDP `Page.captureScreenshot`** (https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Page.pdl, read 17/10/2026)
- Params: `format` png (default), jpeg, webp; `quality` 0 to 100 (jpeg only per the PDL); `clip` (Viewport with scale); experimental `fromSurface` (default true), `captureBeyondViewport` (default false), `optimizeForSpeed` (default false). No documented rate limit.
- Works per attached tab, but a GitHub issue against Claude in Chrome (anthropics/claude-code #78533, opened 17/07/2026, closed 05/09/2026 not planned) reports it timing out at 30 s when the tab's `visibilityState` is hidden because Chrome stops producing compositor frames; workarounds suggested were bringing the tab to front or disabling renderer backgrounding. Source: https://claudeissues.com/issue/78533-claude-in-chrome-page-capturescreenshot-times-out-30s-on-any-tab-whose-visibilit (mirror of the issue). Single report.
- Speed comparison between the two APIs: no benchmark found.
- Device pixel ratio: both return device pixels, so on a DPR 2 display the image is twice the CSS viewport size. `Input.dispatchMouseEvent` takes CSS pixels. The `clip.scale` parameter can be used to request a scaled capture (we did not verify that this yields CSS-pixel output at DPR 2).

**Anthropic computer use guidance** (https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool, read 17/10/2026; https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude, 13/05/2026)
- Docs: "For general desktop tasks, use 1024x768 or 1280x720; for web applications, use 1280x800 or 1366x768." "Avoid resolutions above 1920x1080." Poor accuracy: "Try 1280x720 as a baseline." Code samples use 1024x768.
- Image limits: earlier models up to 1568 px long edge and about 1.15 MP; Opus 4.7 and later, including every model on `computer_toolset_20260801`, up to 2576 px long edge and 4784 visual tokens (`ceil(w/28) * ceil(h/28)`, about 3.75 MP). With the toolset, oversized images are rejected, not downscaled. Over 20 images in a request triggers a stricter 2000 px per side limit.
- Coordinates are in screenshot pixels; "If you scale screenshots down before returning them, scale Claude's coordinates back up". macOS Retina screenshots at DPR 2 should be downscaled by 2 or coordinates halved.
- Blog: "Start with 1280x720"; for Opus 4.7 start at 1080p; avoid below 960x540; preserve aspect ratio; resize algorithm made no measurable difference. The docs do not use the term "XGA".
- Claude in Chrome's own schema adds a `scale` (0.1 to 1) to screenshots with coordinates "ALWAYS in the full-resolution coordinate frame". Source: `reference/claude-in-chrome/tools/computer.json`.

## 6. GIF encoding

| Option | Where | Facts from source |
|---|---|---|
| gifenc (mattdesl) | JS, extension | "9KB before GZIP"; vs gif.js "often more than twice as fast with similar visual results"; about 5 s main thread vs about 2 s on 4 workers for 150 frames of 1024x1024 in Chrome; no built-in worker API; `quantize` + `applyPalette`, formats `rgb565` (default), `rgb444` (faster, lower quality), `rgba4444`. MIT. https://github.com/mattdesl/gifenc (undated) |
| gif.js | JS, extension | Web workers (default 2), `quality` default 10 (sample interval, lower is better), NeuQuant. MIT, (c) 2013. Size and maintenance status: not found. https://github.com/jnordberg/gif.js |
| modern-gif | JS, extension | Encode and decode, max colours 2 to 255, Web Worker support (optional `workerUrl`), TypeScript. MIT. Size and speed claims: not found. https://github.com/qq15725/modern-gif |
| `gif` crate | Rust, MCP server | 0.14.2, MIT OR Apache-2.0. `Frame::from_rgba_speed(w, h, px, speed)`, speed 1 to 30, "A speed of 10 is a good compromise", NeuQuant; `from_rgba` "is not optimized for speed". https://docs.rs/gif/latest/gif/ |
| gifski | Rust, MCP server | pngquant-based, cross-frame palettes and temporal dithering, "thousands of colors per frame". AGPL 3 or later, commercial licence available. Rust crate and C API. Speed claims: not found. https://github.com/ImageOptim/gifski |

Claude in Chrome's `gif_creator` exposes a `quality` 1 to 30 default 10, the same range as the `gif` crate and NeuQuant's sample factor (local `reference/claude-in-chrome/tools/gif_creator.json`). Which encoder it uses: not determined.

## 7. How humanising libraries shape their APIs

- **ghost-cursor** (Puppeteer): `new GhostCursor(page, { start, performRandomMoves, defaultOptions, visible })`. Element-or-point verbs: `click(selector|point, opts)`, `move(selector, opts)`, `moveTo({x,y}, opts)`, `moveBy(delta)`, `scroll(delta)`, `scrollTo(dest)`, `scrollIntoView(selector)`, `mouseDown`/`mouseUp`, plus a pure `path(start, end, opts)` generator. Options cascade (`click` extends `move` and `scrollIntoView` options): `paddingPercentage`, `moveSpeed`, `moveDelay`, `randomizeMoveDelay`, `hesitate`, `waitForClick`, `overshootThreshold`, `scrollSpeed`, `scrollDelay`.
- **HumanCursor** (Python, Selenium): `WebCursor(driver)` with `move_to`, `click_on`, `drag_and_drop`, `move_by_offset`, `control_scroll_bar`, `scroll_into_view_of_element`; targets an element or `[x, y]`, `relative_position` within the element (0 to 1), `absolute_offset`, `steady`, `click_duration`.
- **puppeteer-humanize**: one verb, `typeInto(element, text, config)` with `mistakes` and `delays` blocks.
- Mapping to our schema: Claude's `computer` actions (`left_click` with `coordinate`, `hover`, `left_click_drag` with `start_coordinate`/`coordinate`, `scroll` with `scroll_direction`/`scroll_amount`, `type` with `text`) map onto a cursor object that keeps its last position (like ghost-cursor's `getLocation`) so each action starts from where the previous one ended, with timing options held as server-side defaults rather than exposed to the model.

## Proposed defaults (our synthesis, not source claims)

- Path: ghost-cursor style cubic Bezier (one-sided anchors, spread clamp 2 to 200 px) with points timed by a minimum-jerk profile, overshoot within 120 px only when distance is 500 px or more, then a short corrective move.
- Duration: `MT = a + b * log2(D/W + 1)`. No single authoritative pair exists (1030/96 vs 108/392 ms). We would pick a value to tune empirically; any choice is an assumption.
- Event rate: one `mouseMoved` per 16 ms (about 60 Hz) to match what pages see after rAF alignment; up to 100 Hz is within typical mouse rates.
- Hold and dwell: no research figures found; any default (for example key-hold-like 80 to 150 ms for clicks) is an assumption to flag.
- Typing: per-key `keyDown` (with `text`) then `keyUp`; IKI drawn from a right-skewed distribution with mean about 240 ms and floor about 60 ms, key hold about 116 ms (SD 24); longer pause after spaces; `Input.insertText` only for emoji, IME and characters with no key.
- Scroll: `mouseWheel` with `deltaY = 100` per tick (Windows default; macOS has no fixed figure), ticks spaced out rather than a single jump.
- Screenshots: `Page.captureScreenshot` on the attached tab (no documented rate limit, not tied to the active tab, but can hang on hidden tabs), downscaled to fit the model's limits with coordinates scaled back; `captureVisibleTab` as a fallback for the active tab only (2 calls/s).
- GIF: gifenc in the extension (small, documented speed advantage, MIT), or the `gif` crate in Rust if frames already flow to the server. gifski only if AGPL is acceptable.
