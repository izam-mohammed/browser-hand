# Rust local IPC and native messaging framing

Fetched: 17/10/2026 from https://docs.rs/tokio/latest/tokio/net/struct.UnixListener.html, https://docs.rs/tokio/latest/tokio/net/struct.UnixStream.html, https://crates.io/crates/interprocess/2.4.6 and its published sources (README.md, `src/local_socket.rs`, `src/local_socket/name/type.rs`, `examples/local_socket/tokio/listener.rs`), https://crates.io/crates/native_messaging/0.3.0 and its sources (README.md, `src/host.rs`), https://crates.io/crates/chrome_native_messaging, https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging, and the macOS SDK header `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/sys/un.h`.
Version: tokio 1.53.3 (13/10/2026), interprocess 2.4.6 (16/10/2026), native_messaging 0.3.0 (30/06/2026), chrome_native_messaging 0.3.0 (27/06/2022). Local test toolchain: rustc 1.98.0 on macOS (Darwin 25.5.0). `cargo search interprocess --limit 3` on 17/10/2026 returned `interprocess = "2.4.6"`.

## What this project uses

### tokio::net::UnixListener / UnixStream

Requires tokio feature `net` ("Available on Unix and crate feature net only").

```rust
pub fn bind<P>(path: P) -> Result<UnixListener> where P: AsRef<Path>
pub fn bind_addr(socket_addr: &SocketAddr) -> Result<UnixListener>
pub fn from_std(listener: std::os::unix::net::UnixListener) -> Result<UnixListener>
pub fn local_addr(&self) -> Result<SocketAddr>
pub async fn accept(&self) -> Result<(UnixStream, SocketAddr)>

pub async fn connect<P>(path: P) -> Result<UnixStream> where P: AsRef<Path>
pub fn into_split(self) -> (OwnedReadHalf, OwnedWriteHalf)
pub fn split<'a>(&'a mut self) -> (ReadHalf<'a>, WriteHalf<'a>)
pub fn peer_cred(&self) -> Result<UCred>
```

Example copied from the `UnixListener` page:

```rust
use tokio::net::UnixListener;

#[tokio::main]
async fn main() {
    let listener = UnixListener::bind("/path/to/the/socket").unwrap();
    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                println!("new client!");
            }
            Err(e) => { /* connection failed */ }
        }
    }
}
```

`accept` is documented as cancel safe (usable in `tokio::select!`). `peer_cred` "Returns effective credentials of the process which called `connect` or `pair`", useful for checking the peer UID.

### macOS `sun_path` limit

macOS SDK `sys/un.h`: `char sun_path[104];`. The path must also hold the terminating NUL, so the longest usable path is 103 bytes.

Local test on 17/10/2026 with `std::os::unix::net::UnixListener::bind` (tokio's `bind` was not tested separately):

```
len=103 -> Ok
len=104 -> Err(InvalidInput, "path must be shorter than SUN_LEN")
```

Consequence for `$TMPDIR`: on the test machine `$TMPDIR` is `/var/folders/k2/xrxrq24j7p52q065r5nssdpc0000gn/T/`, which is 49 bytes. That leaves 54 bytes for the rest of the path. A name like `$TMPDIR/browser-hand/<uuid-v4>.sock` (49 + 13 + 36 + 5 = 103) is right at the limit. Keep socket file names short, or use a short fixed base such as `/tmp/` with per-user permissions. Whether every macOS user's `$TMPDIR` has the same length: not stated by any source checked.

Linux `sun_path` is 108 bytes per interprocess docs ("maximum length of 107 bytes" for abstract names). Not verified on a Linux machine.

### interprocess (cross-platform local sockets)

- Licence `0BSD OR Apache-2.0`, MSRV 1.75, feature `tokio` (off by default) "enables the Tokio variants of IPC primitives".
- README maintenance badge: "maintenance-passive". Releases continue (2.4.3 01/08/2026, 2.4.4 03/09/2026, 2.4.5 10/10/2026, 2.4.6 16/10/2026).
- Explicit support (CI-tested): "Windows, Linux, macOS".
- Windows: "Windows only using named pipe based local sockets and Unix only using Unix-domain socket based local sockets".
- "Interprocess never inserts its own message framing or any other type of metadata into the stream", so a non-Rust peer can talk to it with the same name type.
- Name types: `GenericFilePath` (Unix: plain filesystem path; Windows: only paths starting `\\.\pipe\`). `GenericNamespaced` (Windows: prepends `\\.\pipe\`; Linux: abstract namespace, max 107 bytes; "Other Unices": "Resolves to filesystem paths by prepending `/tmp/`"). On macOS `GenericNamespaced` therefore lands in `/tmp/`, not `$TMPDIR`.
- Too-long names return an error: "local socket name length exceeds capacity of sun_path of sockaddr_un".

Example (trimmed) from `examples/local_socket/tokio/listener.rs`:

```rust
use interprocess::local_socket::{
    tokio::{prelude::*, Stream},
    GenericNamespaced, ListenerOptions,
};

let printname = "example.sock";
let name = printname.to_ns_name::<GenericNamespaced>()?;
let listener = ListenerOptions::new().name(name).create_tokio()?;
loop {
    let conn = listener.accept().await?;
    tokio::spawn(async move { /* handle_conn(conn) */ });
}
```

### Native messaging framing

Chrome docs: "each message is serialized using JSON, UTF-8 encoded and is preceded with 32-bit message length in native byte order." Limits: "The maximum size of a single message from the native messaging host is 1 MB"; "The maximum size of the message sent to the native messaging host is 64 MiB."

Crates:

| Crate | Version | Last release | Status |
| - | - | - | - |
| `native_messaging` (github.com/IberAI/native-messaging) | 0.3.0 | 30/06/2026 | Active in 2025 to 2026 (0.1.1 10/11/2024 to 0.3.0). Framing, Tokio host loop, manifest installer. About 91 thousand downloads. |
| `chrome_native_messaging` (github.com/neon64/chrome-native-messaging) | 0.3.0 | 27/06/2022 | No release since 2022. |

`native_messaging` 0.3.0 API (`src/host.rs`): `MAX_TO_BROWSER: usize = 1_048_576`, `MAX_FROM_BROWSER: usize = 64 * 1_048_576`, `encode_message<T: Serialize>(&T) -> Result<Vec<u8>, NmError>`, `decode_message<R: Read>(&mut R, max_size) -> Result<String, NmError>`, `send_json`, `recv_json`, async `get_message()`, `send_message(&T)`, `event_loop(handler)`. Framing-only use: `native_messaging = { version = "0.3", default-features = false }`. Its README states the format as "a 4-byte unsigned length prefix in native byte order followed by that many bytes of UTF-8 JSON".

Whether hand-rolled framing is "the norm": no official source says so. The format is a 4-byte length plus JSON, roughly 20 lines with `u32::from_ne_bytes` / `to_ne_bytes` and `read_exact`; the one maintained crate is a small community project, not an official Chrome or Rust crate.

## Errors

- tokio `bind`, `bind_addr`, `from_std`, `connect`: "This function panics if it is not called from within a runtime with IO enabled."
- tokio `from_std`: "The caller is responsible for ensuring that the listener is in non-blocking mode."
- Path too long (std): `InvalidInput`, "path must be shorter than SUN_LEN".
- Stale socket file: local test showed the socket file still exists after the listener is dropped, and a second `bind` to the same path fails with `AddrInUse`. Delete the file before binding (after checking no live server answers) and on shutdown. interprocess deletes the file on drop by default and offers `.try_overwrite(true)`; its example comment calls the leftover file a "corpse socket".
- `native_messaging`: errors are `NmError` (variants not listed here).

## Limits

- macOS `sun_path`: 104 bytes including NUL, 103 usable (verified locally).
- Native messaging: 1 MB host to Chrome, 64 MiB Chrome to host (Chrome docs). A base64 screenshot over 1 MB cannot be sent in one message from host to extension; in this design screenshots flow extension to host, which has the 64 MiB limit.
- interprocess Windows named pipe buffer sizes: not stated in the sections read.

## Gotchas

- `$TMPDIR` on macOS is long and per-user; the socket path budget is tight. Prefer short names.
- tokio does not remove the socket file on drop (std behaviour verified; tokio docs are silent). Clean up yourself.
- Native byte order, not big-endian, for the native messaging length prefix.
- Native host stdout is the protocol channel; Chrome docs: "If you want to print some data for debugging purposes, write to `stderr`." The same binary also serves MCP over stdout, so each mode must keep stdout pure for its own protocol.
- On Windows Chrome passes `--parent-window=<decimal handle value>` as an extra argument; the first argument is the caller's origin. A dual-mode binary must not mistake these for its own subcommands.
