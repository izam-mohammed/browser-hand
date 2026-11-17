//! `browser-hand reload`: asks the extension in every connected Chrome
//! profile to reload itself from disk, so a new build takes effect without a
//! click per profile on chrome://extensions. Each host passes the `reload`
//! frame on; the extension calls `chrome.runtime.reload()`, its port closes,
//! and Chrome starts a fresh host when the new code connects again.

use std::collections::HashSet;
use std::path::Path;
use std::time::{Duration, Instant};

use crate::profiles::{self, LiveHost};
use crate::wire::{self, Frame};

const PROBE_WAIT: Duration = Duration::from_secs(2);
const BACK_WITHIN: Duration = Duration::from_secs(15);

/// Sends `reload` to one host.
pub async fn ask(path: &Path) -> std::io::Result<()> {
    let mut stream = crate::ipc::connect(path).await?;
    wire::write_frame(&mut stream, &Frame::Reload {}).await
}

/// Reloads every connected profile and waits for each to come back with a
/// new host. Returns the profile dirs asked and those back in time.
pub async fn reload_all(
    socket_dir: &Path,
    back_within: Duration,
) -> (Vec<String>, HashSet<String>) {
    let before = profiles::discover(socket_dir, PROBE_WAIT).await;
    let old: HashSet<String> = before.iter().map(|h| h.hello.instance.clone()).collect();
    let mut asked = vec![];
    for LiveHost { path, hello } in &before {
        let Some(dir) = hello.profile_dir.clone() else {
            continue;
        };
        if ask(path).await.is_ok() {
            asked.push(dir);
        }
    }

    let mut back = HashSet::new();
    let deadline = Instant::now() + back_within;
    while back.len() < asked.len() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(250)).await;
        for h in profiles::discover(socket_dir, PROBE_WAIT).await {
            if old.contains(&h.hello.instance) {
                continue;
            }
            if let Some(dir) = h.hello.profile_dir {
                if asked.contains(&dir) {
                    back.insert(dir);
                }
            }
        }
    }
    (asked, back)
}

pub async fn main() -> anyhow::Result<()> {
    let (asked, back) = reload_all(&crate::paths::socket_dir(), BACK_WITHIN).await;
    if asked.is_empty() {
        println!("No Chrome profile has browser-hand connected; nothing to reload.");
        return Ok(());
    }
    for line in report(&asked, &back, BACK_WITHIN) {
        println!("{line}");
    }
    Ok(())
}

/// One line per profile asked: reloaded, or not back in time.
pub fn report(asked: &[String], back: &HashSet<String>, back_within: Duration) -> Vec<String> {
    asked
        .iter()
        .map(|dir| {
            if back.contains(dir) {
                format!("{dir}: reloaded")
            } else {
                format!(
                    "{dir}: asked to reload, not back within {} s; an extension built before \
                     this command ignores it, so reload it once on chrome://extensions",
                    back_within.as_secs()
                )
            }
        })
        .collect()
}
