//! `file_upload` reads files here and sends their bytes, since the
//! extension cannot read the disk (plans/02-page-tools.md, decision 5).

use std::path::Path;

use base64::Engine;
use serde_json::{json, Value};

/// The reference's limit for one call.
pub const MAX_UPLOAD_BYTES: u64 = 10 * 1024 * 1024;

pub fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("txt") => "text/plain",
        Some("csv") => "text/csv",
        Some("json") => "application/json",
        Some("html" | "htm") => "text/html",
        Some("zip") => "application/zip",
        Some("doc") => "application/msword",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("mp4") => "video/mp4",
        Some("mp3") => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

const ASK: &str = "Do not work around this: ask the person for another file.";

/// The rule a path breaks, if any: credential names and folders.
fn credential_rule(path: &Path) -> Option<&'static str> {
    let in_ssh = path
        .components()
        .any(|c| c.as_os_str().to_string_lossy().eq_ignore_ascii_case(".ssh"));
    if in_ssh {
        return Some("it is inside a .ssh folder, which holds SSH keys");
    }
    let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    if name == ".env" || name.starts_with(".env.") {
        return Some("it is a .env file, which holds secrets");
    }
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("pem") => Some("it is a .pem file, which holds keys or certificates"),
        Some("key") => Some("it is a .key file, which holds private keys"),
        _ => None,
    }
}

/// Refuses credential files by name, folder, resolved symlink and link count.
fn check_not_credential(p: &str, path: &Path, meta: &std::fs::Metadata) -> Result<(), String> {
    if let Some(why) = credential_rule(path) {
        return Err(format!("refused: {p} is not uploaded because {why}. {ASK}"));
    }
    if let Ok(real) = std::fs::canonicalize(path) {
        if real != path {
            if let Some(why) = credential_rule(&real) {
                return Err(format!(
                    "refused: {p} is a symlink to {}, and it is not uploaded because {why}. {ASK}",
                    real.display()
                ));
            }
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.nlink() > 1 {
            return Err(format!(
                "refused: {p} is a hard link (the same file has another name), so its real name cannot be checked. {ASK}"
            ));
        }
    }
    let _ = meta;
    Ok(())
}

/// The files as `{name, mimeType, data}` for the extension, or why not.
pub fn read_for_upload(paths: &[String]) -> Result<Vec<Value>, String> {
    if paths.is_empty() {
        return Err("bad_args: paths is empty".into());
    }
    let mut total = 0u64;
    let mut out = Vec::with_capacity(paths.len());
    for p in paths {
        let path = Path::new(p);
        if !path.is_absolute() {
            return Err(format!("bad_args: {p} is not an absolute path"));
        }
        let meta = std::fs::metadata(path).map_err(|e| format!("bad_args: {p}: {e}"))?;
        if !meta.is_file() {
            return Err(format!("bad_args: {p} is not a file"));
        }
        check_not_credential(p, path, &meta)?;
        total += meta.len();
        if total > MAX_UPLOAD_BYTES {
            return Err(format!(
                "bad_args: the files add up to more than {} MB",
                MAX_UPLOAD_BYTES / 1024 / 1024
            ));
        }
        let bytes = std::fs::read(path).map_err(|e| format!("bad_args: {p}: {e}"))?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        out.push(json!({
            "name": name,
            "mimeType": mime_for(path),
            "data": base64::engine::general_purpose::STANDARD.encode(bytes),
        }));
    }
    Ok(out)
}
