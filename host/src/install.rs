//! `browser-hand install`: registers this binary as the native messaging
//! host for the browser-hand extension, for every profile of the user's
//! Chrome (`docs/external/chrome-native-messaging.md` § Manifest location),
//! and offers the store extension in each profile through an External
//! Extensions file (`docs/external/chrome-extension-distribution.md`).

use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::Context;
use serde_json::json;

use crate::mcp::{EXTENSION_ID, STORE_EXTENSION_ID};
use crate::profiles::Root;

pub const HOST_NAME: &str = "dev.browserhand.host";

/// Where Chrome fetches the store extension from. A constant: no argument
/// sets it.
const UPDATE_URL: &str = "https://clients2.google.com/service/update2/crx";

pub fn manifest_path(chrome_dir: &Path) -> PathBuf {
    chrome_dir
        .join("NativeMessagingHosts")
        .join(format!("{HOST_NAME}.json"))
}

/// `<chrome_dir>/External Extensions/<id>.json`, the ID in lowercase.
pub fn external_extension_path(chrome_dir: &Path, store_id: &str) -> PathBuf {
    chrome_dir
        .join("External Extensions")
        .join(format!("{}.json", store_id.to_lowercase()))
}

/// Writes the host manifest pointing at `exe`, returning its path. The
/// store extension's origin is allowed beside ours when it differs.
pub fn write_manifest(
    chrome_dir: &Path,
    exe: &Path,
    store_id: Option<&str>,
) -> anyhow::Result<PathBuf> {
    let path = manifest_path(chrome_dir);
    std::fs::create_dir_all(path.parent().expect("has parent"))?;
    let mut origins = vec![format!("chrome-extension://{EXTENSION_ID}/")];
    if let Some(id) = store_id.filter(|id| *id != EXTENSION_ID) {
        origins.push(format!("chrome-extension://{id}/"));
    }
    let manifest = json!({
        "name": HOST_NAME,
        "description": "browser-hand native host",
        "path": exe,
        "type": "stdio",
        "allowed_origins": origins,
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&manifest)?)
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(path)
}

/// Writes the External Extensions file that offers the store extension in
/// every profile (one Enable click each, after Chrome restarts).
pub fn write_external_extension(chrome_dir: &Path, store_id: &str) -> anyhow::Result<PathBuf> {
    let path = external_extension_path(chrome_dir, store_id);
    std::fs::create_dir_all(path.parent().expect("has parent"))?;
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&json!({ "external_update_url": UPDATE_URL }))?,
    )
    .with_context(|| format!("writing {}", path.display()))?;
    Ok(path)
}

/// A configuration profile that forces the store extension
/// (`ExtensionInstallForcelist`). Fresh UUIDs on every call.
pub fn mobileconfig(store_id: &str) -> String {
    let outer = uuid::Uuid::new_v4().to_string().to_uppercase();
    let inner = uuid::Uuid::new_v4().to_string().to_uppercase();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>PayloadType</key>
			<string>com.google.Chrome</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>PayloadIdentifier</key>
			<string>dev.browserhand.chrome-policy.{inner}</string>
			<key>PayloadUUID</key>
			<string>{inner}</string>
			<key>PayloadDisplayName</key>
			<string>browser-hand extension</string>
			<key>ExtensionInstallForcelist</key>
			<array>
				<string>{id};{UPDATE_URL}</string>
			</array>
		</dict>
	</array>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
	<key>PayloadIdentifier</key>
	<string>dev.browserhand.chrome-policy</string>
	<key>PayloadUUID</key>
	<string>{outer}</string>
	<key>PayloadDisplayName</key>
	<string>browser-hand</string>
	<key>PayloadScope</key>
	<string>User</string>
</dict>
</plist>
"#,
        id = store_id.to_lowercase()
    )
}

/// Writes the configuration profile to `path` (the person's choice; never
/// installed from here).
pub fn write_mobileconfig(path: &Path, store_id: &str) -> anyhow::Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, mobileconfig(store_id))
        .with_context(|| format!("writing {}", path.display()))
}

/// `browser-hand install [--uninstall] [--no-store] [--mobileconfig <path>]`.
#[derive(Debug, Default, Clone)]
pub struct Options {
    pub uninstall: bool,
    /// Development: write only the host manifest.
    pub no_store: bool,
    pub mobileconfig: Option<PathBuf>,
}

impl Options {
    /// `args` is the command line after the program name, starting with
    /// `install`.
    pub fn parse(args: &[String]) -> anyhow::Result<Options> {
        let mut o = Options::default();
        let mut it = args.iter().skip(1);
        while let Some(a) = it.next() {
            match a.as_str() {
                "--uninstall" => o.uninstall = true,
                "--no-store" => o.no_store = true,
                "--mobileconfig" => {
                    let path = it
                        .next()
                        .ok_or_else(|| anyhow::anyhow!("--mobileconfig needs a path"))?;
                    o.mobileconfig = Some(PathBuf::from(path));
                }
                other => anyhow::bail!(
                    "unknown option {other}; usage: browser-hand install [--uninstall] [--no-store] [--mobileconfig <path>]"
                ),
            }
        }
        Ok(o)
    }
}

fn remove(path: &Path, out: &mut dyn Write) -> anyhow::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => writeln!(out, "Removed {}", path.display())?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            writeln!(out, "Nothing to remove at {}", path.display())?
        }
        Err(e) => return Err(e).with_context(|| format!("removing {}", path.display())),
    }
    Ok(())
}

fn unpacked_steps(out: &mut dyn Write) -> std::io::Result<()> {
    writeln!(
        out,
        "Next, in each Chrome profile to use: chrome://extensions, Developer mode on,"
    )?;
    writeln!(
        out,
        "Load unpacked: the extension/dist folder of this repository."
    )
}

/// The install, with the store ID and the output passed in so it can be
/// tested.
pub fn run(
    chrome_dir: &Path,
    exe: &Path,
    opts: &Options,
    store_id: Option<&str>,
    out: &mut dyn Write,
) -> anyhow::Result<()> {
    if opts.uninstall {
        remove(&manifest_path(chrome_dir), out)?;
        if let Some(id) = store_id {
            remove(&external_extension_path(chrome_dir, id), out)?;
        }
        return Ok(());
    }
    if opts.mobileconfig.is_some() && store_id.is_none() {
        anyhow::bail!(
            "--mobileconfig needs the extension's Chrome Web Store ID, and none is built in yet"
        );
    }
    let path = write_manifest(chrome_dir, exe, store_id)?;
    writeln!(out, "Installed {}", path.display())?;
    writeln!(out, "Host binary: {}", exe.display())?;
    writeln!(out, "Extension ID: {EXTENSION_ID}")?;
    match (store_id, opts.no_store) {
        (_, true) => unpacked_steps(out)?,
        (None, false) => {
            writeln!(
                out,
                "This build has no Chrome Web Store ID yet, so no External Extensions file was written."
            )?;
            unpacked_steps(out)?;
        }
        (Some(id), false) => {
            let file = write_external_extension(chrome_dir, id)?;
            writeln!(out, "Installed {}", file.display())?;
            writeln!(
                out,
                "Next: quit and reopen Chrome, then click Enable in each profile."
            )?;
            writeln!(
                out,
                "For development, install with --no-store and Load unpacked instead."
            )?;
        }
    }
    if let (Some(target), Some(id)) = (&opts.mobileconfig, store_id) {
        write_mobileconfig(target, id)?;
        writeln!(out, "Wrote {}", target.display())?;
        writeln!(
            out,
            "To approve it: open the file, then System Settings > Privacy & Security > Profiles,"
        )?;
        writeln!(
            out,
            "and install it with an administrator password. Chrome then shows as managed, and the"
        )?;
        writeln!(out, "extension is installed with no Enable click.")?;
    }
    Ok(())
}

/// `run` for each browser dir; with more than one, each section starts with
/// the browser's name.
pub fn run_all(
    roots: &[Root],
    exe: &Path,
    opts: &Options,
    store_id: Option<&str>,
    out: &mut dyn Write,
) -> anyhow::Result<()> {
    for r in roots {
        if roots.len() > 1 {
            let name = crate::profiles::browser(r.browser).map_or(r.browser, |b| b.name);
            writeln!(out, "{name}:")?;
        }
        run(&r.dir, exe, opts, store_id, out)?;
    }
    Ok(())
}

pub fn main(args: &[String]) -> anyhow::Result<()> {
    let opts = Options::parse(args)?;
    let roots = crate::profiles::roots();
    let exe = std::env::current_exe()?.canonicalize()?;
    // `--no-store` is for development: no file, and the manifest allows
    // only the dev ID.
    let store_id = if opts.no_store && !opts.uninstall {
        None
    } else {
        STORE_EXTENSION_ID
    };
    run_all(&roots, &exe, &opts, store_id, &mut std::io::stdout())
}
