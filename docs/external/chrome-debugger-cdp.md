# chrome.debugger and Chrome DevTools Protocol

Fetched: 17/10/2026 from https://developer.chrome.com/docs/extensions/reference/api/debugger, https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle, https://chromedevtools.github.io/devtools-protocol/ (protocol definitions taken from the official JSON at https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json and js_protocol.json), and Chromium source at `refs/heads/main`: `chrome/browser/extensions/api/debugger/debugger_api.cc`, `chrome/browser/extensions/api/debugger/extension_dev_tools_infobar_delegate.{h,cc}`, `chrome/app/generated_resources.grd`, `extensions/common/permissions/permissions_data.cc`, `extensions/common/manifest_constants.h`, `chrome/common/extensions/chrome_extensions_client.cc`, `content/browser/devtools/protocol/{dom_handler,input_handler,page_handler}.cc`.
Version: chrome.debugger page last updated 05/10/2026; CDP tip-of-tree protocol JSON version 1.3 as of 17/10/2026; local Google Chrome 155.0.8059.80.

## What this project uses

### chrome.debugger API

- Manifest: `"permissions": ["debugger"]`. "You must declare the "debugger" permission in your extension's manifest to use this API." Source note: "The `debugger` permission implies all URLs access (and indicates such to the user), so we don't check explicit page access."
- "serves as an alternate transport for Chrome's remote debugging protocol".
- `Debuggee`: `{ tabId?: number, extensionId?: string, targetId?: string }`. "Either tabId, extensionId or targetId must be specified".
- `DebuggerSession` (Chrome 125+): Debuggee plus optional `sessionId` for child targets (flat sessions). "Starting in Chrome 125, the browser.debugger API supports flat sessions."
- `chrome.debugger.attach(target: Debuggee, requiredVersion: string): Promise<void>` (promise Chrome 96+). `requiredVersion` such as `"1.3"`; the docs example uses `"0.1"`. Source error if unsupported: "Requested protocol version is not supported: *."
- `chrome.debugger.detach(target: Debuggee): Promise<void>`
- `chrome.debugger.sendCommand(target: DebuggerSession, method: string, commandParams?: object): Promise<object | undefined>`; rejects on protocol error.
- `chrome.debugger.getTargets(): Promise<TargetInfo[]>`; `TargetInfo { attached, extensionId?, faviconUrl?, id, tabId?, title, type, url }`, `TargetInfoType`: `page | background_page | worker | other`.
- `chrome.debugger.onEvent.addListener((source: DebuggerSession, method: string, params?: object) => void)`
- `chrome.debugger.onDetach.addListener((source: Debuggee, reason: DetachReason) => void)`. `DetachReason`: `"target_closed" | "canceled_by_user"`. Fires when the tab closes or DevTools is opened on the attached tab.
- Domains exposed to extensions: Accessibility, Audits, CacheStorage, Console, CSS, Database, Debugger, DOM, DOMDebugger, DOMSnapshot, Emulation, Fetch, IO, Input, Inspector, Log, Network, Overlay, Page, Performance, Runtime, Storage, Target, Tracing, WebAudio, WebAuthn.
- Service worker lifetime: Chrome 118, "Active debugger sessions created using the browser.debugger API now keep the service worker alive." Source: attach takes a keepalive with `kDoesNotTimeout`.

### Infobar while attached

- Docs: not stated on the API page.
- Source label (`IDS_DEV_TOOLS_INFOBAR_LABEL`): "<extension name> started debugging this browser". It is shown through `GlobalConfirmInfoBar` (all tabs) with a single button labelled Cancel; `DetachReason` `canceled_by_user` covers the user cancelling. After the last session detaches the bar auto-closes after `kAutoCloseDelay = base::Seconds(5)`.
- Suppression, source (`ExtensionDevToolsClientHost::Attach`):

  ```cpp
  // We allow policy-installed extensions to circumvent the normal
  // infobar warning. See crbug.com/41302695.
  const bool suppress_warning =
      base::CommandLine::ForCurrentProcess()->HasSwitch(
          ::switches::kSilentDebuggerExtensionAPI) ||
      Manifest::IsPolicyLocation(extension_->location());
  ```

  So only two ways: launch Chrome with `--silent-debugger-extension-api`, or install the extension by enterprise policy (policy install location). Nothing in the extension manifest hides it. The docs also say attaching to an extension background page is "only possible when the --silent-debugger-extension-api command-line switch is used."

### Attach restrictions (source, `debugger_api.cc`)

- Allowed without checks: empty, `about:`, `about:blank`, the unreachable-web-data URL.
- Other extensions' pages: refused with "Cannot access a chrome-extension:// URL of different extension" unless a command-line switch checked by `AreExtensionsOnExtensionURLsAllowed()` is set. The extension's own pages are allowed.
- `chrome://` and any WebUI frame: "Cannot access a chrome:// URL".
- Chrome Web Store: `IsScriptableURL` returns false for webstore domains, error "The extensions gallery cannot be scripted."
- `file://`: needs "Allow access to file URLs" toggled for the extension; error "Cannot navigate to a file URL without local file access."
- PDF viewer process frames, security interstitials: "Cannot attach to this target."
- Privileged WebContents: "Cannot access contents of the page. Extension manifest must request permission to access the respective host."
- Enterprise policy: runtime_blocked_hosts gives "Host access is restricted by policy."; screenshot or DLP policy gives "Screenshot capture is restricted by policy." / "Screenshot capture is restricted on this target."
- Restriction applies to every frame in the tab: one restricted iframe (for example a chrome:// or other-extension frame) makes the whole tab unattachable.

### CDP methods

Input:

- `Input.dispatchMouseEvent { type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel", x: number, y: number, modifiers?: integer, timestamp?, button?: MouseButton, buttons?: integer, clickCount?: integer, force?, tangentialPressure?, tiltX?, tiltY?, twist?, deltaX?: number, deltaY?: number, pointerType?: "mouse" | "pen" }`
  - x, y: "relative to the main frame's viewport in CSS pixels."
  - `MouseButton`: `none | left | middle | right | back | forward` (default `"none"`).
  - `buttons`: "Left=1, Right=2, Middle=4, Back=8, Forward=16, None=0."
  - `clickCount`: default 0. Double click is a press/release pair with `clickCount: 2`.
  - `deltaX` / `deltaY`: "X delta in CSS pixels for mouse wheel event (default: 0)."
  - `pointerType` default `"mouse"`.
- `Input.dispatchKeyEvent { type: "keyDown" | "keyUp" | "rawKeyDown" | "char", modifiers?, timestamp?, text?, unmodifiedText?, keyIdentifier?, code?, key?, windowsVirtualKeyCode?, nativeVirtualKeyCode?, autoRepeat?, isKeypad?, isSystemKey?, location?, commands?: string[] }`
  - `text`: "Not needed for for `keyUp` and `rawKeyDown` events".
  - `code` e.g. `'KeyA'`; `key` e.g. `'AltGr'`; `location`: "1=Left, 2=Right".
  - `commands` (experimental): editing commands such as `'selectAll'`.
- Modifiers bitmask (both methods): "Alt=1, Ctrl=2, Meta/Command=4, Shift=8 (default: 0)."
- `Input.insertText { text: string }` (experimental). "This method emulates inserting text that doesn't come from a key press, for example an emoji keyboard or an IME." Source: implemented via `ImeCommitText`.

Page / Emulation:

- `Page.captureScreenshot { format?: "jpeg" | "png" | "webp", quality?: integer, clip?: Viewport, fromSurface?: boolean, captureBeyondViewport?: boolean, optimizeForSpeed?: boolean } -> { data: string }` (base64). Format default png; quality "[0..100] (jpeg only)"; `captureBeyondViewport` experimental, default false; `fromSurface` experimental, default true.
- `Page.Viewport { x, y, width, height, scale }` in "device independent pixels (dip)".
- `Emulation.setDeviceMetricsOverride { width: integer, height: integer, deviceScaleFactor: number, mobile: boolean, ...experimental extras }`. "0 disables the override" for width, height and deviceScaleFactor; width/height "minimum 0, maximum 10000000". Clear with `Emulation.clearDeviceMetricsOverride {}`.

Runtime:

- `Runtime.evaluate { expression: string, objectGroup?, includeCommandLineAPI?, silent?, contextId?, returnByValue?, generatePreview?, userGesture?, awaitPromise?, throwOnSideEffect?, timeout?, disableBreaks?, replMode?, allowUnsafeEvalBlockedByCSP?, uniqueContextId?, serializationOptions? } -> { result: RemoteObject, exceptionDetails? }`
  - `awaitPromise`: "Whether execution should `await` for resulting value and return once awaited promise is resolved."
  - `returnByValue`: "Whether the result is expected to be a JSON object that should be sent by value."
  - `replMode` (experimental): "enables `let` re-declaration and top-level `await`."
  - `allowUnsafeEvalBlockedByCSP` (experimental): bypasses page CSP unsafe-eval, "Defaults to true."
  - `timeout` (experimental): milliseconds.

Accessibility / DOM:

- `Accessibility.getFullAXTree { depth?: integer, frameId?: Page.FrameId } -> { nodes: AXNode[] }` (experimental). `AXNode { nodeId, ignored, ignoredReasons?, role?, chromeRole?, name?, description?, value?, properties?, parentId?, childIds?, backendDOMNodeId?, frameId? }`.
- `Accessibility.enable`: "causes `AXNodeId`s to remain consistent between method calls. This turns on accessibility for the page, which can impact performance until accessibility is disabled."
- `DOM.getBoxModel { nodeId? | backendNodeId? | objectId? } -> { model: BoxModel }`, `BoxModel { content, padding, border, margin: Quad, width, height, shapeOutside? }`. A Quad is 8 numbers (4 x,y points).
- `DOM.setFileInputFiles { files: string[], nodeId? | backendNodeId? | objectId? }`. "Array of file paths to set."

Network / console:

- `Network.enable { maxTotalBufferSize?, maxResourceBufferSize?, maxPostDataSize?, ... }` then events:
  - `Network.requestWillBeSent { requestId, loaderId, documentURL, request, timestamp, wallTime, initiator, redirectHasExtraInfo, redirectResponse?, type?, frameId?, hasUserGesture?, renderBlockingBehavior? }`
  - `Network.responseReceived { requestId, loaderId, timestamp, type, response, hasExtraInfo, frameId? }`
- `Runtime.enable` then `Runtime.consoleAPICalled { type, args: RemoteObject[], executionContextId, timestamp, stackTrace?, context? }`; `type` enum: log, debug, info, error, warning, dir, dirxml, table, trace, clear, startGroup, startGroupCollapsed, endGroup, assert, profile, profileEnd, count, timeEnd.
- `Log.enable` then `Log.entryAdded { entry: LogEntry }`, `LogEntry { source, level: "verbose" | "info" | "warning" | "error", text, category?, timestamp, url?, lineNumber?, stackTrace?, networkRequestId?, workerId?, args? }`. Covers browser-generated messages (network, security, violation, intervention...), not `console.*` calls.

### isTrusted of CDP input

Docs: not stated. Source: `Input.dispatchMouseEvent` / `dispatchKeyEvent` build `blink::WebInputEvent`s tagged with the `kFromDebugger` modifier flag and send them through `RenderWidgetHost::ForwardMouseEvent` / `ForwardWheelEvent` / `ForwardKeyboardEventWithCommands`, the same browser-side input path as OS input, so the page receives them as trusted (`isTrusted === true`). This is inferred from source and not verified at runtime here.

## Errors

From `debugger_api.cc` and `manifest_constants.h`:

- "Another debugger is already attached to the * with id: *." (DevTools open, or another client attached)
- "No * with given id *."
- "Either tab id or extension id must be specified."
- "Debugger is not attached to the * with id: *."
- "Requested protocol version is not supported: *."
- "Cannot attach to this target."
- "Detached while handling command."
- "Cannot navigate to a file URL without local file access."
- "Cannot access a chrome:// URL"
- "Cannot access a chrome-extension:// URL of different extension"
- "The extensions gallery cannot be scripted."
- "Host access is restricted by policy." / "Screenshot capture is restricted by policy." / "Screenshot capture is restricted on this target."
- `DOM.setFileInputFiles` and `DOM.getFileInfo` return "Not allowed" when the client may not read local files. For extensions that is `util::AllowFileAccess(...)`, i.e. the "Allow access to file URLs" toggle.
- `Page.captureScreenshot` with `fromSurface: false` from an untrusted client: "Only screenshots from surface are allowed."
- Page navigation (page_handler.cc) to `file:` without file access: "Navigating to local URL is not allowed"; to a privileged scheme from an untrusted client: "Navigating to a URL with a privileged scheme is not allowed".

## Limits

- Message size for `sendCommand` results / events: not stated.
- Number of tabs attachable at once: not stated (one debugger client per target in practice, see "already attached" error).
- `Network.enable` buffer sizes: caller-set, defaults not stated.

## Gotchas

- The "started debugging this browser" bar cannot be hidden by a normal user-installed extension. Only `--silent-debugger-extension-api` or a policy-installed extension suppresses it. Launching the user's real Chrome with that flag means relaunching their browser, and a launch flag is not persisted.
- Opening DevTools on a tab detaches the extension (`onDetach`). Plan for re-attach.
- Cancel on the infobar ends debugging with `onDetach` reason `canceled_by_user`; whether it detaches all of the extension's sessions or one is not stated.
- A restricted iframe anywhere in the page blocks attach to the whole tab.
- Several used methods are experimental (`Input.insertText`, `Accessibility.getFullAXTree`, `captureBeyondViewport`, `replMode`) and may change.
- File upload via `DOM.setFileInputFiles` requires the user to enable "Allow access to file URLs" for the extension.
- `Log.entryAdded` does not include `console.log`; use `Runtime.consoleAPICalled` for that.
