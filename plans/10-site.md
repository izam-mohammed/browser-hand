# browser-hand has a one-page site that says what it does and how to get it

## The ask

The user wants every repository to carry a `site/` folder holding a
presentable one-page site for users, with
`mac-notch/site/index.html` as the reference, and to know how it is
published. browser-hand has no `site/` today
(`docs/built/BUILT-2026-10-22-1828.md`).

What the reference turned out to be: one self-contained HTML file (inline
CSS and SVG, no scripts, no fonts fetched), one screen, a pitch, one
download button to the latest release, and a short list of what it does
(`mac-notch` commit `9e588fc`). It is not published anywhere yet: the
mac-notch repository is private and has no Pages site (GitHub's API
answers 404 for its Pages on 22/10/2026). browser-hand is private too, and
its install today is a build from source plus Load unpacked; the Chrome
Web Store listing is planned in `plans/07-install-extension.md` and not
live.

## Alternatives

### Decision 1: how is the page built? (two-way door)

Searched 2026-10-22: "single page product landing site plain static HTML vs
Astro page weight performance"; read an Astro against Next.js page-size
comparison (norbauer.com) and landing-page write-ups on dev.to, and the
reference page itself.

| Criterion | One hand-written HTML file (as mac-notch) | Astro, static output | Eleventy |
| --- | --- | --- | --- |
| Performance efficiency | one request, no JavaScript, about 8 KB for the reference | static HTML with no JavaScript for a page with no islands; same weight plus a build | same as Astro |
| Fit to the ask | one page | built for many pages | built for many pages |
| Maintainability of the result | one file, no build, no dependency | a `package.json` and a build step | a `package.json` and a build step |
| Security | no dependency | a dependency tree to audit | a dependency tree to audit |

**Chosen: one hand-written, self-contained `site/index.html`.** The page
weighs the same either way, and the file adds no build or dependency.
Revisit if the site grows past one page.

### Decision 2: where is it published? (two-way door)

The repository is private. GitHub's own docs list Pages for private
repositories only with GitHub Pro, Team or Enterprise ("Creating a
GitHub Pages site", docs.github.com), and Actions minutes on this account are
on a billing hold (`docs/built/BUILT-2026-10-22-1828.md`).

Searched 2026-10-22: "GitHub Pages private repository free plan
availability vs Cloudflare Pages static site", "GitHub Pages is available in
public repositories with GitHub Free"; read GitHub's Pages limits
page (1 GB per site, 100 GB a month soft bandwidth), secondary
comparisons of Cloudflare Pages (freetier.co, smartscope.blog), and `izam-mohammed.github.io`'s `CLAUDE.md`, `vercel.json` and
`.github/workflows/static.yml`.

| Must | Baseline: not published | GitHub Pages from this repository | A page in `izam-mohammed.github.io` | Cloudflare Pages |
| --- | --- | --- | --- | --- |
| A user can open it | no | yes | yes | yes |
| No paid plan while the repository is private | yes | no (Pages on a private repository needs a paid plan) | yes (that repository is public and already served by Pages) | yes |
| **Survives** | no | no | **yes** | **yes** |

| Criterion | Weight | `izam-mohammed.github.io` page | Cloudflare Pages |
| --- | ---: | ---: | ---: |
| Performance efficiency | 35 | 4 | 5 |
| Running cost and operability | 25 | 5 | 3 |
| Security | 20 | 4 | 4 |
| Reversibility | 20 | 5 | 4 |
| **Weighted total** | **100** | **4.45** | **4.10** |

- Efficiency: both are CDN-served static files; Cloudflare's edge is
  broader (5), GitHub Pages is a CDN too (4). Neither measured for this page.
- Operability: the personal site already deploys on push to `main` with a
  workflow that exists (5); Cloudflare adds an account, a project and an
  API token secret (3).
- Security: the personal site already sends a CSP and security headers
  through `vercel.json` and `_headers`; Cloudflare can send the same with a
  `_headers` file. Equal.
- Reversibility: a copied file moves anywhere (5); a Cloudflare project
  needs its token and project removed (4).

Sensitivity: moving 10 points from operability to efficiency gives 4.35
against 4.30; the winner holds, narrowly, and it is a two-way door.

**Chosen: a page in `izam-mohammed.github.io` at `/browser-hand/`, copied
from this repository's `site/index.html`.** No new account, secret or cost,
and the site is already live. Revisit if the repository goes public (then
GitHub Pages from here is free) or the personal site moves off Pages.

### Decision 3: where does the main button point? (two-way door)

Searched 2026-10-22: "chrome web store unlisted extension share link";
read Chrome's "Prepare to publish: set up distribution" page (unlisted:
anyone with the store URL can install), `docs/external/chrome-extension-distribution.md`
and `plans/07-install-extension.md`.

| Criterion | The Chrome Web Store listing | A GitHub release zip | Install steps on the page |
| --- | --- | --- | --- |
| Fit to the ask | the install a user expects, once plan 07 publishes it | private repository: a visitor gets 404 | works today, but needs Rust and Node |
| Reliability | the store keeps the URL | breaks for every visitor | correct while the build steps hold |

**Chosen: the Chrome Web Store listing once `plans/07-install-extension.md`
publishes it; until then the button reads "coming to the Chrome Web Store"
and links nowhere, with a line that it is in private testing.** Revisit when
the repository goes public (a release zip becomes reachable).

## The decision

`site/index.html` is one self-contained page in the reference's shape: the
banner idea redrawn inline, the pitch, the main button (decision 3), what
it does in a few words, and a footer (decision 1). It is published by
copying it into `izam-mohammed.github.io` as `browser-hand/index.html`
(decision 2); that copy is the other repository's change and has its own
plan there (`## Follow-ups`). Rough cut: the page opens from disk and reads
right; later phases make it hold in both themes and at phone width, and
link it from the README.

Dependencies and permissions: none. Network hosts: none from the page.

Standards: `docs/standards.md` (`plans/09-quality-gates.md` makes it
`make check`); this plan adds `scripts/check-site.sh` to it.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `site/index.html` | new | 1 | the page | fixed (the published copy's source) |
| `scripts/check-site.sh` | new | 2 | refuses scripts, external URLs and unsized images in the page | expected |
| `README.md` | edit | 3 | a link to the published page under the banner | reuse |
| `docs/standards.md` | edit | 2 | the site check row | reuse |

*Reused, not rewritten:*

- `mac-notch/site/index.html`: the layout, the no-script, no-font rule and
  the colour tokens on `:root`; copied as a shape, not as content.
- `assets/banner-light.svg` and `assets/banner-dark.svg`: the hero art,
  inlined so the page stays one file.
- `design/theme.md`: the extension's palette, so the page matches the
  settings page.
- KNOWLEDGE.md's headless-Chrome preview recipe: the screenshots in each
  phase's check.

## Security

What is protected: visitors to a public page, and the private repository's
details. Who can reach it: anyone, read-only; there is no input.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Information disclosure | a private path, an internal note or a private repository URL on a public page | the page names only what the README says to users; no link into the private repository | `scripts/check-site.sh` fails on `github.com/izam-mohammed/browser-hand` and on `/Users/` |
| Tampering | a third-party script or font on the page | no scripts, no external resources; the personal site's CSP (`default-src 'self'`) | `scripts/check-site.sh` fails on `<script` and on any `http` URL outside the allow-list |

Data: none collected. Secrets: none. Checklist: the OWASP Top 10's security
misconfiguration entry (current edition looked up in Phase 2), through the
personal site's headers.

## Open decisions

- Whether browser-hand goes public: default, it stays private, and the
  page never links into the repository.
- Which domain path: default, `izam-mohammed.github.io/browser-hand/`.

## Declined

- Astro and Eleventy: same page weight, plus a build and a dependency tree
  for one page.
- GitHub Pages from this repository: fails the no-paid-plan must while it
  is private.
- Cloudflare Pages: lost on running cost and operability (4.10 against
  4.45); a new account and an API token for one page.
- Not publishing (the mac-notch state today): fails "a user can open it".
- A GitHub release zip as the button: a 404 for visitors while the
  repository is private.

## What the tests hold

`scripts/check-site.sh` holds the page's rules: no script, no external
resource, no link into the private repository. The screenshots in each
check show the page in both themes and at 390 px wide.

## Follow-ups

- The copy into `izam-mohammed.github.io` needs its own plan in that
  repository (`browser-hand/index.html`, a sitemap line), with an order
  file here once both exist; not written in this turn, which is limited to
  this repository.
- The same `site/` question for mac-notch: it has the page but no
  publishing.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: the rough cut: the page opens and says it (needs you: try it)

- [x] `site/index.html` shows the inlined banner art, the name, a one-line
  pitch in the README's voice, the main button per decision 3, a short
  "what it does" row (profiles, reads pages, moves like a hand, records
  your steps) and a footer, in one self-contained file with no script.
- [ ] Check: the project's check command from `docs/standards.md` passes,
  and a headless-Chrome screenshot of `site/index.html` (KNOWLEDGE.md's
  recipe) shows the whole page on one screen at 1280 px wide.
- [ ] You try it: open `site/index.html` in Chrome and say whether the pitch,
  the art and the button are what you want a stranger to see. What you
  want changed goes into the phases below.

### Phase 2: it holds in both themes, at phone width, and by rule

- [x] The page follows `prefers-color-scheme` with tokens on `:root`, keeps
  a 16 px gutter at 390 px wide with no horizontal scroll, and passes
  4.5:1 text contrast (in `site/index.html`).
- [x] `scripts/check-site.sh` fails on a `<script`, an external URL outside
  an allow-list, a link into the private repository or a local path, and
  runs inside the project's check command; `docs/standards.md` gains its
  row.
- [ ] Check: the project's check command passes, and screenshots in dark
  and light at 1280 px and 390 px show no overlap or scroll.

### Phase 3: the README points at it

- [ ] `README.md` links the published page under the banner, once the copy
  in `izam-mohammed.github.io` is live (its own plan, `## Follow-ups`).
- [ ] Check: the project's check command passes, and the link opens the
  page.

### Phase 4: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.
