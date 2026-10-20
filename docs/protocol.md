# browser-hand wire protocol

Protocol version: **1**. Owner: this repository. Authoritative types:
`host/src/wire.rs`; the extension's types are generated from it into
`extension/src/wire.gen.ts` by `cargo test` (`docs/external/ts-rs.md`).
Fixtures both sides test against: `host/tests/fixtures/frames.json` and
`host/tests/fixtures/chunked-call.json`.

## Who talks to whom

```text
Claude Code --stdio MCP--> browser-hand mcp --unix socket--> browser-hand (native host) --native port--> extension
```

- Chrome starts one native host per profile's extension connection. The
  host listens on `<per-user temp dir>/bh/<pid>.sock` (directory `0700`).
- An MCP server connects to as many host sockets as it needs; several MCP
  servers may share one host.

## Framing

Every frame on the socket is a little-endian `u32` byte length followed by
that many bytes of UTF-8 JSON. Chrome's native port uses the same framing in
native byte order (`docs/external/chrome-native-messaging.md` § Wire framing);
the build refuses big-endian targets. Frames above 64 MiB are refused.

## Frames

```text
call     {"type":"call","id":u64,"session":"<uuid>","tool":"<name>","args":{...}}
result   {"type":"result","id":u64,"ok":true,"content":[Content...]}
         {"type":"result","id":u64,"ok":false,"error":{"code":"<code>","message":"..."}}
Content  {"type":"text","text":"..."}
         {"type":"image","data":"<base64>","mimeType":"image/png","imageId":"<id>"}
hello    {"type":"hello","protocol":1,"profileDir":"<dir>"|null,"extensionVersion":"x.y.z","instance":"<uuid>"}
claimed  {"type":"claimed","profileDir":"<dir>","nonce":"<n>"}
chunk    {"type":"chunk","id":u64,"seq":u32,"last":bool,"data":"<base64>"}
end      {"type":"end","session":"<uuid>"}
settings        {"type":"settings","settings":{...},"revision":"<mtime ns>","path":"<abs>",
                 "profiles":[{"dir","name"}],"warnings":["<key>: ..."]}
settings_set    {"type":"settings_set","id":u64,"settings":{...},"revision":"<base>"}
settings_saved  {"type":"settings_saved","id":u64,"ok":bool,"path"?:"<abs>",
                 "error"?:{"field":"<key>"|null,"message":"..."}}
```

`settings` holds `config.toml`'s keys (`plans/06-settings.md` § Contract),
typed as `Settings` in `host/src/config.rs`.

`imageId` is optional. Unknown frame types are rejected as invalid and
skipped; the stream continues.

## Flows

- **Connect.** The extension sends `hello` (its `profileDir` once claimed,
  else `null`) when its port opens. The host answers each socket client with
  a `hello` at once, using the extension's fields and the host's own
  `instance`, and sends a fresh `hello` to every client when they change.
- **Claim.** `claim.html#dir=<dir>&nonce=<n>` opened in a profile makes the
  extension store `dir` and send `claimed`, then a new `hello`. The host
  forwards `claimed` to its clients.
- **Call.** A client sends `call`; the host gives it a host-wide id, forwards
  it, and returns the `result` to that client under the client's own id.
- **Settings.** The host sends `settings` to the extension after each
  `hello` from it and whenever `config.toml` changes on disk (it looks every
  2 s). The settings page sends `settings_set` through the service worker;
  the host saves it unless a value is refused or the file's revision is no
  longer the one the page edited ("changed in another profile"), answers
  `settings_saved` with the same `id`, then sends `settings` again.
  `settings_set` is taken only from Chrome's port: a socket client's is
  dropped, so no MCP server can change the settings.
- **End.** When a client disconnects, the host sends `end` for every session
  that client used, so the extension forgets its tab groups. Tabs stay open.

## Chunking

Chrome closes the port on any host message above 1,048,576 bytes
(`docs/external/chrome-native-messaging.md` § Limits). A host-to-extension
frame whose JSON is longer than that is sent as `chunk` frames: the
standard base64 of the whole JSON body, cut into pieces of at most 786,432
characters, `seq` from 0, `last` on the final piece, `id` the carried frame's
id. The receiver rejoins them in order and parses the result as a frame; a
piece out of order drops the frame. Extension-to-host frames are never
chunked (Chrome allows 64 MiB that way).

## Errors

`not_connected`, `no_tab`, `debugger_refused`, `timeout`, `bad_args`,
`page_error`, `blocked` (the tab's site is blocked, or read-only for an
acting tool, in the settings: "<host> is blocked in browser-hand settings;
ask the person.").

## Compatibility

`protocol` is bumped on any breaking change. A client that reads a `hello`
with a different `protocol` treats the host as `not_connected` and says why.
Adding an optional field or a new tool is not breaking.

Tools added since protocol 1 shipped, each an ordinary `call` (none needs a
new frame):

- `recording_list` `{}`: the extension answers
  `{"recordings":[{id,title,startedAt,stoppedAt,steps,stopReason?}],"recording":"<id>"|null}`,
  newest first.
- `recording_get` `{id?}`: the stored recording,
  `{id,title,startedAt,stoppedAt,windowId,flow:UserFlow,meta:[{ts,tabId,actor,masked?,unrecorded?}]}`
  (`plans/05-record-steps.md` § Contract). The MCP server renders it as
  text or as the `UserFlow` alone.
- `recording_delete` `{id}`.
- `replay_step` `{tabId,step,pace}`: one `UserFlow` step acted out in a
  tab of the session's group; the MCP server's `recording_replay` sends
  them one at a time.
- An extension of protocol 1 without these answers `bad_args` "Unknown
  tool".

Frames added since protocol 1 shipped: `settings`, `settings_set` and
`settings_saved` (`plans/06-settings.md`). Peers that predate them skip
them as unknown, so `protocol` stays 1: an older host never answers
`settings_set` and never sends `settings`, which the settings page shows as
"Not connected" with the host named older than the extension. `computer`
and `replay_step` carry `pace` only when the MCP server has
`BROWSER_HAND_PACE` set; without it the extension uses the settings'
pace.
