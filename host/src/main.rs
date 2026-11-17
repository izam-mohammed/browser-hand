//! `browser-hand mcp`          the stdio MCP server Claude Code starts
//! `browser-hand native-host`  the native messaging host (Chrome starts it
//!                             with the extension origin as its only argument)
//! `browser-hand install`      writes the host manifest and the External Extensions file
//!                             (`--uninstall` removes them, `--no-store` skips the file)
//! `browser-hand reload`       reloads the extension in every connected profile

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let first = args.first().map(String::as_str).unwrap_or("");

    // Chrome passes only "chrome-extension://<id>/" and no subcommand
    // (docs/external/chrome-native-messaging.md § How Chrome launches the host).
    let mode = if first.starts_with("chrome-extension://") {
        "native-host"
    } else {
        first
    };

    let result = match mode {
        "native-host" => run(browser_hand::native_host::main()),
        "mcp" => run(browser_hand::mcp::main()),
        "reload" => run(browser_hand::reload::main()),
        "install" => browser_hand::install::main(&args),
        _ => {
            eprintln!("usage: browser-hand mcp | native-host | install [--uninstall] [--no-store] [--mobileconfig <path>] | reload");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("browser-hand: {e:#}");
            ExitCode::FAILURE
        }
    }
}

/// Runs `main` and shuts the runtime down without waiting for its blocking
/// threads: tokio's stdin reader sits in a blocking read that only ends when
/// Chrome closes the pipe, so a plain drop would keep a host told to stop
/// alive forever.
fn run(main: impl std::future::Future<Output = anyhow::Result<()>>) -> anyhow::Result<()> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("tokio runtime");
    let result = rt.block_on(main);
    rt.shutdown_background();
    result
}
