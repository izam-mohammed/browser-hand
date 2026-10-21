# Chrome extension distribution

Fetched: 20/10/2026 and 21/10/2026 from
https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions,
https://developer.chrome.com/docs/extensions/reference/manifest/key,
https://developer.chrome.com/docs/webstore/cws-dashboard-distribution,
https://developer.chrome.com/docs/webstore/register,
https://developer.chrome.com/docs/webstore/review-process,
https://chromeenterprise.google/policies/#ExtensionInstallForcelist, and
Chromium source at `refs/heads/main` (20/10/2026). The full reading, with
the source files and the routes ruled out, is
`docs/research/07-install-extension.md`.
Version: Google Chrome 155 stable on macOS; Chromium main on 20/10/2026.

## Authentication

None for anything browser-hand runs. Publishing needs a Chrome Web Store
developer account, made and paid for by the person in the dashboard; no
credential of it is used by this project.

## What this project uses

### External Extensions file, per user

- Folder: `~/Library/Application Support/Google/Chrome/External Extensions/`
  (all users: `/Library/Application Support/Google/Chrome/External Extensions/`,
  which must be owned by root, group admin, not world writable).
- File: `<extension id>.json`, the ID in lowercase, holding:

  ```json
  {
    "external_update_url": "https://clients2.google.com/service/update2/crx"
  }
  ```

- "On Windows and macOS, the `update_URL` must point to the Chrome Web
  Store." "As of Chrome 44, no external installs are allowed from a path to
  a local CRX file on Mac OS."
- Chrome reads the folder at startup. The extension is installed disabled
  (`DISABLE_EXTERNAL_EXTENSION`) until the person accepts the "Enable
  extension" prompt, shown at most 3 times
  (`external_install_manager.cc`, `kMaxExtensionAcknowledgePromptCount`).
- "If a user uninstalls via the UI, the external extension is blocklisted":
  the file no longer offers it in that profile.
- The per-user provider has no ownership check (`ExternalPrefLoader::NONE`
  in `external_provider_impl.cc`). The folder is in the user data dir every
  profile shares, so one file reaches every profile (inference from source,
  not run).

### Chrome Web Store, unlisted

- "Unlisted" visibility "allows anyone to install your item if they know
  its Chrome Web Store URL".
- Registration: a one-time fee, an account in a supported country.
- Review: "within a few days, but it can take up to a few weeks"; new
  developers, `<all_urls>` and powerful permissions take longer.
- Store page: `https://chromewebstore.google.com/detail/<id>`. Opening it in
  one profile: `open -na "Google Chrome" --args --profile-directory=<dir>
  <url>` (`docs/external/chrome-profiles-and-launch.md`). The person clicks
  "Add to Chrome", then "Add extension".
- The ID: the documented flow is store to local. Upload, then copy "View
  public key" from the Package tab into the local manifest `key`. The store
  does not accept a `key` field in an uploaded manifest (GWT commit note;
  the Edge store says the same). The older publishing guide put the private
  key as `key.pem` in the zip's root on the first upload to keep an ID;
  whether that still works is not documented today.

### `ExtensionInstallForcelist` policy

- Entries `<id>` or `<id>;<update url>`; default the Web Store. Per
  profile, mandatory only (a user `defaults write` is "recommended" and
  ignored).
- On macOS a forced value comes from managed preferences: an MDM or a
  configuration profile the person approves in System Settings with an
  admin password. A `.mobileconfig` carries a payload of `PayloadType`
  `com.google.Chrome` with `ExtensionInstallForcelist` as an array of
  strings, and unique `PayloadUUID`s for the profile and the payload.
- Off-store update URLs are dropped unless the Mac is MDM-enrolled,
  domain-joined or in Chrome Enterprise Core; store IDs pass.
- A policy-installed extension shows no "started debugging this browser"
  bar (`debugger_api.cc`). Chrome then shows the browser as managed.
- Check it took: `chrome://policy` lists the entry.

## Errors

- No prompt after a restart: the file name is not the ID, the JSON is
  invalid, or the item is not published yet (the update fetch fails).
- An unpacked extension is disabled whenever its profile's Developer mode
  is off (`DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION`).

## Limits

The prompt shows at most 3 times per profile. The review time is not
bounded in the docs.

## Gotchas

- Removing the extension in a profile blocklists it for the file; the store
  page (Add to Chrome) still installs it there.
- A store build and an unpacked build with different IDs can both be on in
  one profile.
- `chrome://` URLs cannot be opened from Chrome's command line, so
  `chrome://extensions` is an instruction to the person, never a link opened
  for them.
