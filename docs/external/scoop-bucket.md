# Scoop bucket

Pulled 2026-11-20 from web search results (the Scoop wiki "App Manifest
Autoupdate", GoReleaser's Scoop page).

- A bucket is a GitHub repository holding `<app>.json` manifests (or a
  `bucket/` directory); `scoop bucket add <name> <repo URL>` then
  `scoop install <app>`.
- A manifest has `version`, `url`, `hash`, `bin`; `checkver: "github"` reads
  the latest release (pre-releases ignored) and `autoupdate` templates the
  zip URL with `$version`.
- The topic `scoop-bucket` lists the bucket on scoop.sh. Exact manifest
  fields for a zip holding several files: not read yet; the proof script
  settles it (`scoop install` from a local manifest on Windows).
