// Proof only: a native messaging echo host. Logs the caller origin and every
// message (one JSON per line) to claims.log beside the binary, and acks each.
// Framing per docs/external/chrome-native-messaging.md § Wire framing.
use std::fs::OpenOptions;
use std::io::{self, Read, Write};

fn main() {
    let exe = std::env::current_exe().expect("exe path");
    let log_path = exe.with_file_name("claims.log");
    let mut log = OpenOptions::new().create(true).append(true).open(log_path).expect("log");
    let origin = std::env::args().nth(1).unwrap_or_default();
    writeln!(log, "{{\"type\":\"started\",\"origin\":\"{origin}\",\"pid\":{}}}", std::process::id()).ok();

    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    loop {
        let mut len = [0u8; 4];
        if stdin.read_exact(&mut len).is_err() {
            break; // Chrome closed the port
        }
        let mut body = vec![0u8; u32::from_ne_bytes(len) as usize];
        if stdin.read_exact(&mut body).is_err() {
            break;
        }
        log.write_all(&body).ok();
        log.write_all(b"\n").ok();

        let ack = br#"{"type":"ack"}"#;
        stdout.write_all(&(ack.len() as u32).to_ne_bytes()).ok();
        stdout.write_all(ack).ok();
        stdout.flush().ok();
    }
}
