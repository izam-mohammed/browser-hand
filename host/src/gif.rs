//! `gif_creator`: frames recorded after each action in a session, exported
//! as an animated GIF with the reference's overlays (click circles, drag
//! arrows, action labels, a progress bar). Encoding per
//! `docs/external/gif-crate.md`.

use ab_glyph::{FontRef, PxScale};
use anyhow::Context;
use base64::Engine;
use image::{imageops, ImageFormat, Rgba, RgbaImage};
use imageproc::drawing::{draw_filled_rect_mut, draw_hollow_circle_mut, draw_line_segment_mut, draw_text_mut, text_size};
use imageproc::rect::Rect;

static FONT: &[u8] = include_bytes!("../assets/Inter.ttf");

const ORANGE: Rgba<u8> = Rgba([217, 119, 6, 255]);
const RED: Rgba<u8> = Rgba([220, 38, 38, 255]);
const BLACK: Rgba<u8> = Rgba([0, 0, 0, 255]);
const WHITE: Rgba<u8> = Rgba([255, 255, 255, 255]);

/// One recorded frame: a screenshot and what had just happened, with points
/// in the screenshot's own pixels.
#[derive(Debug, Clone)]
pub struct Recorded {
    /// base64 JPEG or PNG
    pub image: String,
    pub label: Option<String>,
    pub click: Option<(f32, f32)>,
    pub drag: Option<((f32, f32), (f32, f32))>,
}

#[derive(Debug, Clone)]
pub struct Overlays {
    pub click_indicators: bool,
    pub drag_paths: bool,
    pub action_labels: bool,
    pub progress_bar: bool,
    /// 1 (best, slowest) to 30 (fastest); the gif crate's `speed`.
    pub quality: i32,
}

impl Default for Overlays {
    fn default() -> Self {
        Overlays { click_indicators: true, drag_paths: true, action_labels: true, progress_bar: true, quality: 10 }
    }
}

/// The most frames a session keeps; older ones are dropped first.
pub const MAX_FRAMES: usize = 300;

/// Frames recorded for one session.
#[derive(Default)]
pub struct Recorder {
    pub recording: bool,
    pub frames: Vec<Recorded>,
}

impl Recorder {
    /// Keeps `frame`, dropping the oldest once there are `MAX_FRAMES`.
    pub fn push(&mut self, frame: Recorded) {
        if self.frames.len() >= MAX_FRAMES {
            self.frames.remove(0);
        }
        self.frames.push(frame);
    }
}

fn decode(b64: &str) -> anyhow::Result<RgbaImage> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).context("frame is not base64")?;
    let format = image::guess_format(&bytes).unwrap_or(ImageFormat::Jpeg);
    Ok(image::load_from_memory_with_format(&bytes, format).context("decoding a frame")?.to_rgba8())
}

fn ring(img: &mut RgbaImage, at: (f32, f32), radius: i32, colour: Rgba<u8>) {
    for r in radius - 2..=radius + 2 {
        draw_hollow_circle_mut(img, (at.0 as i32, at.1 as i32), r, colour);
    }
}

fn thick_line(img: &mut RgbaImage, a: (f32, f32), b: (f32, f32), colour: Rgba<u8>) {
    for d in -1..=1 {
        let d = d as f32;
        draw_line_segment_mut(img, (a.0 + d, a.1), (b.0 + d, b.1), colour);
        draw_line_segment_mut(img, (a.0, a.1 + d), (b.0, b.1 + d), colour);
    }
}

fn arrow(img: &mut RgbaImage, from: (f32, f32), to: (f32, f32)) {
    thick_line(img, from, to, RED);
    let angle = (to.1 - from.1).atan2(to.0 - from.0);
    for side in [-0.5f32, 0.5] {
        let a = angle + std::f32::consts::PI + side;
        thick_line(img, to, (to.0 + 14.0 * a.cos(), to.1 + 14.0 * a.sin()), RED);
    }
}

fn label(img: &mut RgbaImage, font: &FontRef, text: &str) {
    let scale = PxScale::from((img.height() as f32 / 28.0).clamp(12.0, 22.0));
    let text: String = text.chars().take(80).collect();
    let (w, h) = text_size(scale, font, &text);
    let pad = 6;
    let x = 10;
    let y = 10;
    draw_filled_rect_mut(img, Rect::at(x, y).of_size(w + 2 * pad, h + 2 * pad), BLACK);
    draw_text_mut(img, WHITE, x + pad as i32, y + pad as i32, scale, font, &text);
}

fn progress(img: &mut RgbaImage, done: usize, total: usize) {
    let h = 5u32;
    let w = ((img.width() as usize * done) / total.max(1)).max(1) as u32;
    draw_filled_rect_mut(img, Rect::at(0, img.height().saturating_sub(h) as i32).of_size(w, h), ORANGE);
}

/// Encodes the frames, each shown for `delay_ms`, into GIF bytes. Frames of
/// another size are scaled to the first frame's size.
pub fn encode(frames: &[Recorded], overlays: &Overlays, delay_ms: u32) -> anyhow::Result<Vec<u8>> {
    anyhow::ensure!(!frames.is_empty(), "No frames recorded. Start recording, act on the page, then export.");
    let font = FontRef::try_from_slice(FONT).context("loading the bundled font")?;
    let speed = overlays.quality.clamp(1, 30);

    let first = decode(&frames[0].image)?;
    let (w, h) = first.dimensions();
    anyhow::ensure!(w <= u16::MAX as u32 && h <= u16::MAX as u32, "frame too large for GIF");

    let mut out = Vec::new();
    {
        let mut encoder = gif::Encoder::new(&mut out, w as u16, h as u16, &[])?;
        encoder.set_repeat(gif::Repeat::Infinite)?;
        for (i, f) in frames.iter().enumerate() {
            let mut img = if i == 0 { first.clone() } else { decode(&f.image)? };
            let (fx, fy) = (w as f32 / img.width() as f32, h as f32 / img.height() as f32);
            if img.dimensions() != (w, h) {
                img = imageops::resize(&img, w, h, imageops::FilterType::Triangle);
            }
            let fit = |p: (f32, f32)| (p.0 * fx, p.1 * fy);
            if overlays.drag_paths {
                if let Some((a, b)) = f.drag {
                    arrow(&mut img, fit(a), fit(b));
                }
            }
            if overlays.click_indicators {
                if let Some(p) = f.click {
                    ring(&mut img, fit(p), 14, ORANGE);
                }
            }
            if overlays.action_labels {
                if let Some(text) = &f.label {
                    label(&mut img, &font, text);
                }
            }
            if overlays.progress_bar {
                progress(&mut img, i + 1, frames.len());
            }
            let mut rgba = img.into_raw();
            let mut frame = gif::Frame::from_rgba_speed(w as u16, h as u16, &mut rgba, speed);
            frame.delay = (delay_ms / 10).min(u16::MAX as u32) as u16; // units of 10 ms
            encoder.write_frame(&frame)?;
        }
    }
    Ok(out)
}

/// A filename the user can find, refusing anything with a path in it.
pub fn safe_filename(name: Option<&str>) -> Result<String, String> {
    let name = match name {
        Some(n) if !n.trim().is_empty() => n.trim().to_owned(),
        _ => {
            let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
            format!("recording-{ms}.gif")
        }
    };
    if name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err(format!("filename \"{name}\" must be a plain file name, not a path"));
    }
    Ok(if name.to_lowercase().ends_with(".gif") { name } else { format!("{name}.gif") })
}

/// `dir/name`, or `dir/name (2).gif` and so on when that file exists, so an
/// export never overwrites an earlier one.
pub fn unused_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let path = dir.join(name);
    if !path.exists() {
        return path;
    }
    let stem = name.strip_suffix(".gif").or_else(|| name.strip_suffix(".GIF")).unwrap_or(name);
    (2..).map(|n| dir.join(format!("{stem} ({n}).gif"))).find(|p| !p.exists()).expect("some number is free")
}

/// The settings' GIF folder (`capture.gif_folder`, `~` expanded), created
/// if needed. `BROWSER_HAND_OUTPUT_DIR` overrides it, as it did before the
/// settings existed.
pub fn output_dir(gif_folder: &str) -> std::io::Result<std::path::PathBuf> {
    let dir = match std::env::var_os("BROWSER_HAND_OUTPUT_DIR") {
        Some(d) => std::path::PathBuf::from(d),
        None => crate::config::expand(gif_folder),
    };
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
