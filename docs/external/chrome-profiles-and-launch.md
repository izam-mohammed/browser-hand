# Chrome profiles and launching

Fetched: 17/10/2026 from https://developer.chrome.com/blog/remote-debugging-port, https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ, https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging, and Chromium source at `refs/heads/main` on chromium.googlesource.com: `chrome/common/pref_names.h`, `chrome/browser/profiles/profile_attributes_entry.cc`, `chrome/browser/ui/startup/startup_browser_creator.cc`, `chrome/browser/ui/startup/startup_browser_creator_impl.cc`, `chrome/browser/ui/startup/startup_tab_provider.cc`, `chrome/browser/ui/startup/url_util.cc`, `chrome/browser/chrome_browser_main.cc`, `chrome/browser/chrome_content_browser_client.cc`, `content/browser/security/cpsp/child_process_security_policy_impl.cc`, `chrome/browser/extensions/extension_service.cc`. Local read-only inspection of `~/Library/Application Support/Google/Chrome/Local State`.
Version: local Google Chrome 155.0.8059.80 on macOS (Darwin 25.5.0); Chromium source at main on 17/10/2026. There is no official developer documentation for the `Local State` file format; everything about it below comes from Chromium source and the local file.

## What this project uses

### `Local State`

Path for Google Chrome on macOS: `~/Library/Application Support/Google/Chrome/Local State` (JSON, one per user data dir, shared by all profiles).

Pref names (`chrome/common/pref_names.h`):

- `profile.info_cache` (`kProfileAttributes`): "A map of profile data directory to profile attributes. These attributes can be used to display information about profiles without actually having to load them." Keys are the profile directory base names, for example `Default`, `Profile 3`.
- `profile.last_used` (`kProfileLastUsed`): "Directory of the last profile used." A string equal to an `info_cache` key.
- `profile.last_active_profiles` (`kProfilesLastActive`): "List of directories of the profiles last active in browser windows. It does not include profiles active in app windows." A profile is added when its only browser window opens and removed when its last browser window closes. Used by `--session-restore`.
- `profile.profiles_order` (`kProfilesOrder`): profile picker order.

`info_cache` entry fields (`profile_attributes_entry.cc` constants):

- `name` (`kNameKey`): profile display name.
- `user_name` (`kUserNameKey`): signed-in account email; empty when not signed in.
- `gaia_name`, `gaia_given_name`: Google account full and given name.
- `gaia_id` (`kGAIAIdKey`), `is_consented_primary_account`, `hosted_domain`, `is_managed`, `enterprise_label`.
- `is_ephemeral` (`kProfileIsEphemeral`): boolean.
- `active_time` (`kActiveTimeKey`): double, seconds since the Unix epoch (`FromSecondsSinceUnixEpoch`). Only rewritten when the stored value is more than 1 hour old (`SetActiveTimeToNow`), so it is coarse.
- Avatar fields: `avatar_icon` (`kAvatarIconKey`, e.g. `chrome://theme/IDR_PROFILE_AVATAR_26`), `use_gaia_picture`, `gaia_picture_file_name`, `last_downloaded_gaia_picture_url_with_size`, `is_using_default_avatar`, `is_using_default_name`, `default_avatar_fill_color`, `default_avatar_stroke_color`, `profile_highlight_color`, `profile_color_seed`.
- Others seen: `background_apps`, `managed_user_id`, `metrics_bucket_index`, `force_signin_profile_locked`, `user_accepted_account_management`, `is_glic_eligible`, `ai_subscription_tier`.

Local verification (17/10/2026, `python3 -I`, names and emails not printed): `profile` has keys `info_cache`, `last_active_profiles`, `last_used`, `metrics`, `picker_shown`, `profile_counts_reported`, `profiles_created`, `profiles_order`, `show_picker_on_startup`. Three profiles keyed `Default`, `Profile 3`, `Profile 4` (directory numbers are not contiguous). `name`, `user_name`, `gaia_name`, `avatar_icon`, `gaia_id` are strings, `is_ephemeral` bool, `active_time` float. One profile has an empty `user_name`. `last_used` is an `info_cache` key; `last_active_profiles` held one entry, also an `info_cache` key.

### Opening a URL in a specific profile while Chrome is running (macOS)

Command: `open -na "Google Chrome" --args --profile-directory="Profile 3" <url>`

- Docs: not stated by developer.chrome.com.
- Source: a second Chrome process started on the same user data dir hands its command line to the running instance through the process singleton. `chrome_browser_main.cc` handles the notification by calling `GetStartupProfilePath(current_directory, command_line, /*ignore_profile_picker=*/false)` then `StartupBrowserCreator::ProcessCommandLineAlreadyRunning(...)`. `GetStartupProfilePath` reads `switches::kProfileDirectory` and resolves it against the running instance's user data dir. If that profile is not loaded it is loaded with `CreateProfileAsync` first.
- Window choice (`startup_browser_creator_impl.cc`, `DetermineBrowserOpenBehavior`): "If Chrome was launched with passed URLs, assume these should be appended to an existing window if possible, unless overridden by a switch." So the URL opens as a new tab in that profile's last active window (`GetLastActiveBrowser()`), or a new window if the profile has none. `--new-window` forces a new window, `--same-tab` overwrites the active tab, and `--open-in-background` adds the tabs "without taking the user's focus".
- With `--profile-directory` and no URL, `DetermineBrowserOpenBehavior` returns `NEW` for an already-running process, i.e. a new window for that profile (source reading, not verified).
- `--ignore-profile-directory-if-not-exists` makes Chrome ignore a non-existent directory instead of creating it.
- Not verified at runtime (Chrome was not launched).

### Opening `chrome-extension://<id>/page.html` from the command line

- Docs: not stated.
- Source: positional args go through `ParseTabFromCommandLineArg`, then `startup::ValidateLaunchUrlWebUnsafe(url)` (`url_util.cc`), which accepts `policy->IsWebSafeScheme(url.GetScheme())`, `file:`, `about:blank` and one settings-reset URL. `chrome_content_browser_client.cc` registers the extension scheme with `RegisterWebSafeIsolatedScheme(extensions::kExtensionScheme)` ("chrome-extension:// URLs are safe to request anywhere, but may only commit ... in extension processes"), and `IsWebSafeScheme` returns true for schemes in `schemes_okay_to_request_in_any_process_`, which that call populates. So by source reading a `chrome-extension://` URL passes launch validation and opens as a top-level tab. URLs passed via the `google-chrome://` direct-launch scheme go through `ValidateLaunchUrlWebSafe`, which only allows http(s) and about:blank.
- Not verified at runtime. Fallback that is documented: have the extension open its own page with `chrome.tabs.create({ url: "page.html" })`.

### Chrome 136: remote debugging switches ignored on the default user data dir

Blog post "Changes to remote debugging switches to improve security", published 17/03/2025 (https://developer.chrome.com/blog/remote-debugging-port):

- "from Chrome 136" `--remote-debugging-port` and `--remote-debugging-pipe` "will no longer be respected if attempting to debug the default Chrome data directory."
- "These switches must now be accompanied by the `--user-data-dir` switch to point to a non-standard directory."
- Recommends Chrome for Testing for automation, "which will continue to respect the existing behavior."

So external CDP into the user's real profiles is not available in Chrome 136+; driving real profiles needs an extension using `chrome.debugger`.

### Chrome 137: `--load-extension` removed in branded Chrome

- PSA "Removing `--load-extension` flag in Chrome branded builds" by Richard Chen (Chrome Counter Abuse), chromium-extensions group, 04/04/2025: "Starting in Chrome 137, we will remove the ability to load extensions via the --load-extension command-line flag"; "this change only applies to Chrome branded builds." Chromium and Chrome for Testing keep it.
- Source (`chrome/browser/extensions/extension_service.cc`, `LoadExtensionsFromCommandLineFlag`):

  ```cpp
  #if BUILDFLAG(GOOGLE_CHROME_BRANDING) && !BUILDFLAG(IS_CHROMEOS)
      LOG(WARNING)
          << "--load-extension is not allowed in Google Chrome, ignoring.";
      return;
  #else
      if (safe_browsing::IsEnhancedProtectionEnabled(*profile_->GetPrefs())) {
        VLOG(1) << "--load-extension is not allowed for users opted into "
                << "Enhanced Safe Browsing, ignoring.";
  ```

  In main it is a hard compile-time block for Google Chrome; there is no feature flag to re-enable it. Even in non-branded builds it is ignored for Enhanced Safe Browsing users.
- Install path instead (from the PSA): open `chrome://extensions`, enable "Developer mode", click "Load unpacked", choose the extension directory. This is per profile: repeat in each profile that should run the extension.

## Errors

- `--load-extension` in Google Chrome: silently ignored, logs "--load-extension is not allowed in Google Chrome, ignoring."
- Remote debugging switches on the default data dir: ignored (no error text stated in the blog post).
- Bad `--profile-directory`: by source reading Chrome uses (creates) that directory unless `--ignore-profile-directory-if-not-exists` is passed; not verified.

## Limits

- Number of profiles: not stated.
- `active_time` resolution: updated at most once per hour per profile (source).

## Gotchas

- `Local State` is written by the running browser; read it, never write it while Chrome runs. Its format is internal and undocumented, so parse defensively.
- `user_name`, `gaia_name`, `gaia_given_name` are personal information; do not log them.
- Profile directory names (`Profile 3`) are not display names; map via `info_cache[dir].name`.
- `last_used` is the last profile used, not necessarily one with a window open; check `last_active_profiles` for open windows.
- One user data dir means one Chrome process: `open -na` does not start a second browser on the same dir, it forwards to the running one.
- No CDP port, no `--load-extension`: in branded Chrome the extension must be installed by hand (Load unpacked) in each profile, or by enterprise policy.
