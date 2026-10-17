//! `browser-hand install`: registers this binary as the native messaging
//! host for the browser-hand extension, for every profile of the user's
//! Chrome (`docs/external/chrome-native-messaging.md` § Manifest location).

use std::path::{Path, PathBuf};

use anyhow::Context;
use serde_json::json;

use crate::mcp::EXTENSION_ID;

pub const HOST_NAME: &str = "dev.browserhand.host";

pub fn manifest_path(chrome_dir: &Path) -> PathBuf {
    chrome_dir.join("NativeMessagingHosts").join(format!("{HOST_NAME}.json"))
}

/// Writes the host manifest pointing at `exe`, returning its path.
pub fn write_manifest(chrome_dir: &Path, exe: &Path) -> anyhow::Result<PathBuf> {
    let path = manifest_path(chrome_dir);
    std::fs::create_dir_all(path.parent().expect("has parent"))?;
    let manifest = json!({
        "name": HOST_NAME,
        "description": "browser-hand native host",
        "path": exe,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&manifest)?)
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(path)
}

pub fn main(uninstall: bool) -> anyhow::Result<()> {
    let chrome_dir = crate::profiles::chrome_dir();
    if uninstall {
        let path = manifest_path(&chrome_dir);
        match std::fs::remove_file(&path) {
            Ok(()) => println!("Removed {}", path.display()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => println!("Nothing to remove at {}", path.display()),
            Err(e) => return Err(e).with_context(|| format!("removing {}", path.display())),
        }
        return Ok(());
    }
    let exe = std::env::current_exe()?.canonicalize()?;
    let path = write_manifest(&chrome_dir, &exe)?;
    println!("Installed {}", path.display());
    println!("Host binary: {}", exe.display());
    println!("Extension ID: {EXTENSION_ID}");
    println!("Next, in each Chrome profile to use: chrome://extensions, Developer mode on,");
    println!("Load unpacked: the extension/dist folder of this repository.");
    Ok(())
}
