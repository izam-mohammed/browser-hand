# the audit log

A file that says what Claude did, for when you want to look back. Off by
default: turn on **Write the audit log** on the settings page, under
**Audit log**.

Each thing Claude does in the browser adds one line to `audit.jsonl`, in the
browser-hand settings folder (`~/.config/browser-hand/` on Linux and macOS),
or in the file you name:

```json
{"t":1795184865886,"tool":"navigate","tab":125621221,"host":"example.com","ok":true,"ms":139}
{"t":1795184867276,"tool":"wait_for","tab":125621221,"ok":false,"err":"timeout","ms":1029}
{"t":1795184868001,"tool":"computer","action":"left_click","tab":125621221,"ok":true,"ms":412}
```

`t` is milliseconds since 1970, `ms` how long the call took. A `navigate`
line carries the host only. A failed call carries its error code.

## what is never in it

No path, no query string, nothing typed, no value, no text from a page and
no file name. The line is the tool, the action word, the tab, the host of a
navigation, the result and the time. Only your user can read the file (mode
`0600`, in a folder only you can enter).

Read it with `jq`:

```sh
jq -r 'select(.ok == false) | [.tool, .err] | @tsv' ~/.config/browser-hand/audit.jsonl
```

browser-hand never trims the file; delete it when you like. If it cannot be
written, the call still runs and the server prints one warning.
