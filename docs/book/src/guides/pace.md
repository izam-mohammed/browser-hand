# pace and how input moves

`computer` sends input through Chrome's debugger protocol, so pages receive
trusted events, but shapes them like a hand:

- the cursor follows a curved path that slows into the target, with an
  overshoot on long moves;
- clicks are held for a moment;
- keys go down and up one at a time, with uneven gaps;
- the wheel turns in notches.

All of that takes human time. That is the point, and also why a long form
takes a while.

## making it faster

On the settings page, under **Input**:

| Setting | Effect |
| --- | --- |
| Pace | **Human** is the default. **Fast** keeps the same events without travel time. |
| Typing speed | Multiplies the gap between keys, 0.25 to 3.0. |
| Mouse speed | Scales how fast the cursor travels, 0.25 to 3.0. |

`BROWSER_HAND_PACE=fast` (or `human`) in a server's environment overrides
the page's pace for that server alone.

`form_input` skips the hand altogether: it sets a field's value instantly,
with the events a page expects. Claude uses it for selects, checkboxes and
dates, or when speed matters more than realism.

## batching

Because each action takes time, Claude sends predictable steps in one
`browser_batch` call (click a field, type, press Enter, screenshot). A batch
stops at the first error. Coordinates inside a batch refer to the screenshot
taken before it.

## the debugger bar

Reading tools never attach the debugger. Chrome's "started debugging this
browser" bar shows only while Claude is acting, and goes away 30 seconds
later. **Detach after idle** (5 to 600 seconds) changes that.
