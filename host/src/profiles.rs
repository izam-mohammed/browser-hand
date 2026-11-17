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
    Windows,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
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
    /// Under `%LOCALAPPDATA%`, `/`-separated, ending in `User Data`.
    pub win_dir: &'static str,
    /// Under `HKCU\Software\`: the vendor key holding `NativeMessagingHosts`.
    pub win_reg: &'static str,
    /// Under `%ProgramFiles%` and the like, `\`-separated.
    pub win_exe: &'static str,
    /// The app name `open -na` takes.
    pub mac_app: &'static str,
    /// Binary names looked up on `PATH`, in order.
    pub linux_bins: &'static [&'static str],
    /// Lowercase names the browser's binary, its folder or its `.app` go
    /// by (`identify`).
    pub exe_names: &'static [&'static str],
}

/// The fixed table of browsers. Dirs are built from `$HOME` only.
pub const BROWSERS: &[Browser] = &[
    Browser {
        key: "chrome",
        name: "Google Chrome",
        mac_dir: "Google/Chrome",
        linux_dir: "google-chrome",
        win_dir: "Google/Chrome/User Data",
        win_reg: r"Google\Chrome",
        win_exe: r"Google\Chrome\Application\chrome.exe",
        mac_app: "Google Chrome",
        linux_bins: &["google-chrome-stable", "google-chrome", "chromium"],
        exe_names: &[
            "chrome",
            "google-chrome",
            "google chrome",
            "google chrome.app",
        ],
    },
    Browser {
        key: "chromium",
        name: "Chromium",
        mac_dir: "Chromium",
        linux_dir: "chromium",
        win_dir: "Chromium/User Data",
        win_reg: "Chromium",
        win_exe: r"Chromium\Application\chrome.exe",
        mac_app: "Chromium",
        linux_bins: &["chromium", "chromium-browser"],
        exe_names: &["chromium", "chromium-browser", "chromium.app"],
    },
    Browser {
        key: "edge",
        name: "Microsoft Edge",
        mac_dir: "Microsoft Edge",
        linux_dir: "microsoft-edge",
        win_dir: "Microsoft/Edge/User Data",
        win_reg: r"Microsoft\Edge",
        win_exe: r"Microsoft\Edge\Application\msedge.exe",
        mac_app: "Microsoft Edge",
        linux_bins: &["microsoft-edge-stable", "microsoft-edge"],
        exe_names: &[
            "msedge",
            "microsoft-edge",
            "microsoft-edge-stable",
            "microsoft edge",
            "microsoft edge.app",
        ],
    },
    Browser {
        key: "brave",
        name: "Brave",
        mac_dir: "BraveSoftware/Brave-Browser",
        linux_dir: "BraveSoftware/Brave-Browser",
        win_dir: "BraveSoftware/Brave-Browser/User Data",
        win_reg: r"BraveSoftware\Brave-Browser",
        win_exe: r"BraveSoftware\Brave-Browser\Application\brave.exe",
        mac_app: "Brave Browser",
        linux_bins: &["brave-browser", "brave-browser-stable", "brave"],
        exe_names: &[
            "brave",
            "brave-browser",
            "brave-browser-stable",
            "brave browser",
            "brave browser.app",
        ],
    },
    Browser {
        key: "vivaldi",
        name: "Vivaldi",
        mac_dir: "Vivaldi",
        linux_dir: "vivaldi",
        win_dir: "Vivaldi/User Data",
        win_reg: "Vivaldi",
        win_exe: r"Vivaldi\Application\vivaldi.exe",
        mac_app: "Vivaldi",
        linux_bins: &["vivaldi-stable", "vivaldi"],
        exe_names: &["vivaldi", "vivaldi-bin", "vivaldi-stable", "vivaldi.app"],
    },
];

pub fn browser(key: &str) -> Option<&'static Browser> {
    BROWSERS.iter().find(|b| b.key == key)
}

/// `b`'s user data dir under `home`; on Windows `home` is `%LOCALAPPDATA%`
/// (`base_dir`).
pub fn data_dir(os: Os, home: &Path, b: &Browser) -> PathBuf {
    match os {
        Os::Mac => home.join("Library/Application Support").join(b.mac_dir),
        Os::Linux => home.join(".config").join(b.linux_dir),
        Os::Windows => b
            .win_dir
            .split('/')
            .fold(home.to_path_buf(), |p, c| p.join(c)),
    }
}

/// What `data_dir` takes as `home` here: `%LOCALAPPDATA%` on Windows (empty
/// when unset, so no dir is found), `$HOME` elsewhere.
pub fn base_dir() -> PathBuf {
    if Os::current() == Os::Windows {
        PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
    } else {
        crate::paths::home_dir()
    }
}

/// Chrome's user data dir. `BROWSER_HAND_CHROME_DIR` overrides it (tests).
pub fn chrome_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("BROWSER_HAND_CHROME_DIR") {
        return PathBuf::from(dir);
    }
    data_dir(Os::current(), &base_dir(), &BROWSERS[0])
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
        installed_roots(Os::current(), &base_dir())
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

/// Which table browser a process is, from its `--user-data-dir` and its
/// binary (`plans/15-browser-identity.md`, decision 1). A user data dir equal
/// to a root's decides first, so two builds of one binary on two dirs stay
/// apart; else the binary's file name, its folder name or an `.app` part
/// is compared, whole and lowercased, with the table's `exe_names`
/// (Chrome's last, so Chromium's `chrome` inside `chromium-browser` is
/// Chromium). A home folder or an argument never counts. Only table keys come
/// out; nothing known gives `None`.
pub fn identify(exe: Option<&Path>, udd: Option<&Path>, roots: &[Root]) -> Option<&'static str> {
    if let Some(udd) = udd {
        let same = |a: &Path, b: &Path| {
            a == b || matches!((a.canonicalize(), b.canonicalize()), (Ok(x), Ok(y)) if x == y)
        };
        let udd = Path::new(udd.to_str()?.trim_end_matches(['/', '\\']));
        if let Some(r) = roots.iter().find(|r| same(&r.dir, udd)) {
            return Some(r.browser);
        }
    }
    // Windows paths read the same on every system: `\` is a separator here.
    let exe = exe?.to_string_lossy().replace('\\', "/");
    let exe = Path::new(&exe);
    let name_of = |p: Option<&Path>| {
        p.and_then(Path::file_name)
            .map(|n| n.to_string_lossy().to_ascii_lowercase())
    };
    let mut parts: Vec<String> = exe
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .filter(|c| c.to_ascii_lowercase().ends_with(".app"))
        .map(str::to_ascii_lowercase)
        .collect();
    let file = name_of(Some(exe)).map(|n| n.strip_suffix(".exe").map_or(n.clone(), String::from));
    let folder = name_of(exe.parent());
    parts.extend(file.iter().chain(&folder).cloned());
    let table = BROWSERS[1..].iter().chain(&BROWSERS[..1]);
    let found = table
        .filter(|b| parts.iter().any(|p| b.exe_names.contains(&p.as_str())))
        .map(|b| b.key)
        .next();
    // Chromium's Windows exe is `...\Chromium\Application\chrome.exe`: the
    // folder two up tells it from Chrome, and only in that shape.
    if found == Some("chrome") && folder.as_deref() == Some("application") {
        let grand = name_of(exe.parent().and_then(Path::parent));
        if grand.is_some_and(|g| BROWSERS[1].exe_names.contains(&g.as_str())) {
            return Some(BROWSERS[1].key);
        }
    }
    found
}

/// The value of `--user-data-dir` in a command line, `=` or a separate word.
/// Chromium rewrites its own process title on Linux, so `/proc/<pid>/cmdline`
/// of a browser is often one space-joined string, not NUL-separated words
/// (measured on Chrome for Testing 157, 2026-11-17): the flag is then found
/// inside a word and its value runs to the next ` --` or the end.
pub fn user_data_dir_arg(args: &[String]) -> Option<PathBuf> {
    const FLAG: &str = "--user-data-dir=";
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let at = if a.starts_with(FLAG) {
            Some(0)
        } else {
            a.find(&format!(" {FLAG}")).map(|i| i + 1)
        };
        if let Some(at) = at {
            let rest = &a[at + FLAG.len()..];
            let end = rest.find(" --").unwrap_or(rest.len());
            return Some(rest[..end].into());
        }
        if a == "--user-data-dir" {
            return it.next().map(PathBuf::from);
        }
    }
    None
}

/// `identify` for process `pid`: its binary and, on Linux, its command line
/// from `/proc`; on macOS the binary from `proc_pidpath`. Any read that fails
/// leaves that part out. Only `--user-data-dir`'s value is read from the
/// command line, and nothing is logged.
pub fn parent_identity(pid: u32, roots: &[Root]) -> Option<&'static str> {
    let exe = exe_of(pid);
    let args = std::fs::read(format!("/proc/{pid}/cmdline"))
        .map(|b| {
            b.split(|c| *c == 0)
                .map(|a| String::from_utf8_lossy(a).into_owned())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    in_roots(
        identify(exe.as_deref(), user_data_dir_arg(&args).as_deref(), roots),
        roots,
    )
}

/// `key` only when one of `roots` is that browser's. A host named for a
/// browser whose profiles are not listed could never match one of them, so
/// it states nothing and falls back to matching by dir.
pub fn in_roots(key: Option<&'static str>, roots: &[Root]) -> Option<&'static str> {
    key.filter(|k| roots.iter().any(|r| r.browser == *k))
}

#[cfg(target_os = "linux")]
fn exe_of(pid: u32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/exe")).ok()
}

#[cfg(target_os = "macos")]
fn exe_of(pid: u32) -> Option<PathBuf> {
    use std::os::unix::ffi::OsStringExt;
    let mut buf = vec![0u8; 4096];
    // SAFETY: `buf` is writable for the length given.
    let n = unsafe { libc::proc_pidpath(pid as i32, buf.as_mut_ptr().cast(), buf.len() as u32) };
    if n <= 0 {
        return None;
    }
    buf.truncate(n as usize);
    Some(PathBuf::from(std::ffi::OsString::from_vec(buf)))
}

#[cfg(windows)]
fn exe_of(pid: u32) -> Option<PathBuf> {
    crate::winsys::image_path(pid)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn exe_of(_pid: u32) -> Option<PathBuf> {
    None
}

/// This process's parent: the browser, for a native host. `0` when unknown.
#[cfg(unix)]
pub fn parent_pid() -> u32 {
    std::os::unix::process::parent_id()
}

/// This process's parent (ToolHelp snapshot); `0` when unknown.
#[cfg(windows)]
pub fn parent_pid() -> u32 {
    crate::winsys::parent_pid().unwrap_or(0)
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
    let probes = crate::ipc::list(dir).into_iter().map(|path| async move {
        match host_conn::probe(&path, wait).await {
            Ok(hello) => Some(LiveHost { path, hello }),
            Err(e) => {
                crate::ipc::forget_stale(&path, &e);
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
