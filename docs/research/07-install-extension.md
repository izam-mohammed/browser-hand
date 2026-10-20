# Can browser-hand install its own extension?

Gathered 20/10/2026. Target: Google Chrome stable on macOS (the local build is
155.0.8059.80), the user's own machine and their real profiles, no admin
rights assumed. Chromium source was read at `refs/heads/main` on 20/10/2026
(chromium.googlesource.com and the github.com/chromium/chromium mirror), plus
the release branches `branch-heads/7390` (Chrome 141) and `branch-heads/7444`
(Chrome 142). Nothing here was run against Chrome: no Chrome was launched and
no Chrome file or setting was touched. "Verified" below means read in a
primary source (Chromium source, developer.chrome.com, Chrome Enterprise
docs); "inference" means reasoned from those, not seen at runtime.

## The question

Today the person installs browser-hand's extension by hand in every Chrome
profile: open `chrome://extensions`, turn on Developer mode, click
**Load unpacked**, pick `extension/dist`. The ID is fixed at
`ednpkicgdjiiihmophoifehfeeoabjdc` by the manifest `key`, so the native host
manifest (`host/src/install.rs`) can name it in `allowed_origins`.

Can `browser-hand install`, or `select_profile`, put the extension into each
profile by itself, with no clicks through `chrome://extensions`?

Short answer: not as an unpacked extension, not on branded Chrome, not
without admin rights. Every silent route is either removed (`--load-extension`),
blocked on the default data dir (CDP), protected by an HMAC (`Secure
Preferences`), or needs the device to be managed (policy). The cheapest
honest routes need the extension on the Chrome Web Store: then one file
written without admin rights gets every profile a one-click "Enable" prompt,
and an admin-installed policy gets zero clicks.

## Summary

| Route | Works on stable Chrome, macOS? | Per profile? | Needs admin? | User clicks | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1. `--load-extension` | No. Ignored since 137; the `--disable-features` escape hatch worked up to 141 and is gone from 142 | Was per launch, last-used profile | No | n/a | Dead |
| 2. External Extensions JSON, per user | Yes, but only for a Chrome Web Store ID; no local `.crx` since Chrome 44 | All profiles in the user data dir | No | 1 per profile ("Enable extension" prompt), after a Chrome restart | Best no-admin route once on the Web Store |
| 3. Enterprise policy (`ExtensionInstallForcelist`, `ExtensionSettings`) | Yes for a Web Store ID; a self-hosted update URL only if MDM-enrolled, domain-joined or Chrome Enterprise Core enrolled | All profiles (per-profile policy, applied to all) | Yes (root, MDM or an approved configuration profile) | 0; also hides the "started debugging" bar | Best route for people who can be admin |
| 4. Web Store (unlisted) plus a deep link per profile | Yes | Yes, one link per profile | No | 2 per profile ("Add to Chrome", then "Add extension") | Simple fallback; the ID changes unless the store keeps our key |
| 5. Edit `Preferences` / `Secure Preferences` | Not reliably: HMAC-protected and enforced on load on macOS | Per profile | No | 0 if it worked | Do not do this |
| 6. CDP `Extensions.loadUnpacked` | Only on a Chrome started with `--remote-debugging-pipe`, which Chrome 136+ ignores on the default data dir | Last-used profile of that launch | No | 0 | Not usable on the person's real profiles |
| 7. Chrome for Testing or Chromium | Flags still work there | Its own data dir | No | 0 | Not the person's Chrome or profiles |
| 8. Script the `chrome://extensions` UI | Possible in theory | Per profile | No, but needs macOS Accessibility and Automation grants | 0 after grants, if it does not break | Too fragile; not recommended |
| 9. Others (`chrome.management`, native host, `--load-and-launch-app`, local `.crx`) | No | n/a | n/a | n/a | None of them installs an extension |

## 1. `--load-extension`

What is possible: nothing on Google Chrome stable today.

- The PSA "Removing `--load-extension` flag in Chrome branded builds"
  (Richard Chen, chromium-extensions group, 04/04/2025): "Starting in Chrome
  137, we will remove the ability to load extensions via the
  --load-extension command-line flag", only in "official Chrome branded
  builds"; Chromium and Chrome for Testing keep it.
  https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ
- The 137 change was commit `290ed8046692651ce76088914750cb659b65fb17`
  ("Remove `--load-extension` switch on Chrome builds", bug 401529219,
  05/04/2025). It added a feature, `DisableLoadExtensionCommandLineSwitch`,
  so `--disable-features=DisableLoadExtensionCommandLineSwitch` turned the
  old behaviour back on.
  https://chromium.googlesource.com/chromium/src/+/290ed8046692651ce76088914750cb659b65fb17
- Verified in source: on `branch-heads/7390` (Chrome 141)
  `LoadExtensionsFromCommandLineFlag` still checks
  `base::FeatureList::IsEnabled(extensions_features::kDisableLoadExtensionCommandLineSwitch)`.
  On `branch-heads/7444` (Chrome 142) and on main it is a compile-time block:

  ```cpp
  #if BUILDFLAG(GOOGLE_CHROME_BRANDING) && !BUILDFLAG(IS_CHROMEOS)
      LOG(WARNING)
          << "--load-extension is not allowed in Google Chrome, ignoring.";
      return;
  ```

  So the `--disable-features` workaround works in 137 to 141 and does
  nothing from 142 on. Selenium and SeleniumBase users report the same
  boundary ("works ... up to Chrome browser version 141"):
  https://github.com/SeleniumHQ/selenium/issues/16532,
  https://github.com/seleniumbase/SeleniumBase/issues/4053
- Even in unbranded builds it is ignored for profiles with Enhanced Safe
  Browsing, and for profiles where the `ExtensionInstallTypeBlocklist`
  policy lists `command_line` (source, `extension_service.cc`).
- Per profile: the switch was read by each profile's `ExtensionService` at
  start. When Chrome is already running, `open -na "Google Chrome" --args
  ...` hands the command line to the running process
  (`docs/external/chrome-profiles-and-launch.md`), and
  `StartupBrowserCreator::ProcessCommandLineAlreadyRunning` handles profile,
  URLs and app switches, not `--load-extension` (source reading of
  `startup_browser_creator.cc`; inference that it was never honoured for an
  already-running process).

What is not possible: any use of this switch in Chrome 142 or later.

## 2. External Extensions JSON files

What is possible: a JSON file per extension ID that tells Chrome to fetch
the extension from the Chrome Web Store. The per-user folder needs no admin
rights.

- Docs, "Alternative extension distribution options"
  (https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions):
  per user `~/Library/Application Support/Google/Chrome/External Extensions/`,
  all users `/Library/Application Support/Google/Chrome/External Extensions/`;
  the file is `<id>.json` with `external_update_url`.
  - "On Windows and macOS, the `update_URL` must point to the Chrome Web
    Store."
  - "As of Chrome 44, no external installs are allowed from a path to a
    local CRX file on Mac OS."
  - "Windows and macOS users will have to enable the extension using the
    following confirmation dialog."
  - "If a user uninstalls via the UI, the external extension is blocklisted."
  - Chrome reads these files at startup. The page is marked last updated
    2012, so the source was checked too.
- Source (`external_provider_impl.cc`, main): macOS registers a per-user
  provider for `chrome::DIR_USER_EXTERNAL_EXTENSIONS` with
  `ExternalPrefLoader::NONE`, so no ownership check. The all-users folder
  goes through `ENSURE_PATH_CONTROLLED_BY_ADMIN`: the file "and every
  directory in its path, must be owned by root, have group "admin", and not
  be writable by all users" (`external_pref_loader.cc`).
- Source (`external_install_manager.cc`): externally installed extensions
  are disabled with `DISABLE_EXTERNAL_EXTENSION` until the person accepts;
  the alert is shown at most `kMaxExtensionAcknowledgePromptCount = 3`
  times.
- Source (`extensions/browser/install_verifier.cc`): on branded Chrome for
  Windows and macOS the install verifier is in `ENFORCE` mode, and any
  extension that is not unpacked, not a component, not allowed by policy
  and not from the Web Store "must remain disabled"
  (`DISABLE_NOT_VERIFIED`). So even a non-store `.crx` that got past the
  loader would be switched off.
- Per profile: the providers are created per profile's `ExtensionService`,
  and the per-user folder sits in the user data dir that all profiles
  share, so one file reaches every profile (inference from source; not run).

What is not possible: an unpacked folder or a local or self-hosted `.crx`.
The route needs the extension on the Chrome Web Store, a Chrome restart (or
the profile loading fresh) for Chrome to read the file, and one click per
profile. Once a person removes it from the UI, the file no longer
reinstalls it.

## 3. Enterprise policy

What is possible: silent install in every profile, which the person cannot
remove, and no "started debugging" bar.

- `ExtensionInstallForcelist` (policy definition YAML, main,
  `components/policy/resources/templates/policy_definitions/Extensions/ExtensionInstallForcelist.yaml`;
  also https://chromeenterprise.google/policies/#ExtensionInstallForcelist):
  entries are `<id>` or `<id>;<update URL>`, default the Web Store; the
  update URL may be `http`, `https` or `file`. "On macOS instances, apps and
  extensions from outside the Chrome Web Store can only be force installed
  if the instance is managed via MDM, joined to a domain via MCX or enrolled
  in Chrome Enterprise Core." It is `per_profile: true`, and is not marked
  as recommendable, so only the mandatory (forced) form counts.
- `ExtensionSettings` has the same macOS rule, and `installation_mode:
  force_installed` with `update_url` and `override_update_url`.
- Source, how macOS reads policy (`policy_loader_mac.mm`): it reads
  `com.google.Chrome` through CFPreferences; a value is mandatory only if
  `AppValueIsForced`, which means managed preferences (MDM, a configuration
  profile, or `/Library/Managed Preferences`). A plain `defaults write
  com.google.Chrome ...` in the user domain is only "recommended", which
  the forcelist ignores. Writing a forced value needs root or an installed
  configuration profile (inference: installing a `.mobileconfig` by hand
  means approving it in System Settings with an admin password).
- Source, the "sensitive policy" filter (`policy_loader_common.cc`): if the
  Mac is not MDM-enrolled or domain-joined, every forcelist or
  `ExtensionSettings` entry whose update URL is not the Web Store's is
  renamed with a `[BLOCKED]` prefix and dropped. Web Store entries pass.
- Source, the debugger bar (`chrome/browser/extensions/api/debugger/debugger_api.cc`):

  ```cpp
  // We allow policy-installed extensions to circumvent the normal
  // infobar warning. See crbug.com/41302695.
  const bool suppress_warning =
      base::CommandLine::ForCurrentProcess()->HasSwitch(
          ::switches::kSilentDebuggerExtensionAPI) ||
      Manifest::IsPolicyLocation(extension_->location());
  ```

  So a force-installed browser-hand would never show "browser-hand started
  debugging this browser". `--silent-debugger-extension-api` does the same
  for every extension but is a browser-wide switch read at process start;
  passing it through `open -na` to a running Chrome does nothing
  (inference from the process singleton hand-off).
- Chrome Enterprise Core enrollment (which also unlocks self-hosted update
  URLs on macOS) is "No cost"
  (https://chromeenterprise.google/products/chrome-enterprise-core/), but
  needs a Google Admin console account and an enrollment token in
  `/Library/Google/Chrome/CloudManagementEnrollmentToken`: "You need to add
  the text file at device level. It won't work if you add it at user level"
  (https://support.google.com/chrome/a/answer/9301891). So: admin rights,
  and the person's browser then reports to that console.
- Also from source (`extension_management.cc`): with the feature
  `kDisableOffstoreForceInstalledExtensionsInLowTrustEnviroment` on, a
  force-installed off-store extension in a "low trust" environment is
  disabled anyway. Another reason to use the Web Store ID.
- Admin also unlocks `ExtensionDeveloperModeSettings` and
  `ExtensionInstallAllowlist`, but neither installs anything.

What is not possible without admin: any of it. Without MDM, domain join or
Chrome Enterprise Core, a self-hosted (non-store) update URL is dropped even
with admin.

## 4. Chrome Web Store, unlisted, plus a deep link per profile

What is possible: publish once, then open the store page in each profile
from the command line; the person clicks twice per profile.

- Visibility "Unlisted": "allows anyone to install your item if they know
  its Chrome Web Store URL"
  (https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).
- Registration needs a one-time fee and an account in a supported country
  (https://developer.chrome.com/docs/webstore/register; the page does not
  state the amount).
- Review "within a few days, but it can take up to a few weeks"; new
  developers, new extensions, `<all_urls>` and powerful permissions such as
  `tabs` and `webRequest` take longer
  (https://developer.chrome.com/docs/webstore/review-process). browser-hand
  asks for all of those plus `debugger` and `nativeMessaging`, so expect the
  slow end, and expect a request to justify each permission.
- Deep link: `open -na "Google Chrome" --args --profile-directory="Profile 3"
  https://chromewebstore.google.com/detail/<id>` opens the page as a tab in
  that profile, whether Chrome is running or not
  (`docs/external/chrome-profiles-and-launch.md`). The person clicks "Add to
  Chrome", then "Add extension" in the permission dialog.
- The ID: the documented flow goes the other way, store to local: upload,
  then copy "View public key" into the local manifest `key` so local builds
  match the store ID (https://developer.chrome.com/docs/extensions/reference/manifest/key).
  Whether the store accepts our existing `key` on the first upload, keeping
  `ednpkicgdjiiihmophoifehfeeoabjdc`, is not documented. Plan for a new ID
  and list both IDs in the host manifest's `allowed_origins`, as Claude in
  Chrome does (route 9).
- A Web Store install does not need Developer mode, is not disabled when
  Developer mode is off, auto-updates, and is the ID that routes 2 and 3
  need.

What is not possible: zero clicks, or skipping the review, or keeping
development builds and store builds on one ID without moving the local
`key` to the store's.

## 5. Editing `Preferences` or `Secure Preferences`

Not recommended. It tampers with Chrome's integrity checks, and Chrome is
built to undo it.

- Source (`chrome/browser/prefs/chrome_pref_service_factory.cc`): on macOS
  and Windows `GetSettingsEnforcementGroup()` returns
  `GROUP_ENFORCE_DEFAULT`, which turns the tracked pref
  `extensions.settings` to `ENFORCE_ON_LOAD`. `extensions.ui.developer_mode`
  is `ENFORCE_ON_LOAD` too. Tracked prefs carry an HMAC keyed with a seed
  from Chrome's resources (`IDR_PREF_HASH_SEED_BIN`, branded builds only)
  and the device; a value whose MAC does not match is reset on load.
- So writing an unpacked entry into `extensions.settings` and flipping
  Developer mode both need a forged MAC. Tools that do this exist, but they
  copy what malware does, they break whenever Chrome changes the scheme, and
  writing while Chrome runs is overwritten.
- Even a correct entry is not enough: an unpacked extension is disabled with
  `DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION` whenever the profile's Developer
  mode is off (`ExtensionManagement::IsAllowedByUnpackedDeveloperModePolicy`,
  main).

## 6. CDP `Extensions.loadUnpacked`

What is possible: load an unpacked folder into a Chrome that this tool
started itself, on a separate data dir.

- Protocol (`Extensions.pdl`, experimental domain): `loadUnpacked(path,
  enableInIncognito?) -> id`, "Installs an unpacked extension from the
  filesystem similar to --load-extension CLI flags."
  https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Extensions.pdl
- Source (`chrome/browser/devtools/protocol/extensions_handler.cc`): returns
  "Method not available." unless the session is a trusted browser-target
  session; installs into
  `DevToolsBrowserContextManager::GetDefaultBrowserContext()`, which is the
  last used profile, not a chosen one; marks it `installed_via_cdp`, which
  exempts it from the Developer mode check above.
- Google's own example (Oliver Dunk, in the PSA thread) and third-party
  guides launch with `--remote-debugging-pipe` and
  `--enable-unsafe-extension-debugging`
  (https://bitcrowd.dev/loading-chrome-extensions-for-development-in-2025/).
  The pipe handler's `AllowUnsafeOperations()` returns true; the place where
  main checks `--enable-unsafe-extension-debugging` was not found in this
  pass (open question).
- The blocker: "from Chrome 136 ... `--remote-debugging-port` and
  `--remote-debugging-pipe` ... will no longer be respected if attempting to
  debug the default Chrome data directory" and "must now be accompanied by
  the `--user-data-dir` switch to point to a non-standard directory"
  (https://developer.chrome.com/blog/remote-debugging-port). No override is
  mentioned. And a pipe only exists on a Chrome the tool launched as a child;
  it cannot be attached to the person's running Chrome, and `open -na`
  forwards to the running process anyway.

What is not possible: using this on the person's real profiles. It would
need Chrome quit and relaunched by browser-hand on another data dir, which
is not their profiles.

## 7. Chrome for Testing or Chromium

What is possible: `--load-extension`, CDP and the pipe all still work there
(the PSA; the 136 blog post recommends Chrome for Testing for automation).

What is not possible: the person's own profiles. These builds use their own
data dir. Pointing one at `~/Library/Application Support/Google/Chrome`
risks a profile written by a different Chrome version, cannot run while the
person's Chrome holds the profile lock, and would likely not read cookies
and passwords encrypted under Google Chrome's Keychain entry (inference, not
tried). It defeats browser-hand's point, which is the person's own signed-in
Chrome.

## 8. Scripting the `chrome://extensions` UI

What is possible in theory:

- AppleScript `execute javascript` on a Chrome tab runs script in an
  isolated world, with no scheme check in the handler
  (`chrome/browser/ui/cocoa/applescript/tab_applescript.mm`), but only when
  the person has turned on View > Developer > Allow JavaScript from Apple
  Events, which is off by default (https://chromium.org/developers/applescript).
  It could click the Developer mode toggle inside the page's shadow DOM.
- "Load unpacked" opens a native macOS folder picker; filling it needs
  System Events keystrokes (Cmd+Shift+G, the path, Return), which needs the
  Accessibility permission for the calling app, plus the Automation
  permission to send Apple Events to Chrome.
- `chrome://` URLs cannot be opened from Chrome's command line: launch URLs
  must pass `ValidateLaunchUrlWebUnsafe`, which takes web-safe schemes,
  `file:` and `about:blank` (`docs/external/chrome-profiles-and-launch.md`),
  so even reaching the page per profile needs UI scripting (inference).

What is not possible reliably: it breaks with any change to the page's
markup or the dialog, with focus changes, with localisation, and it asks
the person for two macOS privacy grants plus a hidden Chrome setting. That
is more clicks than doing it by hand. Not recommended.

## 9. Other routes checked

- `chrome.management`: methods are `get`, `getAll`, `setEnabled`,
  `uninstall`, `launchApp` and similar; none installs an extension
  (https://developer.chrome.com/docs/extensions/reference/api/management).
  It also needs an extension already installed.
- `chrome.developerPrivate.loadUnpacked` exists, but only for the
  `chrome://extensions` page itself (inference from its private API status).
- The native host: Chrome starts it only for an extension that is already
  installed and named in `allowed_origins`; it has no install API. It is a
  plain process with the person's file rights, so it could only use the
  file routes above (2 and 5).
- `--load-and-launch-app` and `--load-apps`: these do reach an
  already-running Chrome (`StartupBrowserCreator`), but they call
  `UnpackedInstaller::LoadFromCommandLine(..., only_allow_apps = true)`
  (`chrome/browser/apps/platform_apps/app_load_service.cc`), so an
  extension is refused. Chrome Apps are deprecated anyway.
- Dragging a folder or `.crx` onto `chrome://extensions`: a folder with
  Developer mode on loads unpacked (one drag in place of the folder picker;
  not verified at runtime); an off-store `.crx` is disabled by the install
  verifier on macOS (route 2).
- Claude in Chrome (`reference/claude-in-chrome/`): the extension is on the
  Chrome Web Store (its manifest carries `"update_url":
  "https://clients2.google.com/service/update2/crx"`), the person installs
  it from the store, and Claude Code and the Claude app each write a native
  host manifest. The app's manifest lists three extension IDs in
  `allowed_origins` (`dihbgbndebgnbjfmelmegjepbnkhlgni`,
  `fcoeoabgfenejglbffodgkkbkcdhcgfn`, `dngcpimnedloihjnnfngkgjoidhnaolf`),
  so one host serves several builds. Anthropic does not install the
  extension for the person either.

## Recommendation

Ordered by how little the person has to do, then by what it costs us.

1. Publish browser-hand to the Chrome Web Store as unlisted, and add the
   store ID next to `ednpkicgdjiiihmophoifehfeeoabjdc` in `allowed_origins`
   (`host/src/install.rs`). Keep the local `key` for development builds.
   This is the precondition for every route that saves clicks.
2. Then `browser-hand install`, with no admin rights, writes
   `~/Library/Application Support/Google/Chrome/External Extensions/<store id>.json`
   containing `{"external_update_url": "https://clients2.google.com/service/update2/crx"}`.
   On the next Chrome start every profile shows an "Enable extension"
   prompt: one click per profile, no Developer mode, auto-updates.
   `--uninstall` removes the file too.
3. `select_profile`, for a profile with no connected extension, opens the
   store page in that profile (`open -na "Google Chrome" --args
   --profile-directory=<dir> https://chromewebstore.google.com/detail/<store id>`)
   and tells Claude to ask the person to click "Add to Chrome". This covers
   a person who dismissed the prompt, and Chrome not yet restarted.
4. Offer, not require, a policy path for people who are admin on their Mac:
   a `.mobileconfig` with `ExtensionInstallForcelist` =
   `<store id>;https://clients2.google.com/service/update2/crx` that they
   approve in System Settings. Zero clicks in every profile, and no
   "started debugging" bar. Say plainly that it makes the browser show as
   managed.
5. Until the store item exists, keep Load unpacked, but cut it down: have
   `browser-hand install` reveal `extension/dist` in Finder (`open -R`) and
   open a `file://` help page in each profile without the extension; the
   person turns on Developer mode and drags the folder in. Warn that turning
   Developer mode off later disables the unpacked extension.

Do not build: `--load-extension` (gone in 142), `Preferences` editing
(integrity bypass), CDP on a relaunched Chrome (not the person's profiles),
or UI scripting (fragile, needs privacy grants).

## Open questions

- Does the Web Store keep our manifest `key` (and so the current ID) on the
  first upload, or always assign a new one? Test with a throwaway item.
- Will the review accept `debugger` plus `<all_urls>` plus `nativeMessaging`
  for an unlisted item, and how long does it take?
- Exactly what the "Enable extension" prompt for an External Extensions file
  looks like on Chrome 155, and whether it shows in every profile on the
  first start or only in the profile opened first. Needs a run in two
  profiles.
- Does a forced value placed by hand in `/Library/Managed Preferences` on an
  unmanaged Mac survive a reboot, or must it be a configuration profile?
- Where main checks `--enable-unsafe-extension-debugging` (only relevant if
  a separate-data-dir mode is ever wanted).
- Whether dragging a folder onto `chrome://extensions` still loads it
  unpacked in Chrome 155.

## Searches

- 20/10/2026: "DisableLoadExtensionCommandLineSwitch Chrome --disable-features
  load-extension stopped working"; SeleniumBase #4053, Selenium #16532.
- 20/10/2026: "chromium commit remove kDisableLoadExtensionCommandLineSwitch
  feature flag 401529219".
- 20/10/2026: "--enable-unsafe-extension-debugging Extensions.loadUnpacked
  remote-debugging-pipe Chrome stable"; bitcrowd.dev guide, the PSA thread.
- 20/10/2026: "Chrome unpacked extensions disabled when developer mode
  turned off" (answered from source instead).
- 20/10/2026: "Chrome Web Store upload zip key.pem first upload keep
  extension ID" (no primary answer; open question).
- 20/10/2026: "Allow JavaScript from Apple Events Chrome execute javascript
  chrome:// pages".
- Chromium source read: `extension_service.cc` (main, 7390, 7444),
  `extension_features.cc`, `external_provider_impl.cc`,
  `external_pref_loader.cc`, `external_install_manager.cc`,
  `install_verifier.cc`, `extension_management.cc`,
  `policy_loader_mac.mm`, `policy_loader_common.cc`,
  `chrome_pref_service_factory.cc`, `debugger_api.cc`,
  `extensions_handler.cc`, `chrome_devtools_session.cc`,
  `devtools_browser_context_manager.cc`, `devtools_pipe_handler.cc`,
  `startup_browser_creator.cc`, `app_load_service.cc`,
  `tab_applescript.mm`, and the `ExtensionInstallForcelist` and
  `ExtensionSettings` policy YAML.
