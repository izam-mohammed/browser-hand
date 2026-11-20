# GitHub Releases, checksums and attestations

Pulled 2026-11-20 from web search results (GitHub docs, the
`actions/attest-build-provenance` README, GoReleaser's attestation guide).
Not yet read end to end: `scripts/prove/release-dry-run.sh` settles it.

- `actions/attest-build-provenance` runs after the build and needs
  `id-token: write`, `attestations: write` and `contents: read`. It takes a
  glob (`subject-path`) or a checksums file (`subject-checksums`). From v4 it
  wraps `actions/attest`; new work should use `actions/attest`. Its README
  says **private repositories need GitHub Enterprise Cloud**: public
  repositories are free.
- Verify: `gh attestation verify <file> -R <owner>/<repo>`; `gh release
  verify [tag]` checks a release's attestation.
- Release assets: `gh release create <tag> <files> --notes-file <f>`;
  `gh release download <tag> -p '<pattern>'`; the stable URL is
  `https://github.com/<owner>/<repo>/releases/latest/download/<asset>`.
