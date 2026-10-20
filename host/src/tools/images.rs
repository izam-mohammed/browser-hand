//! Screenshots kept for `upload_image` (ids expire after 5 minutes, as in the
//! reference) and saved to disk on request.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use base64::Engine;

pub const IMAGE_TTL: Duration = Duration::from_secs(5 * 60);

pub struct Kept {
    pub data: String,
    pub mime_type: String,
    at: Instant,
}

#[derive(Default)]
pub struct ImageStore {
    images: HashMap<String, Kept>,
    next: u64,
}

impl ImageStore {
    /// Keeps an image and returns its id.
    pub fn keep(&mut self, data: String, mime_type: String) -> String {
        self.prune();
        self.next += 1;
        let id = format!("img_{}", self.next);
        self.images.insert(
            id.clone(),
            Kept {
                data,
                mime_type,
                at: Instant::now(),
            },
        );
        id
    }

    pub fn get(&mut self, id: &str) -> Option<&Kept> {
        self.prune();
        self.images.get(id)
    }

    fn prune(&mut self) {
        self.images.retain(|_, k| k.at.elapsed() < IMAGE_TTL);
    }
}

/// Writes an image under `~/Downloads/browser-hand/`, returning its path.
pub fn save(data: &str, mime_type: &str, stem: &str) -> std::io::Result<PathBuf> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let ext = if mime_type == "image/png" {
        "png"
    } else {
        "jpg"
    };
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = crate::gif::output_dir()?.join(format!("{stem}-{ms}.{ext}"));
    std::fs::write(&path, bytes)?;
    Ok(path)
}

/// Reads "viewport WxH" and "image WxH" from a screenshot's text, giving
/// image pixels per viewport pixel.
pub fn scale_from_text(text: &str) -> Option<f32> {
    fn dims_after(text: &str, word: &str) -> Option<(f32, f32)> {
        let rest = &text[text.find(word)? + word.len()..];
        let rest = rest.trim_start();
        let end = rest
            .find(|c: char| !(c.is_ascii_digit() || c == 'x'))
            .unwrap_or(rest.len());
        let (w, h) = rest[..end].split_once('x')?;
        Some((w.parse().ok()?, h.parse().ok()?))
    }
    let (vw, _) = dims_after(text, "viewport ")?;
    let (iw, _) = dims_after(text, "image ")?;
    (vw > 0.0).then_some(iw / vw)
}
