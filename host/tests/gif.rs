use std::io::Cursor;
use std::time::Instant;

use base64::Engine;
use browser_hand::gif::{encode, safe_filename, Overlays, Recorded};
use image::{ImageFormat, Rgba, RgbaImage};

fn png(w: u32, h: u32, shade: u8) -> String {
    let img = RgbaImage::from_pixel(w, h, Rgba([shade, shade, shade, 255]));
    let mut bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).unwrap();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn frame(shade: u8) -> Recorded {
    Recorded { image: png(320, 200, shade), label: Some("Clicks Log in".into()), click: Some((100.0, 80.0)), drag: None }
}

fn frames_of(gif: &[u8]) -> Vec<RgbaImage> {
    let mut opts = gif::DecodeOptions::new();
    opts.set_color_output(gif::ColorOutput::RGBA);
    let mut dec = opts.read_info(gif).unwrap();
    let (w, h) = (dec.width() as u32, dec.height() as u32);
    let mut out = vec![];
    while let Some(f) = dec.read_next_frame().unwrap() {
        out.push(RgbaImage::from_raw(w, h, f.buffer.to_vec()).unwrap());
    }
    out
}

#[test]
fn exports_one_frame_per_recording_as_a_gif89a() {
    let bytes = encode(&[frame(40), frame(90), frame(140)], &Overlays::default(), 600).unwrap();
    assert_eq!(&bytes[..6], b"GIF89a");
    assert_eq!(frames_of(&bytes).len(), 3);
}

#[test]
fn no_frames_is_an_error_saying_what_to_do() {
    let e = encode(&[], &Overlays::default(), 500).unwrap_err();
    assert!(e.to_string().contains("Start recording"));
}

#[test]
fn each_overlay_option_draws_or_does_not() {
    let plain = Overlays { click_indicators: false, drag_paths: false, action_labels: false, progress_bar: false, quality: 10 };
    let f = Recorded { drag: Some(((20.0, 150.0), (250.0, 150.0))), ..frame(200) };

    let none = &frames_of(&encode(std::slice::from_ref(&f), &plain, 500).unwrap())[0];
    let ring = &frames_of(&encode(std::slice::from_ref(&f), &Overlays { click_indicators: true, ..plain.clone() }, 500).unwrap())[0];
    let bar = &frames_of(&encode(std::slice::from_ref(&f), &Overlays { progress_bar: true, ..plain.clone() }, 500).unwrap())[0];
    let drag = &frames_of(&encode(std::slice::from_ref(&f), &Overlays { drag_paths: true, ..plain.clone() }, 500).unwrap())[0];
    let text = &frames_of(&encode(std::slice::from_ref(&f), &Overlays { action_labels: true, ..plain.clone() }, 500).unwrap())[0];

    let grey = |img: &RgbaImage, x: u32, y: u32| {
        let p = img.get_pixel(x, y).0;
        p[0].abs_diff(p[1]) < 20 && p[1].abs_diff(p[2]) < 20
    };
    // Ring 14 px right of the click point; bar on the bottom row; arrow on
    // the drag line; label box at the top left.
    assert!(grey(none, 114, 80) && !grey(ring, 114, 80));
    assert!(grey(none, 2, 198) && !grey(bar, 2, 198));
    assert!(grey(none, 120, 150) && !grey(drag, 120, 150));
    assert!(grey(none, 12, 12) && text.get_pixel(12, 12).0[0] < 30);
}

#[test]
fn frames_of_another_size_are_scaled_to_the_first() {
    let small = Recorded { image: png(160, 100, 50), ..frame(50) };
    let bytes = encode(&[frame(10), small], &Overlays::default(), 500).unwrap();
    let frames = frames_of(&bytes);
    assert_eq!(frames[1].dimensions(), (320, 200));
}

#[test]
fn sixty_frames_export_in_under_five_seconds() {
    // Debug builds are far slower; the plan's 5 s for 60 frames is a
    // release figure (`cargo test --release --test gif`).
    let n = if cfg!(debug_assertions) { 10 } else { 60 };
    let frames: Vec<Recorded> = (0..n).map(|i| Recorded { image: png(1280, 800, (i * 4) as u8), ..frame(0) }).collect();
    let started = Instant::now();
    encode(&frames, &Overlays::default(), 500).unwrap();
    let took = started.elapsed();
    println!("{n} frames of 1280x800 encoded in {} ms", took.as_millis());
    if !cfg!(debug_assertions) {
        assert!(took.as_secs_f32() < 5.0, "took {took:?}");
    }
}

#[test]
fn filenames_are_plain_names_ending_in_gif() {
    assert_eq!(safe_filename(Some("login flow")).unwrap(), "login flow.gif");
    assert_eq!(safe_filename(Some("a.GIF")).unwrap(), "a.GIF");
    assert!(safe_filename(Some("../x.gif")).is_err());
    assert!(safe_filename(Some("dir/x.gif")).is_err());
    assert!(safe_filename(None).unwrap().starts_with("recording-"));
}
