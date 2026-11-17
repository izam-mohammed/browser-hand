# Windows: registry host key, named pipes, data dirs

Fetched: 17/11/2026 from https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging, https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging, https://code.claude.com/docs/en/chrome, https://docs.rs/tokio/latest/tokio/net/windows/named_pipe/struct.ServerOptions.html, https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights, Chromium `chrome/browser/process_singleton_win.cc` at main, https://github.com/keepassxreboot/keepassxc-browser/wiki/Troubleshooting-guide (Vivaldi key, third party).
Nothing here was run on Windows: no Windows machine was available. `cargo check --target x86_64-pc-windows-gnu` was the only compile proof.

## Native messaging host registration

- Chrome: "set the default value of that key to the full path to the manifest file", key `HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\<name>` (or `HKEY_LOCAL_MACHINE`). The manifest "can be anywhere on disk". The 32-bit registry is queried first, then the 64-bit one. Chrome also passes `--parent-window=<decimal handle>` after the origin argument.
- Edge: `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\<name>`, HKCU before HKLM; with no Edge entry Edge falls back to the Chromium and Chrome keys.
- Claude Code's own docs: "on Windows each browser has its own registry key, such as `HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\`".
- Vivaldi: `HKCU\Software\Vivaldi\NativeMessagingHosts\` per a third-party wiki (keepassxc-browser). Not confirmed by Vivaldi. Chromium: `HKCU\Software\Chromium\NativeMessagingHosts` by the same branding pattern (unverified).
- The docs say stdio must be binary mode (`O_BINARY`), because text mode turns `\n` into `\r\n`. That is a C runtime rule; Rust's `std::io::stdin`/`stdout` do no newline translation on a pipe.

## Named pipes (tokio)

- `tokio::net::windows::named_pipe` (feature `net`, already enabled): `ServerOptions::new().first_pipe_instance(true).reject_remote_clients(true)` (remote clients are rejected by default); `pub unsafe fn create_with_security_attributes_raw(&self, addr, attrs: *mut c_void) -> Result<NamedPipeServer>`; `ClientOptions::new().open(name)`. A server instance serves one client; accepting is `connect().await`, then a new instance is created for the next client.
- Microsoft: with a NULL descriptor the default DACL "grant[s] full control to the LocalSystem account, administrators, and the creator owner. They also grant read access to members of the Everyone group and the anonymous account." So the default lets other users read what a pipe sends; an explicit DACL is needed.
- Claude Code itself uses named pipes on Windows (its troubleshooting page names "Named pipe conflicts (EADDRINUSE)").
- Pipes live in `\\.\pipe\` and vanish when the server process dies, so no stale entry needs removing. `std::fs::read_dir(r"\\.\pipe\")` lists them (common practice; not in Microsoft's docs).

## Browser data dirs (`%LOCALAPPDATA%` is the base)

Chrome `Google\Chrome\User Data`, Chromium `Chromium\User Data`, Edge `Microsoft\Edge\User Data`, Brave `BraveSoftware\Brave-Browser\User Data`, Vivaldi `Vivaldi\User Data`. (Chromium's user data directory page; Vivaldi's from its docs and installs, unverified here.)

## Browser running test

Chromium opens `<user data dir>\lockfile` with `GENERIC_WRITE`, `FILE_SHARE_READ`, `CREATE_ALWAYS`, `FILE_FLAG_DELETE_ON_CLOSE`; a second opener for write gets `ERROR_SHARING_VIOLATION` (32). So a write open of that file that fails with 32 means the browser runs; not found means it does not.
