//! `file_upload` reads files here and sends their bytes, since the
//! extension cannot read the disk (plans/plan-page-tools.md, decision 5).

use std::path::Path;

use base64::Engine;
use serde_json::{json, Value};

/// The reference's limit for one call.
pub const MAX_UPLOAD_BYTES: u64 = 10 * 1024 * 1024;

pub fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
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
        total += meta.len();
        if total > MAX_UPLOAD_BYTES {
            return Err(format!("bad_args: the files add up to more than {} MB", MAX_UPLOAD_BYTES / 1024 / 1024));
        }
        let bytes = std::fs::read(path).map_err(|e| format!("bad_args: {p}: {e}"))?;
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        out.push(json!({
            "name": name,
            "mimeType": mime_for(path),
            "data": base64::engine::general_purpose::STANDARD.encode(bytes),
        }));
    }
    Ok(out)
}
