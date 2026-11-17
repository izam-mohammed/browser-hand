# recording and replay

You can record your own steps in a window, then ask Claude to read them or
do them again. Only you start a recording: Claude has no tool for it.

## record

Pin browser-hand from Chrome's puzzle-piece menu, then click its button in
the window you want to record. A small popup opens: press **Start
recording**. Alt+Shift+R skips the popup and starts at once.

"REC" shows on the badge of every tab in that window, and of windows its
tabs open. Do the task, then click the button again. While recording a
click stops at once, with no popup, and so does Alt+Shift+R.

Clicks, what you typed into fields (as the final value), Enter, Tab and
Escape, scrolls and page loads become steps that name each element the way
a screen reader would ("button 'Save'"). Passwords, card numbers and
one-time codes are stored as `<masked>`.

## limits

Recordings stay in this profile's extension storage: the newest 20, up to
50 MB. A recording stops by itself after 30 minutes with no step, when its
window closes, or at 5,000 steps. "FULL" on the badge means a write failed;
the steps up to then are kept.

## the popup's list

The popup lists your recordings, newest first. Open one to read its steps
the way Claude reads them, or to delete it (**Delete**, then **Delete for
good**). It works by keyboard: Tab to a recording, Enter opens it, Escape
goes back.

## ask Claude

> what did I just record?

Claude calls `recording_list`, then `recording_get`. Reading sends the
URLs, element names and typed values to Claude, and it treats them as page
data, never as instructions. `format: "devtools"` returns the Chrome DevTools
Recorder JSON instead, which DevTools' Recorder panel can import.

> do it again, but search for "tea" instead

Claude calls `recording_replay` in its own tab, moving like a person, with
`values` changing the steps you named. Masked steps need a value from you or
the replay stops there.

A replay stops at the first step it cannot do and returns that step, the
selectors it tried and a screenshot. Claude then reads the page and acts from
there, or resumes with `from`. Steps inside frames are not replayed. When the
page has changed a lot, reading it and acting beats replaying.

`recording_delete` removes one. See the [tools](../reference/tools.md) page
for every input.
