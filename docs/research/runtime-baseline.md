# Runtime baseline for the native host

Gathered: 17/10/2026, on this Mac (Darwin 25.5.0, Apple Silicon), Chrome
155.0.8059.80, rustc from cargo 1.98.0, Node 24.9.0, Bun 1.3.9.

Chrome starts one native host process per `runtime.connectNative()` port
(`docs/external/chrome-native-messaging.md` § How Chrome launches the host),
so with the extension in three profiles three host processes sit idle for as
long as Chrome runs. The cost that matters is the idle footprint of one
process that reads stdin and waits.

## Method

A program that blocks on one read from stdin and exits, in each runtime, run
three times with `/usr/bin/time -l sh -c 'printf x | <program>'`.

- Rust: `fn main(){ let mut b=[0u8;4]; let _=std::io::stdin().read(&mut b); }`
  built with `rustc -O`.
- Node and Bun: `process.stdin.once("data",()=>process.exit(0))`.

## Result

| Runtime | Max resident set size (three runs) | Wall time, warm runs |
| --- | --- | --- |
| Rust (release) | 2,015,232 bytes each run | 0.00 to 0.01 s |
| Bun 1.3.9 | 27,901,952 to 27,918,336 bytes | 0.01 s |
| Node 24.9.0 | 46,170,112 to 46,333,952 bytes | 0.01 to 0.02 s |

The first run of each was slower (0.56 s Rust, 0.10 s Node, 0.11 s Bun):
cold disk cache, not the runtime. Wall times at this resolution do not
separate the runtimes; memory does, by a factor of about 14 (Bun) and 23
(Node) over Rust.

## Limits of this measurement

An empty program, not the real host: the real host adds a tokio runtime, a
socket listener and JSON parsing, which will raise the Rust figure. Phase 3
of `plans/plan-bridge.md` records the real host's idle RSS as the baseline.

## The real host, 17/10/2026

`browser-hand` release build (1,508,224 bytes) started as Chrome starts it
(`browser-hand chrome-extension://x/`), stdin held open, one client connected
to its socket for 1.5 s, then `ps -o rss=`: **2,288 KB**. The tokio runtime
(two worker threads), the socket listener and the relay added under 300 KB
over the empty program above. When stdin closed, the host exited and its
socket file was gone.
