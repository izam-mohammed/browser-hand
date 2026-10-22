# the repository keeps its dependencies current, says how to report a vulnerability and carries an MIT licence

## The ask

The owner, 22/10/2026: "have dependabot in all of my repos", "have proper
security.md file for all of my repos", and "proper licence for all of the
repos ... which is a product in nature ... even for private ones". Also:
"for these changes, have proper plans and complete that plans and raise
prs. don't merge anything to main".

What `origin/main` has today: one workflow (`.github/workflows/ci.yml`), a
Rust native host and MCP server (`host/Cargo.toml`), a Chrome extension
built with npm (`extension/package.json`), three Rust proof crates under
`scripts/prove/` (`config-toml`, `gif-encode`, `rmcp-stdio`), and no
`.github/dependabot.yml`, `SECURITY.md` or `LICENSE`. No repository topics
are set. The repository is private and has tags but no GitHub release.

## Alternatives

### Decision 1: which bot keeps dependencies current (two-way door)

Searched 22/10/2026: "Renovate vs Dependabot comparison 2026",
"dependabot.yml supported package-ecosystem values"; the GitHub Docs
dependabot options reference, comparison posts from appsecsanta.com and
turbostarter.dev.

| Must | Dependabot (user's pick) | Renovate |
| --- | --- | --- |
| Covers github-actions, cargo and npm | yes | yes |
| Runs with no extra app, token or host | yes (built into GitHub) | no (needs the Renovate app installed or a self-hosted runner) |
| **Survives** | **yes** | no |

**Chosen: Dependabot.** It is the owner's pick and the only option that
needs nothing installed. Revisit if grouped Dependabot PRs still prove too
noisy.

### Decision 2: which licence (one-way door for published copies)

Searched 22/10/2026: "MIT vs Apache-2.0 licence choice patent grant"; FOSSA
and fosshub comparisons.

| Must | MIT | Apache-2.0 |
| --- | --- | --- |
| Permissive, lets the owner ship it as a product | yes | yes |
| **Survives** | **yes** | **yes** |

| Criterion | Weight | MIT | Apache-2.0 |
| --- | ---: | ---: | ---: |
| Compatibility with other licences | 60 | 5 | 4 |
| Patent protection | 40 | 3 | 5 |
| **Weighted total** | **100** | **4.20** | **4.40** |

- Apache-2.0 compatibility 4: incompatible with GPL-2.0 (FOSSA).
- MIT patent protection 3: no explicit grant.

Sensitivity: the owner's list names MIT for this repository, a tool, and
the gap is small; MIT matches the owner's other tool repositories.

**Chosen: MIT**, as the owner listed for this repository. Revisit if a
contributor or user asks for an explicit patent grant.

## The decision

Repository settings and files only; no code changes, so there is no rough
cut to try. Topics are set with `gh repo edit`, a repository
setting. `.github/dependabot.yml` follows the owner's model in
`decisionsmith` (weekly, `cooldown: default-days: 7`, one group per
ecosystem, `ci(deps)` for actions and `chore(deps)` otherwise), covering
github-actions, cargo (`/host` and the three proof crates) and npm
(`/extension`) (Decision 1). `SECURITY.md` names this repository's real
pieces and the private reporting route. `LICENSE` is MIT (Decision 2);
`host/Cargo.toml` and `extension/package.json` have no licence field, so
none is added. Dependencies and permissions: none.

Security: no code, input, secret or permission changes; the security
policy and the update bot only reduce exposure.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `.github/dependabot.yml` | new | 2 | weekly grouped updates | fixed |
| `SECURITY.md` | new | 3 | security policy | fixed |
| `LICENSE` | new | 4 | MIT licence text | fixed |
| `README.md` | edit | 4 | one licence line at the end | expected |

*Reused, not rewritten:*

- `decisionsmith/.github/dependabot.yml` and `decisionsmith/SECURITY.md`:
  the owner's model for both files.
- `penpot-mcp/LICENSE`: the MIT text copied.

## Declined

- Renovate: needs an app or a self-hosted runner, which Dependabot does not.
- Apache-2.0: the owner listed MIT for this repository.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: topics

- [x] Topics set on GitHub to `rust`, `typescript`, `chrome-extension`,
  `mcp-server`, `claude-code`, `browser-automation`, `native-messaging`,
  `macos`; check: `gh repo view --json repositoryTopics` lists them.

### Phase 2: Dependabot

- [x] `.github/dependabot.yml` covers github-actions, cargo (`/host`,
  `/scripts/prove/config-toml`, `/scripts/prove/gif-encode`,
  `/scripts/prove/rmcp-stdio`) and npm (`/extension`), weekly with a
  7-day cooldown and one group each; check: the file parses as YAML.

### Phase 3: security policy

- [x] `SECURITY.md` says only the latest commit on `main` gets fixes, how to
  report privately to `@izam-mohammed`, what happens next, and the scope
  (native host, MCP server, extension, plugin, scripts, CI workflow);
  check: every path it names exists.

### Phase 4: licence

- [x] `LICENSE` holds the MIT text with `Copyright (c) 2026 Izam Mohammed`,
  and `README.md` ends with `MIT, see [LICENSE](LICENSE).`; check:
  `gh repo view --json licenseInfo` reports MIT once merged.

### Phase 5: open the PR

- [x] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.
