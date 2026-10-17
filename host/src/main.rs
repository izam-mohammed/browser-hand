//! `browser-hand mcp`          the stdio MCP server Claude Code starts
//! `browser-hand native-host`  the native messaging host (Chrome starts it
//!                             with the extension origin as its only argument)
//! `browser-hand install`      writes the host manifest (`--uninstall` removes it)

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let first = args.first().map(String::as_str).unwrap_or("");

    // Chrome passes only "chrome-extension://<id>/" and no subcommand
    // (docs/external/chrome-native-messaging.md § How Chrome launches the host).
    let mode = if first.starts_with("chrome-extension://") { "native-host" } else { first };

    let result = match mode {
        "native-host" => runtime().block_on(browser_hand::native_host::main()),
        "mcp" => runtime().block_on(browser_hand::mcp::main()),
        "install" => browser_hand::install::main(args.iter().any(|a| a == "--uninstall")),
        _ => {
            eprintln!("usage: browser-hand mcp | native-host | install [--uninstall]");
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

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("tokio runtime")
}
