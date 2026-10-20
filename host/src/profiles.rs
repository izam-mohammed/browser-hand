//! Chrome profiles from `Local State`, and which of them have a live host
//! (`docs/external/chrome-profiles-and-launch.md` § `Local State`).

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Context;
use serde::Serialize;
use serde_json::Value;

use crate::host_conn::{self, HelloInfo};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// The directory name Chrome uses (`Default`, `Profile 3`).
    pub dir: String,
    /// The name the user gave the profile.
    pub name: String,
    /// Chrome's last used profile.
    pub last_used: bool,
}

/// Chrome's user data dir. `BROWSER_HAND_CHROME_DIR` overrides it (tests).
pub fn chrome_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("BROWSER_HAND_CHROME_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var_os("HOME").unwrap_or_default();
    PathBuf::from(home).join("Library/Application Support/Google/Chrome")
}

/// Profiles listed in `<chrome_dir>/Local State`, in Chrome's own order when
/// it records one. Email addresses are not read out.
pub fn read_profiles(chrome_dir: &Path) -> anyhow::Result<Vec<Profile>> {
    let path = chrome_dir.join("Local State");
    let text =
        std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    let state: Value =
        serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))?;
    let profile = &state["profile"];
    let last_used = profile["last_used"].as_str().unwrap_or("Default");
    let Some(cache) = profile["info_cache"].as_object() else {
        anyhow::bail!("{} has no profile.info_cache", path.display());
    };

    let order: Vec<&str> = profile["profiles_order"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut dirs: Vec<&String> = cache.keys().collect();
    dirs.sort_by_key(|d| {
        (
            order.iter().position(|o| o == d).unwrap_or(usize::MAX),
            d.to_string(),
        )
    });

    Ok(dirs
        .into_iter()
        .filter(|d| !cache[d.as_str()]["is_ephemeral"].as_bool().unwrap_or(false))
        .map(|d| Profile {
            dir: d.clone(),
            name: cache[d.as_str()]["name"].as_str().unwrap_or(d).to_owned(),
            last_used: d == last_used,
        })
        .collect())
}

/// A host socket that answered with a hello.
#[derive(Debug, Clone)]
pub struct LiveHost {
    pub path: PathBuf,
    pub hello: HelloInfo,
}

/// Every host socket in `dir` that answers within `wait`. Sockets nobody is
/// listening on are left over from killed hosts and are removed.
pub async fn discover(dir: &Path, wait: Duration) -> Vec<LiveHost> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let paths: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "sock"))
        .collect();

    let probes = paths.into_iter().map(|path| async move {
        match host_conn::probe(&path, wait).await {
            Ok(hello) => Some(LiveHost { path, hello }),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::ConnectionRefused {
                    let _ = std::fs::remove_file(&path);
                }
                None
            }
        }
    });
    let mut live: Vec<LiveHost> = futures_join_all(probes)
        .await
        .into_iter()
        .flatten()
        .collect();
    live.sort_by(|a, b| a.path.cmp(&b.path));
    live
}

async fn futures_join_all<F>(futures: impl IntoIterator<Item = F>) -> Vec<F::Output>
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    let handles: Vec<_> = futures.into_iter().map(tokio::spawn).collect();
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        if let Ok(v) = h.await {
            out.push(v);
        }
    }
    out
}

/// Finds a profile by its dir (exact) or its name (any case).
pub fn resolve<'a>(profiles: &'a [Profile], wanted: &str) -> Option<&'a Profile> {
    let wanted = wanted.trim();
    profiles
        .iter()
        .find(|p| p.dir == wanted)
        .or_else(|| {
            profiles
                .iter()
                .find(|p| p.name.eq_ignore_ascii_case(wanted))
        })
        .or_else(|| profiles.iter().find(|p| p.dir.eq_ignore_ascii_case(wanted)))
}
