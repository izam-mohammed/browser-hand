# gif (Rust crate)

Fetched: 17/10/2026 from https://docs.rs/gif/latest/gif/ and
https://docs.rs/gif/latest/gif/struct.Frame.html
Version: gif 0.14.2 (published 22/09/2026), MIT OR Apache-2.0.

## What this project uses

### Encoder

From the crate's example: `Encoder::new(&mut writer, width, height, color_map)`,
with `color_map` a byte slice (`&[]` when every frame carries its own
palette), then `encoder.set_repeat(Repeat::Infinite)` and
`encoder.write_frame(&frame)` per frame. Each returns a `Result`; the error
types are `EncodingError` and `EncodingFormatError`.

### Frame

```rust
pub fn from_rgba(width: u16, height: u16, pixels: &mut [u8]) -> Self
pub fn from_rgba_speed(width: u16, height: u16, pixels: &mut [u8], speed: i32) -> Self
```

- "`speed` is a value in the range [1, 30]." "The higher the value the faster
  it runs at the cost of image quality." "A `speed` of 10 is a good compromise
  between speed and quality."
- `delay: u16`, "Frame delay in units of 10 ms."
- `width` and `height` are `u16`.

## Errors

- `from_rgba_speed` panics "If the length of pixels does not equal
  `width * height * 4`" and "If `speed < 1` or `speed > 30`".
- Encoder errors: `EncodingError`, `EncodingFormatError`.

## Limits

- `Frame::from_*` produces "a maximum of 256 colors" per frame.
- Dimensions are `u16`, so at most 65,535 px per side.
- Encoding time per frame: not stated.

## Gotchas

- `from_rgba`: "Any non-zero alpha value will be interpreted as a fully
  opaque pixel."
- The input buffer is `&mut`: the function quantises in place.
