//! Proof only: `toml` 1.1.8 reads the Contract's `config.toml`
//! (plans/06-settings.md), writes it back with `to_string_pretty` and reads
//! that again to the same value, and a broken file's error names its line
//! and column. See scripts/prove/config-toml.sh.

use serde::{Deserialize, Serialize};

const CONTRACT: &str = r#"# Written by the browser-hand settings page. Edits here apply too.
version = 1
[input]
pace = "human"          # or "fast"
typing_speed = 1.0      # 0.25 to 3.0, multiplies the gap between keys
mouse_speed = 1.0       # 0.25 to 3.0, multiplies the cursor's travel time
[sessions]
default_profile = ""    # a Chrome profile dir; "" asks
new_window = true
close_tabs_on_end = false
[sites]
blocked = []            # each list: 200 patterns, 100 characters each
read_only = []
[capture]
screenshot_size = "1280x800"   # or "1024x640", "1568x980"
screenshot_quality = 80        # 30 to 100
gif_folder = "~/Downloads/browser-hand"
gif_frame_delay_ms = 700       # 100 to 5000
[debugger]
detach_after_idle_s = 30       # 5 to 600
"#;

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Config {
    version: u32,
    input: Input,
    sessions: Sessions,
    sites: Sites,
    capture: Capture,
    debugger: Debugger,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Input {
    pace: String,
    typing_speed: f64,
    mouse_speed: f64,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Sessions {
    default_profile: String,
    new_window: bool,
    close_tabs_on_end: bool,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Sites {
    blocked: Vec<String>,
    read_only: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Capture {
    screenshot_size: String,
    screenshot_quality: u32,
    gif_folder: String,
    gif_frame_delay_ms: u32,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Debugger {
    detach_after_idle_s: u32,
}

fn main() {
    let mut first: Config = toml::from_str(CONTRACT).expect("the Contract's file parses");
    first.sites.blocked = vec!["*.bank.com/*".into(), "hr.example.com/*".into()];
    let written = toml::to_string_pretty(&first).expect("serialises");
    let again: Config = toml::from_str(&written).expect("its own output parses");
    assert_eq!(first, again, "round trip changed the value");
    println!("round trip: ok, {} bytes written", written.len());
    println!("--- written\n{written}---");

    let broken = "version = 1\n[input]\npace = \"human\n";
    match toml::from_str::<toml::Table>(broken) {
        Ok(_) => {
            println!("FAIL: a broken file parsed");
            std::process::exit(1);
        }
        Err(e) => {
            let span = e.span().map(|s| format!("{}..{}", s.start, s.end)).unwrap_or_else(|| "none".into());
            println!("parse error (span {span}):\n{e}");
        }
    }
    let wrong_type = "version = 1\n[input]\ntyping_speed = \"fast\"\n";
    match toml::from_str::<Config>(wrong_type) {
        Ok(_) => println!("FAIL: a string typing_speed parsed"),
        Err(e) => println!("type error:\n{e}"),
    }
    println!("PASS: toml 1.1.8 round-trips the Contract's file and reports line and column");
}
