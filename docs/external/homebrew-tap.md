# Homebrew tap

Pulled 2026-11-20 from web search results (docs.brew.sh "How to Create and
Maintain a Tap", GoReleaser's Homebrew pages).

- A tap is a GitHub repository named `homebrew-<name>` with a `Formula/`
  directory; `brew install <owner>/<name>/<formula>` taps it and installs.
- A formula for a prebuilt binary points `url` at the release archive per
  platform (`on_macos` / `on_linux`, `on_arm` / `on_intel`) with a `sha256`;
  nothing compiles and no bottles are built.
- A workflow updates the formula on each release by writing the file and
  pushing to the tap with a token from the environment (here
  `TAP_GITHUB_TOKEN`). Formula DSL details: not read yet; the proof script
  settles it (`brew install --formula` and `brew test`).
