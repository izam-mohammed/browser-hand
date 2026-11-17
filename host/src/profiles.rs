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
    /// What `select_profile` takes: `dir`, or `<browser>:<dir>` when more
    /// than one browser is installed.
    pub id: String,
    /// The browser's key in `BROWSERS` (`chrome`, `brave`).
    pub browser: String,
    /// The browser's user data dir.
    #[serde(skip)]
    pub root: PathBuf,
    /// The name the user gave the profile.
    pub name: String,
    /// Chrome's last used profile.
    pub last_used: bool,
}

/// The systems the host knows paths for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Mac,
    Linux,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else {
            Os::Linux
        }
    }
}

/// A Chromium browser: where it keeps its data and how it is started.
pub struct Browser {
    pub key: &'static str,
    pub name: &'static str,
    /// Under `~/Library/Application Support/`.
    pub mac_dir: &'static str,
    /// Under `~/.config/`.
    pub linux_dir: &'static str,
    /// The app name `open -na` takes.
    pub mac_app: &'static str,
    /// Binary names looked up on `PATH`, in order.
    pub linux_bins: &'static [&'static str],
}

/// The fixed table of browsers. Dirs are built from `$HOME` only.
pub const BROWSERS: &[Browser] = &[
    Browser {
        key: "chrome",
        name: "Google Chrome",
        mac_dir: "Google/Chrome",
        linux_dir: "google-chrome",
        mac_app: "Google Chrome",
        linux_bins: &["google-chrome-stable", "google-chrome", "chromium"],
    },
    Browser {
        key: "chromium",
        name: "Chromium",
        mac_dir: "Chromium",
        linux_dir: "chromium",
        mac_app: "Chromium",
        linux_bins: &["chromium", "chromium-browser"],
    },
    Browser {
        key: "edge",
        name: "Microsoft Edge",
        mac_dir: "Microsoft Edge",
        linux_dir: "microsoft-edge",
        mac_app: "Microsoft Edge",
        linux_bins: &["microsoft-edge-stable", "microsoft-edge"],
    },
    Browser {
        key: "brave",
        name: "Brave",
        mac_dir: "BraveSoftware/Brave-Browser",
        linux_dir: "BraveSoftware/Brave-Browser",
        mac_app: "Brave Browser",
        linux_bins: &["brave-browser", "brave-browser-stable", "brave"],
    },
    Browser {
        key: "vivaldi",
        name: "Vivaldi",
        mac_dir: "Vivaldi",
        linux_dir: "vivaldi",
        mac_app: "Vivaldi",
        linux_bins: &["vivaldi-stable", "vivaldi"],
    },
];

pub fn browser(key: &str) -> Option<&'static Browser> {
    BROWSERS.iter().find(|b| b.key == key)
}

/// `b`'s user data dir under `home`.
pub fn data_dir(os: Os, home: &Path, b: &Browser) -> PathBuf {
    match os {
        Os::Mac => home.join("Library/Application Support").join(b.mac_dir),
        Os::Linux => home.join(".config").join(b.linux_dir),
    }
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}

/// Chrome's user data dir. `BROWSER_HAND_CHROME_DIR` overrides it (tests).
pub fn chrome_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("BROWSER_HAND_CHROME_DIR") {
        return PathBuf::from(dir);
    }
    data_dir(Os::current(), &home(), &BROWSERS[0])
}

/// One browser's user data dir.
#[derive(Debug, Clone, PartialEq)]
pub struct Root {
    pub browser: &'static str,
    pub dir: PathBuf,
}

/// Every table browser whose data dir exists under `home`.
pub fn installed_roots(os: Os, home: &Path) -> Vec<Root> {
    BROWSERS
        .iter()
        .map(|b| Root {
            browser: b.key,
            dir: data_dir(os, home, b),
        })
        .filter(|r| r.dir.is_dir())
        .collect()
}

/// The browsers to use: `BROWSER_HAND_CHROME_DIR` alone when set, else every
/// installed one, else Chrome's (so the error names its path).
pub fn roots() -> Vec<Root> {
    let found = if std::env::var_os("BROWSER_HAND_CHROME_DIR").is_some() {
        vec![]
    } else {
        installed_roots(Os::current(), &home())
    };
    if found.is_empty() {
        vec![Root {
            browser: "chrome",
            dir: chrome_dir(),
        }]
    } else {
        found
    }
}

/// Profiles of every root, in table order. With more than one root each
/// profile's `id` is `<browser>:<dir>`; with one it is the bare dir. A root
/// that cannot be read is skipped while another reads; with none readable
/// the first error is returned.
pub fn read_all(roots: &[Root]) -> anyhow::Result<Vec<Profile>> {
    let mut read = Vec::new();
    let mut first_err = None;
    for r in roots {
        match read_profiles(&r.dir) {
            Ok(list) => read.push((r, list)),
            Err(e) => {
                first_err.get_or_insert(e);
            }
        }
    }
    if read.is_empty() {
        return Err(first_err.unwrap_or_else(|| anyhow::anyhow!("no browser found")));
    }
    let prefixed = roots.len() > 1;
    Ok(read
        .into_iter()
        .flat_map(|(r, list)| {
            list.into_iter().map(move |mut p| {
                p.browser = r.browser.to_owned();
                if prefixed {
                    p.id = format!("{}:{}", r.browser, p.dir);
                }
                p
            })
        })
        .collect())
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
            id: d.clone(),
            browser: "chrome".into(),
            root: chrome_dir.to_path_buf(),
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

/// The profiles a bare `wanted` dir names, when it names more than one
/// browser's.
pub fn ambiguous<'a>(profiles: &'a [Profile], wanted: &str) -> Vec<&'a Profile> {
    let wanted = wanted.trim();
    let hits: Vec<&Profile> = profiles.iter().filter(|p| p.dir == wanted).collect();
    if hits.len() > 1 && !profiles.iter().any(|p| p.id == wanted) {
        hits
    } else {
        vec![]
    }
}

/// Finds a profile by its id or dir (exact) or its name (any case). A bare
/// dir that two browsers share finds none: see `ambiguous`.
pub fn resolve<'a>(profiles: &'a [Profile], wanted: &str) -> Option<&'a Profile> {
    let wanted = wanted.trim();
    if !ambiguous(profiles, wanted).is_empty() {
        return None;
    }
    profiles
        .iter()
        .find(|p| p.id == wanted)
        .or_else(|| profiles.iter().find(|p| p.dir == wanted))
        .or_else(|| {
            profiles
                .iter()
                .find(|p| p.name.eq_ignore_ascii_case(wanted))
        })
        .or_else(|| profiles.iter().find(|p| p.dir.eq_ignore_ascii_case(wanted)))
}
