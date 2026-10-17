// Prove gif 0.14.2 encodes RGBA frames with Frame::from_rgba_speed at speed
// 10, per docs/external/gif-crate.md. Writes the GIF to the path given and
// prints the encode time. No project code.
use std::time::Instant;

fn main() {
    let out = std::env::args().nth(1).expect("usage: prove-gif-encode <out.gif>");
    let (w, h) = (640u16, 400u16);
    let mut file = std::fs::File::create(&out).expect("create output");
    let mut encoder = gif::Encoder::new(&mut file, w, h, &[]).expect("encoder");
    encoder.set_repeat(gif::Repeat::Infinite).expect("repeat");

    let started = Instant::now();
    for n in 0..3u32 {
        // A gradient that shifts each frame, so frames differ.
        let mut rgba = Vec::with_capacity(w as usize * h as usize * 4);
        for y in 0..h as u32 {
            for x in 0..w as u32 {
                rgba.extend_from_slice(&[((x + n * 40) % 256) as u8, (y % 256) as u8, (n * 80) as u8, 255]);
            }
        }
        let mut frame = gif::Frame::from_rgba_speed(w, h, &mut rgba, 10);
        frame.delay = 50; // units of 10 ms
        encoder.write_frame(&frame).expect("write frame");
    }
    drop(encoder);
    println!("encoded 3 frames of {w}x{h} in {} ms", started.elapsed().as_millis());
}
