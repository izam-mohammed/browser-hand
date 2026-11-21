# Chrome extension APIs (MV3)

Fetched: 17/10/2026 from https://developer.chrome.com/docs/extensions/reference/api/tabs, https://developer.chrome.com/docs/extensions/reference/api/tabGroups, https://developer.chrome.com/docs/extensions/reference/api/windows, https://developer.chrome.com/docs/extensions/reference/api/scripting, https://developer.chrome.com/docs/extensions/reference/api/webNavigation, https://developer.chrome.com/docs/extensions/reference/api/storage, https://developer.chrome.com/docs/extensions/reference/api/identity, https://developer.chrome.com/docs/extensions/reference/api/runtime, https://developer.chrome.com/docs/extensions/reference/api/offscreen, https://developer.chrome.com/docs/extensions/reference/manifest/key, and Chromium source at `refs/heads/main`: `extensions/common/api/extension_types.json`, `chrome/browser/extensions/api/tabs/tabs_api.cc`, `extensions/browser/quota_service.cc`, `components/crx_file/id_util.cc`.
Version: tabs page last updated 24/09/2026, windows 11/09/2026, webNavigation 04/10/2026, others as published on 17/10/2026; local Google Chrome 155.0.8059.80. Docs note "Chrome now supports the standardized browser.* namespace (available from Chrome 148)."

## What this project uses

### chrome.tabs

- Permissions: the `"tabs"` permission "does not give access to the `browser.tabs` namespace"; it unlocks `url`, `pendingUrl`, `title`, `favIconUrl` on `Tab` and querying by them. Host permissions give the same for matching tabs plus `captureVisibleTab()` and scripting.
- `tabs.create(createProperties: { active?, index?, openerTabId?, pinned?, url?, windowId?, splitWithTabId? (155+) }): Promise<Tab>`. "Fully-qualified URLs must include a scheme". Relative URLs resolve inside the extension.
- `tabs.query(queryInfo: { active?, audible?, currentWindow?, discarded?, frozen?, groupId?, highlighted?, index?, lastFocusedWindow?, muted?, pinned?, splitViewId?, status?, title?, url?, windowId?, windowType? }): Promise<Tab[]>`. `title` and `url` filters are ignored without `"tabs"` or host permission.
- `tabs.remove(tabIds: number | number[]): Promise<void>`.
- `tabs.update(tabId?: number, updateProperties: { active?, autoDiscardable?, highlighted?, muted?, openerTabId?, pinned?, url? }): Promise<Tab | undefined>`. "JavaScript URLs are not supported; use scripting.executeScript instead."
- `tabs.captureVisibleTab(windowId?: number, options?: ImageDetails): Promise<string>` (data URL).
  - "the extension must have either the <all_urls> permission or the activeTab permission."
  - Sensitive sites such as chrome: pages "can only be captured with the activeTab permission." File URLs need file access.
  - `ImageDetails` (`extension_types.json`): `format?: "jpeg" | "png"` (default `"jpeg"`), `quality?: integer 0..100` ("When format is "jpeg"... ignored for PNG").
  - Captures the visible area of the active tab of the window only.
- Constants: `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2` (Chrome 92+): "The maximum number of times that captureVisibleTab can be called per second." "captureVisibleTab is expensive and should not be called too often." `TAB_ID_NONE = -1`.

### chrome.tabGroups and tabs.group

- `tabs.group(options: { tabIds: number | number[], groupId?: number, createProperties?: { windowId?: number } }): Promise<number>`. No `groupId` means "a new group will be created". `createProperties` "Cannot be used if groupId is already specified." `tabs.ungroup(tabIds)` removes.
- `tabGroups` permission `"tabGroups"`, "Chrome 89+ MV3+".
- `TabGroup { collapsed: boolean, color: Color, id: number, shared: boolean (137+), title?: string, windowId: number }`. "Group IDs are unique within a browser session."
- `Color`: `grey | blue | red | yellow | green | pink | purple | cyan | orange`.
- `tabGroups.get(groupId)`, `tabGroups.query(queryInfo)`, `tabGroups.update(groupId, { collapsed?, color?, title? })`, `tabGroups.move(groupId, { index, windowId? })`; events `onCreated`, `onMoved`, `onRemoved`, `onUpdated`. `TAB_GROUP_ID_NONE = -1`.

### chrome.windows

- `windows.create(createData?: { url?, focused?, type?, state?, width?, height?, left?, top?, incognito?, setSelfAsOpener?, tabId? }): Promise<Window>`.
- `windows.update(windowId: number, updateInfo: { width?, height?, left?, top?, focused?, state?, drawAttention? }): Promise<Window>`. Used for resize.
- "The `minimized`, `maximized`, and `fullscreen` states cannot be combined with `left`, `top`, `width`, or `height`."
- `WindowState`: `normal | minimized | maximized | fullscreen`. `WindowType`: `normal | popup | panel | app | devtools`.
- `WINDOW_ID_CURRENT = -2`, `WINDOW_ID_NONE = -1`. `windows.get/getCurrent/getAll(queryOptions?: { populate?, windowTypes? })`.

### chrome.scripting

- Permission `"scripting"` plus host permissions or `"activeTab"`. "Chrome 88+ MV3+".
- `scripting.executeScript(injection: ScriptInjection): Promise<InjectionResult[]>`.
- `ScriptInjection { target: InjectionTarget, func?, args?, files?, world?: "ISOLATED" | "MAIN", injectImmediately? }`. "Exactly one of `files` or `func` must be specified." `args` "must be JSON-serializable." `world` "Defaults to `ISOLATED`."
- `InjectionTarget { tabId: number, frameIds?: number[], documentIds?: string[] (106+), allFrames?: boolean }`. `allFrames` "Defaults to false" and "must not be true if `frameIds` is specified."
- `ExecutionWorld.ISOLATED`: "the execution environment unique to this extension." `ExecutionWorld.MAIN`: "the execution environment shared with the host page's JavaScript."
- `InjectionResult { documentId, frameId, result? }`. "Chrome will wait for the promise to settle and return the resulting value." "The main frame is guaranteed to be the first index in the resulting array."
- You "can't execute a string using `scripting.executeScript()`" (only functions or files).

### chrome.webNavigation

- Permission `"webNavigation"`.
- Order: "onBeforeNavigate -> onCommitted -> [onDOMContentLoaded] -> onCompleted"; errors give `onErrorOccurred`. Also `onCreatedNavigationTarget`, `onHistoryStateUpdated`, `onReferenceFragmentUpdated`, `onTabReplaced`.
- Details include `tabId`, `frameId`, `url`, `documentId`, `parentFrameId`, `frameType`, `documentLifecycle`, `timeStamp`. frameId "0 indicates the navigation happens in the tab content window".
- `getFrame(details)`, `getAllFrames(details)` return promises.

### chrome.storage.local

- Permission `"storage"`. `storage.local.QUOTA_BYTES = 10485760`: "The storage limit is 10 MB (5 MB in Chrome 113 and earlier)", raised with `"unlimitedStorage"`.
- Values must be JSON-serialisable. Cleared "when the extension is removed." Exposed to content scripts by default (`setAccessLevel` changes this). `storage.session` is also 10 MB, in memory, not exposed to content scripts by default.
- Methods `get`, `set`, `remove`, `clear`, `getBytesInUse`, `setAccessLevel`; `onChanged((changes, areaName) => void)`.
- Fetched 19/10/2026 from https://developer.chrome.com/docs/extensions/reference/api/storage (page last updated 11/09/2026), for `plans/05-record-steps.md` and `plans/06-settings.md`: "Updates that would cause this limit to be exceeded fail immediately", rejecting the promise (the error text is not stated). `QUOTA_BYTES` "is ignored" with `"unlimitedStorage"`. `getBytesInUse(keys?)` "lets you see the quota used by a StorageArea" (signature not stated on the page; `@types/chrome` 0.3.5 has `getBytesInUse(keys?: string | string[] | null): Promise<number>`).
- `storage.sync` (same page): `QUOTA_BYTES = 102400` total, measured as the JSON of every value plus every key's length; `QUOTA_BYTES_PER_ITEM = 8192`; `MAX_ITEMS = 512`; `MAX_WRITE_OPERATIONS_PER_MINUTE = 120` and `PER_HOUR = 1800`. With sync off "it behaves like storage.local". Sync follows the signed-in Google account, not the local profile; a profile signed out, or signed in to another account, does not share it (not stated on the page beyond the sync-off line).

### `unlimitedStorage` permission

Fetched 19/10/2026 from https://developer.chrome.com/docs/extensions/reference/permissions-list
(page last updated 09/09/2026), for `plans/05-record-steps.md`.

- "Provides an unlimited quota for" `storage.local`, IndexedDB, Cache Storage and the Origin Private File System.
- Permission warning: none listed. Adding it does not show an install prompt or disable an updated extension.

### chrome.identity.getProfileUserInfo

- `identity.getProfileUserInfo(details?: { accountStatus?: "SYNC" | "ANY" }): Promise<{ email: string, id: string }>` (details Chrome 84+, promise 106+).
- `accountStatus` "Defaults to `SYNC`". `ANY`: "Specifies the existence of a primary account, if any." Use `ANY` to see signed-in but non-sync profiles.
- "Requires the `identity.email` manifest permission. Otherwise, returns an empty result." `email` and `id` are empty if not signed in. Permissions: `["identity", "identity.email"]`.

### chrome.runtime.connectNative

See chrome-native-messaging.md. `connectNative(application: string): Port`, permission `"nativeMessaging"`.

### chrome.offscreen

- Permission `"offscreen"`, "Chrome 109+ MV3+".
- `offscreen.createDocument({ url: string, reasons: Reason[], justification: string }): Promise<void>`, `offscreen.closeDocument()`, `offscreen.hasDocument()` (Chrome 150+).
- `Reason`: TESTING, AUDIO_PLAYBACK, IFRAME_SCRIPTING, DOM_SCRAPING, BLOBS, DOM_PARSER, USER_MEDIA, DISPLAY_MEDIA, WEB_RTC, CLIPBOARD, LOCAL_STORAGE, WORKERS, BATTERY_STATUS, MATCH_MEDIA, GEOLOCATION.
- One document: "an installed extension can only have one open at a time" (split mode incognito can have one per profile).
- "The runtime API is the only extensions API supported by offscreen documents." URL "must be a static HTML file bundled with the extension." AUDIO_PLAYBACK closes after 30 s without audio; "All other reasons don't set lifetime limits."
- Lifecycle docs: "Messages sent from an offscreen document reset the timers" (Chrome 109).

### chrome.action

Fetched 18/10/2026 from https://developer.chrome.com/docs/extensions/reference/api/action
(for `plans/05-record-steps.md`).

- Manifest `"action": { "default_icon", "default_title", "default_popup", "default_state" }`, MV3, Chrome 88+. Icons are PNG for unpacked extensions ("SVG isn't supported"), 16 DIP.
- `action.onClicked.addListener((tab: tabs.Tab) => void)`: "fires when the icon is clicked, but only if the action has no popup." A popup set for the tab suppresses it.
- `action.setBadgeText({ text, tabId? })`, `setBadgeBackgroundColor({ color, tabId? })` (RGBA array or CSS colour string), `setTitle({ title, tabId? })`, `setIcon({ path | imageData, tabId? })` (promise 96+). Each returns `Promise<void>`. Without `tabId` the value is global; "Tab-specific settings take priority over global settings", and reset when the tab closes. About four characters of badge text fit; `""` clears it.

Fetched 21/10/2026 from https://developer.chrome.com/docs/extensions/reference/api/action
(last updated 11/09/2026), https://developer.chrome.com/docs/extensions/develop/ui/add-popup
(last updated 12/12/2023), https://developer.chrome.com/docs/extensions/reference/api/windows
(last updated 11/09/2026) and MDN `action.setPopup`, for `plans/08-recorder-popup.md`.

- `action.setPopup({ popup: string, tabId?: number }): Promise<void>`: "Sets the HTML document to be opened as a popup when the user clicks on the action's icon." `popup`: "If set to the empty string (`''`), no popup is shown." `tabId`: "Limits the change to when a particular tab is selected. Automatically resets when the tab is closed." Without `tabId` it is global, and "Tab-specific settings take priority over global settings."
- `action.getPopup({ tabId? }): Promise<string>`: "Gets the html document set as the popup for this action."
- `action.openPopup({ windowId? })`: "Opens the extension's popup." Chrome 127+; "Between Chrome 118 and Chrome 126, this is only available to policy installed extensions." This project's minimum is 120.
- `onClicked`: "This event will not fire if the action has a popup." So with the popup set to `''`, a click reaches `onClicked` again (MDN: an empty string "disables the popup, and the extension will receive action.onClicked events").
- Popup size: "between 25x25 and 800x600 pixels". "Popups automatically close when the user focuses on some portion of the browser outside of the popup. There is no way to keep the popup open after the user has clicked away." Scripts must be separate files (no inline script).
- MDN (Firefox) says a tab-specific popup is reset when the tab navigates; the Chrome page says only that it resets when the tab closes. Not documented for Chrome: whether a global `setPopup` value survives the service worker stopping. `scripts/prove/action-popup.sh` (`plans/08-recorder-popup.md` Phase 1) settles both.
- Which window a popup belongs to: `windows` reference, "The current window is the window that contains the code that is currently executing", and for extension pages "the window that contains the page that made the call, no matter what the topmost window is". So `windows.getCurrent()` or `tabs.query({ active: true, currentWindow: true })` from the popup names the window it was opened over (also to be confirmed by the proof).

### chrome.commands

Fetched 18/10/2026 from https://developer.chrome.com/docs/extensions/reference/api/commands
(for `plans/05-record-steps.md`).

- Manifest `"commands": { "<name>": { "suggested_key": { "default": "Ctrl+Shift+Y", "mac": "Command+Shift+Y" }, "description": "..." } }`. `description` is required for a standard command.
- `commands.onCommand.addListener((command: string, tab?: tabs.Tab) => void)`. `_execute_action` triggers the action but "Action commands don't dispatch `onCommand` events" (nor `action.onClicked` when a popup is set).
- At most four suggested shortcuts. Shortcuts must include `Ctrl` or `Alt`; `Ctrl+Alt` is not allowed. On macOS `Ctrl` becomes `Command`. A shortcut another extension already holds is not registered: `commands.getAll()` at install shows `shortcut: ""` for it. OS and Chrome shortcuts win.

### Options page (`options_page`, `options_ui`, `runtime.openOptionsPage`)

Fetched 19/10/2026 from https://developer.chrome.com/docs/extensions/develop/ui/options-page
and https://developer.chrome.com/docs/extensions/reference/api/runtime (runtime page last
updated 06/02/2024), for `plans/06-settings.md`.

- Full page: `"options_page": "options.html"`; it "open[s] in a new tab". Embedded: `"options_ui": { "page": "options.html", "open_in_tab": false }`, shown inside `chrome://extensions` in a box. `open_in_tab: true` opens the `options_ui` page in a tab instead. Both keys are documented for MV3; neither is marked deprecated on the page.
- The person reaches it "by right-clicking the extension icon in the toolbar and then selecting options", or on `chrome://extensions` through Details, then the options link, or by a direct link.
- Embedded options: "the Tabs API cannot be used"; messages from it have no sender tab and the sender URL is the page's URL. Size: "provide fixed minimum dimensions" for content that adapts to the window.
- `chrome.runtime.openOptionsPage(): Promise<void>`: "Open your Extension's options page, if possible."
- `runtime.connect(extensionId?, connectInfo?: { name? }): Port`; `onConnect` fires "when a connection is made from either an extension process or a content script". `Port.sender` is "only present on ports passed to onConnect"; `MessageSender.url` is "The URL of the page or frame that opened the connection", `id` "The ID of the extension that opened the connection".
- Extension pages follow `prefers-color-scheme` like any page (CSS media query; not an extension API).

### chrome.declarativeNetRequest (session rules)

Fetched 19/10/2026 from https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
(page last updated 11/09/2026) and https://developer.chrome.com/docs/extensions/reference/permissions-list,
for `plans/06-settings.md`.

- Permissions: `"declarativeNetRequest"` warns "Block content on any page". `"declarativeNetRequestWithHostAccess"` shows no warning and "requires host permissions for all actions"; this extension already holds `<all_urls>`.
- `updateSessionRules({ removeRuleIds?, addRules? }): Promise<void>` (Chrome 90+): removes, then adds, "as a single atomic operation". Session rules "are not persisted across sessions".
- `MAX_NUMBER_OF_SESSION_RULES = 5000` (Chrome 120+); regex rules are capped at 1000 and "each rule must be less than 2KB once compiled".
- `RuleCondition.tabIds` (Chrome 92+) matches `tabs.Tab.id`, "Only supported for session-scoped rules"; `excludedTabIds` likewise.
- `requestDomains` (Chrome 101+): "Sub-domains of the listed domains are also matched." An empty list is not allowed.
- `urlFilter`: `*` any characters, `|` anchors the start or end, `||` anchors a domain or subdomain start, `^` a separator or the end. ASCII only. One of `urlFilter` or `regexFilter`.
- `resourceTypes` must list `main_frame` explicitly: without it "all resource types except "main_frame" are blocked".
- Actions `block`, `redirect`, `allow`, `upgradeScheme`, `modifyHeaders`, `allowAllRequests`. `redirect.extensionPath` must be in `web_accessible_resources`.
- Not stated: whether a navigation started by `tabs.update` from the extension itself is matched. `scripts/prove/site-rules.sh` finds out.

### Manifest `key` (pinning the extension ID)

- "This value maintains the unique ID of an extension, or theme when it is loaded during development."
- Docs method: upload a zip to the Developer Dashboard, Package tab, "View public key", copy the text between `-----BEGIN PUBLIC KEY-----` and `-----END PUBLIC KEY-----`, remove newlines, put it in `"key"`.
- Derivation (docs: not stated; source `components/crx_file/id_util.cc`): ID = first 16 bytes of SHA-256 of the public key bytes (the base64-decoded DER SubjectPublicKeyInfo in `key`), hex-encoded to 32 chars, each hex digit mapped `0-9a-f` to `a-p` (`ch = 'a' + val`). `IdIsValid` requires 32 chars in `a`..`p`. Without `key`, an unpacked extension's ID is `GenerateIdForPath(path)` (hash of the directory path), so it changes if the folder moves.
- Generating a key locally with openssl: not described in the docs.

## Errors

- captureVisibleTab over quota (source `quota_service.cc`, `tabs_api.cc`): "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota." Enforced as a `TimedLimit` of 2 calls per 1 s, one bucket for the extension.
- Scripting and capture on restricted pages: "Cannot access a chrome:// URL", "The extensions gallery cannot be scripted.", "Cannot access contents of the page. Extension manifest must request permission to access the respective host." (see chrome-debugger-cdp.md).
- Others: not stated per method on the reference pages.

## Limits

- captureVisibleTab: 2 calls per second.
- storage.local: 10,485,760 bytes unless `unlimitedStorage`. storage.session: 10,485,760 bytes.
- offscreen: one document per extension (per profile in split incognito).
- declarativeNetRequest: 5,000 session rules, 1,000 regex rules, each under 2 KB compiled.
- storage.sync: 102,400 bytes, 8,192 per item, 120 writes a minute.
- Number of tab groups, windows, tabs: not stated.

## Gotchas

- captureVisibleTab only captures the active tab of a window, at 2 per second, and needs `<all_urls>` or activeTab. For per-tab or background-tab screenshots use CDP `Page.captureScreenshot` instead.
- `tabs.create` with an extension-relative URL is resolved inside the extension; this is how to open the extension's own page as a top-level tab.
- `identity.getProfileUserInfo` defaults to `SYNC`; pass `{ accountStatus: "ANY" }` or non-sync signed-in profiles return empty. Treat the email as personal information.
- Tab groups only move between `normal` windows; `onMoved` is not fired for cross-window moves.
- Offscreen documents only get `chrome.runtime`; route other API calls through the service worker.
- `allowed_origins` in the native host manifest needs a stable ID, so ship the `key` field in development builds.

## Optional access (plans/19-optional-access.md)

Fetched 2026-11-20 from developer.chrome.com/docs/extensions/reference/api/<name>.
Not read end to end; `scripts/prove/optional-access.sh` settles what is marked unverified.

### chrome.permissions and `optional_permissions`

- `permissions.request({ permissions, origins })`: "Permissions must be requested from inside a user gesture, like a button's click handler." Only permissions in `optional_permissions` (or required ones the user withheld) can be requested; Chrome may show a warning prompt.
- `permissions.remove(...)`: removes access; required permissions cannot be removed; a later `request` usually restores without a prompt. The docs state no gesture for `remove`.
- `permissions.contains`, `getAll`, events `onAdded` and `onRemoved` (also fire when the person revokes in `chrome://extensions`).
- Cannot be optional (not exhaustive: "including"): `debugger`, `declarativeNetRequest`, `devtools`, `geolocation`, `mdns`, `proxy`, `tts`, `ttsEngine`. Whether `sidePanel` and `offscreen` can be optional is unverified.

### chrome.downloads (`downloads`)

- `downloads.search({ state, filename, startedAfter, limit, orderBy })` (limit default 1000); `DownloadItem`: `id`, `filename` (absolute local path), `url`, `finalUrl`, `mime`, `state` (`in_progress`, `interrupted`, `complete`), `bytesReceived`, `totalBytes` (-1 unknown), `error`, `exists` (may be stale).
- Events `onCreated(item)` and `onChanged(delta)` (no `bytesReceived` deltas).

### chrome.cookies (`cookies` + host permissions)

- `cookies.getAll({ url, domain, name, path, secure, session, partitionKey, storeId })`, only for hosts with host permission (`<all_urls>` is already held).
- `Cookie`: `name`, `value`, `domain`, `path`, `httpOnly`, `secure`, `hostOnly`, `sameSite`, `session`, `expirationDate`, `storeId`. Whether httpOnly cookies are returned: unverified. Incognito uses a separate store.

### chrome.alarms (`alarms`)

- `alarms.create(name, { when | delayInMinutes, periodInMinutes })`; same name replaces; fires at most once a second; "an alarm will not wake up a device"; after wake a missed repeating alarm fires once. `persistAcrossSessions` defaults true (Chrome 150+); check `alarms.get` on worker start and recreate.

### chrome.notifications (`notifications`)

- `create(id?, { type: "basic", title, message, iconUrl, buttons (max 2), requireInteraction, silent, priority })`; events `onClicked`, `onButtonClicked(id, index)`, `onClosed(id, byUser)`; `getPermissionLevel()`. Priority -2 and -1 error where there is no notification center.

### chrome.idle (`idle`)

- `queryState(seconds)` returns `active`, `idle` (no input for that many seconds) or `locked`; `setDetectionInterval`, `onStateChanged`. Described as the machine's state; per window: not stated. Service-worker use: unverified.

### chrome.sidePanel (`sidePanel`)

- Manifest `side_panel.default_path`; `setOptions({ tabId, path, enabled })`, `setPanelBehavior({ openPanelOnActionClick })`; `open()` (Chrome 116+) "may only be called in response to a user action", so the panel cannot open on its own; a click in the popup or a keyboard shortcut is a gesture. One panel per window or tab.

### chrome.history (`history`) and chrome.bookmarks (`bookmarks`)

- `history.search({ text, startTime, endTime, maxResults })`: `startTime` defaults to 24 hours, `maxResults` to 100; `HistoryItem`: `id`, `url`, `title`, `lastVisitTime`, `visitCount`, `typedCount`. Incognito inclusion: not stated.
- `bookmarks.search(string | { query, title, url })`, `getTree()`, `getRecent(n)`; `BookmarkTreeNode`: `id`, `parentId`, `title`, `url` (absent for folders), `dateAdded`, `children`.

### chrome.pageCapture (`pageCapture`) and chrome.tabCapture (`tabCapture`)

- `pageCapture.saveAsMHTML({ tabId }): Promise<Blob | undefined>`, Chrome 116+; no gesture requirement stated.
- `tabCapture` works only "after the user invokes the extension", like `activeTab`; a service worker gets a stream id from `getMediaStreamId()` and an offscreen document turns it into a stream. A person must click first, so Claude cannot start it.
