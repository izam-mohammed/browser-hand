# browser-hand has a documentation site: getting started, guides, and a reference generated from the host

## The ask

"Some of the tools need detailed documentation, like ragrank. Have that in
the plans for the repositories if it is required."

The model is ragrank: a Sphinx site in `ragrank/docs/` with getting
started, core concepts, guides per area and an API reference, built on
Read the Docs from a webhook in `.github/workflows/build-docs.yml` (read
22/10/2026).

browser-hand needs one. People install it in three parts (a native host
built from source, an extension loaded in each Chrome profile, and a
Claude Code plugin or MCP server), it exposes 23 MCP tools (the
`#[tool]` methods on `Server` in `host/src/mcp.rs`), the binary has four
commands (`mcp`, `native-host`, `install [--uninstall]`, `reload`, in
`host/src/main.rs`), and the settings page writes five sections of keys
to `~/.config/browser-hand/config.toml` (`Settings` in
`host/src/config.rs`). Recording and replay (`plans/05-record-steps.md`,
`plans/08-recorder-popup.md`, open as PR #18) and the Web Store install
(`plans/07-install-extension.md`) add more. `README.md` holds the install
and settings today, and the tools only in the skill and the server's
instructions (`host/src/instructions.md`).

The page from `plans/10-site.md` is the landing page (what it is, how to
get it), published inside the public `izam-mohammed.github.io` at
`/browser-hand/` while this repository stays private. This plan adds the
reference behind it, at `/browser-hand/docs/`.

Built so far: `docs/built/BUILT-2026-10-22-1828.md`.

## Alternatives

### Decision 1: which generator builds the docs? (two-way door)

The docs are markdown pages (guides) plus reference pages generated from
the host; the output is static HTML copied under `/browser-hand/docs/`
of the personal site, which runs no build and no npm (its `CLAUDE.md`)
and sends `script-src 'self' 'unsafe-inline'` (its `_headers`).

Searched 2026-10-22: "mdBook vs MkDocs Material vs Starlight vs
Docusaurus build speed page weight 2026", "MkDocs Material maintenance
mode Zensical 2026", "Zensical static site generator release status 2026
alpha stable", "mdBook 0.5 release 2025 single binary search index
javascript", "Starlight Astro docs link validator
starlight-links-validator build fails broken links"; read the Material
for MkDocs release notes (maintenance mode announced 05/11/2025, fixes
until 05/11/2026), Zensical's site and PyPI listing (alpha, 0.0.31 on
01/04/2026), the mdBook changelog (0.5.0 breaks preprocessors and
renderers; the search index loads only when the search box opens since
0.4.52), Starlight against Docusaurus comparisons (Starlight ships no
JavaScript by default, Docusaurus hydrates React), the
starlight-links-validator package page, and ragrank's
`docs/docs/conf.py`. No measured build time or page weight was found.

| Must | mdBook | Starlight | Sphinx (ragrank's) | Zensical | Docusaurus | MkDocs Material | rustdoc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Guides and reference pages for users of a tool | yes | yes | yes | yes | yes | yes | no (documents crate items) |
| Maintained by its authors after 05/11/2026 | yes | yes | yes | yes | yes | no (fixes end 05/11/2026) | yes |
| Plain static output that runs under the personal site's CSP | yes | yes | yes | yes | yes | yes | yes |
| **Survives** | **yes** | **yes** | **yes** | **yes** | **yes** | no | no |

| Criterion | Weight | mdBook | Starlight | Sphinx | Zensical | Docusaurus |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Performance efficiency | 35 | 4 | 5 | 4 | 4 | 2 |
| Compatibility | 25 | 5 | 3 | 2 | 2 | 3 |
| Security | 20 | 5 | 2 | 3 | 3 | 2 |
| Reliability | 20 | 4 | 4 | 5 | 2 | 4 |
| **Weighted total** | **100** | **4.45** | **3.70** | **3.50** | **2.90** | **2.65** |

- Efficiency: Starlight 5 for no JavaScript by default; mdBook 4 for a
  small theme and search script with the index loaded on demand; Sphinx
  and Zensical 4 for static HTML with theme scripts; Docusaurus 2 for
  React hydration on every page. From documentation, none measured.
- Compatibility: mdBook is one binary, and the host is Rust (5).
  Starlight and Docusaurus reuse the Node the extension already needs,
  but add a site toolchain beside it (3). Sphinx and Zensical add Python
  (2); Sphinx's autodoc reads Python, not Rust or TypeScript.
- Security: mdBook is one pinned binary (5); Sphinx and Zensical bring a
  pip tree (3); Starlight and Docusaurus an npm tree beside the
  extension's (2).
- Reliability: Sphinx 5, mature; mdBook 4, stable but 0.5 broke plugins;
  Zensical 2, alpha.

Sensitivity: efficiency raised to 55 and compatibility cut to 5 gives
mdBook 4.25 and Starlight 4.10; the winner holds.
Risk: an mdBook minor release breaks a plugin; this plan uses none, and
the version is pinned in `docs/standards.md`.

**Chosen: mdBook.** One binary, no new package tree, light pages that fit
the personal site's rules. Revisit if Starlight's lighter pages are
measured to matter, or the docs need versions per release.

### Decision 2: where are the docs served? (two-way door)

`plans/10-site.md` decision 2 rules out GitHub Pages from this
repository (a paid plan while it is private) and publishes the landing
page as a copy in `izam-mohammed.github.io` at `/browser-hand/`.

Searched 2026-10-22: "Read the Docs private repository pricing Business
plan 2026"; read the Read the Docs pricing page (private repositories need
Read the Docs for Business, from 50 a month on the Basic plan, currency
not shown; no date on the page), and plan 10's sources for Pages and
Cloudflare Pages.

| Must | `izam-mohammed.github.io` at `/browser-hand/docs/` | Cloudflare Pages | Read the Docs for Business | GitHub Pages from this repository |
| --- | --- | --- | --- | --- |
| A user can open it | yes | yes | yes | yes |
| No paid plan while the repository is private | yes | yes | no (Business plan) | no (paid GitHub plan) |
| **Survives** | **yes** | **yes** | no | no |

| Criterion | Weight | Personal site, `/browser-hand/docs/` | Cloudflare Pages |
| --- | ---: | ---: | ---: |
| Performance efficiency | 35 | 4 | 5 |
| Compatibility | 25 | 5 | 3 |
| Security | 20 | 4 | 4 |
| Running cost and operability | 20 | 5 | 3 |
| **Weighted total** | **100** | **4.45** | **3.90** |

- Efficiency: both CDN-served static files; Cloudflare's edge is broader
  (5). Not measured for these pages.
- Compatibility 5: the same host, path and copy step as the landing
  page, which links `docs/`; Cloudflare is a second home (3).
- Security: equal; the personal site already sends a CSP and headers, and
  Cloudflare can through `_headers`.
- Operability: the personal site deploys on push with a workflow that
  exists (5); Cloudflare adds an account and an API token (3).

Sensitivity: moving 10 points from compatibility to efficiency gives 4.35
against 4.10; the winner holds.

**Chosen: the personal site at `/browser-hand/docs/`, beside plan 10's
page, copied from this repository's built book.** One host and one copy
step for the landing page and the reference. Revisit with plan 10 if the
repository goes public.

### Decision 3: what checks the links? (two-way door)

Searched 2026-10-22: "mdbook-linkcheck mdBook 0.5 broken link check CI
warnings as errors", "mdbook-linkcheck mdbook 0.5 compatibility
unmaintained lychee offline html"; read the mdbook-linkcheck crate pages
(`warning-policy = "error"`; the mdBook versions it supports are a
constant whose range was not found, and 0.5 broke renderers) and lychee's
`--offline` mode, which checks built HTML without a network.

| Must | lychee `--offline` on the built HTML | mdbook-linkcheck |
| --- | --- | --- |
| Works with the pinned mdBook 0.5.x | yes (reads output, not mdBook) | not confirmed |
| Runs without a network | yes | yes (`follow-web-links = false`) |
| **Survives** | **yes** | no |

**Chosen: lychee `--offline` on the built book.** It does not depend on
mdBook's renderer interface. Revisit if mdbook-linkcheck confirms 0.5
support.

## The decision

The book lives in `docs/book/` (`book.toml`, `src/SUMMARY.md`), beside
the internal `docs/protocol.md` and `docs/research/`, and builds to
`docs/book/out/` (ignored by git), with mdBook (decision 1). Pages:
introduction, getting started (build, load the extension in a profile,
add the plugin, a first task), guides (choosing profiles, pace and how
input moves, blocked and read-only sites, recording and replay,
screenshots and GIFs, troubleshooting), examples, and a reference of
tools, commands and settings. The tool and settings pages are generated
by `cargo test`, the way `extension/src/wire.gen.ts` already is, and the
same test fails when they are stale. `scripts/check-docs.sh` builds the
book, fails on any warning, runs lychee offline (decision 3) and refuses
private details; `make check` from `plans/09-quality-gates.md` runs it.
The built book is copied into the personal site at `/browser-hand/docs/`
next to plan 10's page (decision 2); that copy is the other repository's
change, in the same plan there that plan 10's `## Follow-ups` names.

Dependencies: none in the crates or `extension/package.json`; the
settings schema uses the `schemars` that `rmcp` already re-exports. Tools:
mdBook and lychee binaries, versions pinned in `docs/standards.md`,
installed with `cargo install --locked`. Permissions: none.

Standards: `docs/standards.md` (`plans/09-quality-gates.md` makes it
`make check`); this plan adds `scripts/check-docs.sh` to it.

## Security

What is protected: visitors to a public page, and what is private on
this Mac (profile names that are often email addresses, home paths,
recordings of the user's own steps) and in the private repository.
Who can reach the docs: anyone, read-only; there is no input.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Information disclosure | a real profile name, email, `/Users/` path, recording or screenshot of a signed-in page in a guide | examples use the fake profiles of `host/tests/mcp.rs` `fake_profile` and `host/tests/fixtures/`; screenshots only of local test pages; `scripts/check-docs.sh` refuses `/Users/`, `@` addresses outside an allow-list and links into the private repository | the script refuses a page with each planted, in Phase 4 |
| Tampering | a third-party script or font in the built book | mdBook's bundled assets only, no CDN; the personal site's CSP (`script-src 'self' 'unsafe-inline'`) | lychee and the script fail on an external `src=` in `docs/book/out/` |
| Tampering | a changed mdBook or lychee release in the build | versions pinned and installed with `--locked` | `docs/standards.md` names them; CI installs those |

Data: none collected. Secrets: none. Checklist: the OWASP Top 10's
security misconfiguration entry (current edition), through the personal
site's headers, as plan 10.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `docs/book/book.toml` | new | 1 | the book's config, output in `out/` | expected |
| `docs/book/src/` | new | 1-3 | the pages and `SUMMARY.md` | expected |
| `host/tests/docs.rs` | new | 2 | writes and checks the generated pages | expected |
| `host/src/config.rs` | edit | 2 | `Settings` and its sections derive `JsonSchema` | reuse |
| `Makefile` | edit | 1, 4 | `docs`, `docs-serve`; `check` runs the docs check (plan 09 creates it) | expected |
| `scripts/check-docs.sh` | new | 4 | build with no warnings, offline links, no private details | expected |
| `.github/workflows/ci.yml` | edit | 4 | installs the pinned mdBook and lychee | reuse |
| `site/index.html` | edit | 5 | a link to `docs/` (plan 10 creates it) | expected |
| `README.md` | edit | 5 | links the docs; tools and settings move there | reuse |
| `docs/standards.md` | edit | 1, 4 | tool pins and the docs check row | reuse |

*Reused, not rewritten:*

- `README.md` § Install and § Settings, `plugin/skills/browser-hand/SKILL.md`
  and `host/src/instructions.md`: the source of the first pages.
- `Server::tool_router()` in `host/src/mcp.rs`: the tool list, names,
  descriptions and input schemas the tools page is generated from.
- The `ts-rs` pattern in `host/src/wire.rs`: a file regenerated by
  `cargo test`, so the docs pages are kept the same way.
- `host/tests/mcp.rs` `fake_profile`: the made-up profiles every example
  uses. Searched the repository for an existing book, docs HTML or a docs
  build: none.

## Declined

- MkDocs Material: fails the maintenance must after 05/11/2026.
- rustdoc: documents crate items, not the tools a user calls.
- Starlight, Sphinx, Zensical, Docusaurus: lower totals, each losing on
  security (a package tree) and on compatibility; Zensical also on
  reliability (alpha).
- Read the Docs (ragrank's host) and GitHub Pages from this repository:
  each needs a paid plan while the repository is private.
- Cloudflare Pages: lost on compatibility and operability, as in plan 10.
- mdbook-linkcheck: support for mdBook 0.5 not confirmed.

## What the tests hold

`host/tests/docs.rs` holds that `reference/tools.md` matches
`Server::tool_router()` (every tool, description and input field),
`reference/settings.md` matches the `Settings` schema (every key, type
and default) and `reference/commands.md` names every command
`host/src/main.rs` accepts. `scripts/check-docs.sh` holds that the book
builds with no warnings, no internal link is broken, nothing loads from
outside, and no page holds a home path, an email or a private repository
link.

## Follow-ups

- The copy into `izam-mohammed.github.io` at `/browser-hand/docs/` goes in
  that repository's plan for `/browser-hand/` (plan 10's follow-up), not
  written here, which is limited to this repository.
- `plans/07-install-extension.md` changes getting started once the Web
  Store listing is live; that plan updates the page with its code.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: the rough cut: the book builds locally with getting started and one guide (needs you: try it)

- [x] `docs/book/` builds with mdBook: an introduction, a getting started
  page (build, Load unpacked in one profile, add the plugin, a first task
  to ask Claude) and one real guide, blocked and read-only sites, written
  from `README.md`; `make docs` builds it and `make docs-serve` serves it;
  `out/` ignored by git.
- [x] `docs/standards.md` names the pinned mdBook version and how to
  install it.
- [ ] Check: the project's check command from `docs/standards.md` passes,
  and `make docs` writes `docs/book/out/index.html` with no warning.
- [ ] You try it: run `make docs-serve`, follow getting started in a
  profile without the extension, and say what is missing, wrong or in the
  wrong order. What you want changed goes into the phases below.

### Phase 2: the reference is generated from the host

- [x] `reference/tools.md` (every tool with its description, read-only
  hint and input fields from `Server::tool_router()`) and
  `reference/settings.md` (every key in its section with type, default
  and what the settings page calls it, from a `JsonSchema` derive on
  `Settings`) are written by `UPDATE_DOCS=1 cargo test --test docs` and
  checked by the same test without it, pinned by `host/tests/docs.rs`.
- [x] `reference/commands.md` lists `mcp`, `native-host`,
  `install [--uninstall]` and `reload`, and the test fails when
  `host/src/main.rs` accepts a command the page does not name.
- [x] Check: the project's check command passes, and a changed tool
  description without regenerating fails `cargo test --test docs`.

### Phase 3: guides and examples

- [x] Guides for choosing profiles, pace and how input moves, recording
  and replay (as `plans/08-recorder-popup.md` leaves it), screenshots and
  GIFs, and troubleshooting (the host not running, the extension not
  connected, `reload`), in `docs/book/src/guides/`.
- [x] An examples page of tasks to ask Claude, each with the tool calls
  it leads to, using only the fake profiles of `host/tests/mcp.rs`.
- [ ] Check: the project's check command passes, and `make docs` shows
  every page in the sidebar.

### Phase 4: the docs check in `make check` and CI

- [x] `scripts/check-docs.sh` builds the book and fails on any `WARN` or
  `ERROR` line, runs `lychee --offline` on `docs/book/out/`, and refuses
  a `/Users/` path, an email outside an allow-list, an external `src=` or
  a link into the private repository; `make check` runs it.
- [x] `.github/workflows/ci.yml` installs the pinned mdBook and lychee
  before `make check` (the job `plans/09-quality-gates.md` Phase 5 sets
  up); if that phase has not landed, this item waits for it.
- [x] `docs/standards.md` gains the docs check row and the lychee pin.
- [ ] Check: `make check` passes, and a planted broken link, `/Users/`
  path and email each make `sh scripts/check-docs.sh` fail.

### Phase 5: linked from the landing page and the README

- [ ] `site/index.html` (from `plans/10-site.md`) links `docs/`, and
  `README.md` links the published docs and keeps only the pitch, a short
  install and the link once the copy in `izam-mohammed.github.io` is live
  (its own plan, `## Follow-ups`).
- [ ] Check: `make check` passes, `scripts/check-site.sh` still passes,
  and `/browser-hand/docs/` on the personal site returns the book with
  working search.

### Phase 6: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, bring the open PR's body up
  to date) with a Conventional Commit title for the whole change, a body
  naming this plan, what changed and why, and the checks run with their
  result. The PR's URL printed as the evidence. Opened, never merged.
