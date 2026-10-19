# toml (Rust crate)

Fetched: 19/10/2026 from https://docs.rs/toml/latest/toml/, `cargo search toml`
and `cargo search toml_edit` (crates.io index), and the OSV.dev query API
for both crates.
Version: `toml` 1.1.8+spec-1.1.0; `toml_edit` 0.25.17+spec-1.1.0 (for
comparison only).

## Authentication

None: a library.

## What this project calls

- `toml::from_str::<T: DeserializeOwned>(&str)`: "Deserializes a string into
  a type." Needs the `parse` and `serde` features.
- `toml::to_string_pretty(&T)`: "Serialize the given data structure as a
  "pretty" String of TOML." Needs `display` and `serde`.
- Exact signatures and which features are on by default: not stated on the
  crate page. `scripts/prove/config-toml.sh` pins what builds.

## Errors

`from_str` returns `toml::de::Error`, which carries the line and column
(Display text not stated on the page; the proof prints one).

## Limits

Not stated.

## Gotchas

- Comments are not mentioned on the `toml` page. A file read with
  `from_str` and written with `to_string_pretty` loses any comment a person
  added; `toml_edit` is the crate that keeps formatting.
- Advisories: OSV.dev returned none for `toml` or `toml_edit` on
  19/10/2026.
