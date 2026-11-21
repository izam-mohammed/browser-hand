# choosing a profile

Claude works in one Chrome profile per session. `list_profiles` shows each
profile's name and directory (`Default`, `Profile 3`) and whether its
extension is connected right now.

```text
Work       Default     connected
Personal   Profile 3   not open
```

## how Claude picks

- You name one ("my work Chrome", "Profile 3"): `select_profile` with that
  name or dir.
- You do not, and several are connected: Claude asks, one option per
  profile. It never picks for you.
- Exactly one is connected: it uses that one.

## a profile that is not open

`select_profile` opens it with Chrome's command line, starting Chrome if
needed, and waits for the extension to connect. If the extension does not
answer, it was never loaded in that profile: see
[getting started](../getting-started.md) step 2.

## a default profile

The settings page has **Default profile**, used when Claude is not told
which one to drive. Empty means ask each time. It is the key
`sessions.default_profile` in the [settings](../reference/settings.md).

## tabs

Each session works in its own `browser-hand` tab group in the selected
profile, in your current window unless you turn on **Open a new window**.
Claude closes tabs it made when it finishes unless you want them kept, or
you turn on **Close tabs when the session ends**.
