# Chrome Web Store listing

What goes into the store dashboard for browser-hand
(`plans/07-install-extension.md`, Phase 2). Upload the zip from
`sh scripts/package.sh`; visibility **Unlisted**.

## Store listing

- **Name:** browser-hand
- **Summary (132 characters at most):** Lets Claude Code drive this Chrome
  profile through the browser-hand server on your own computer.
- **Category:** Developer Tools
- **Language:** English
- **Icon:** `extension/icons/app-128.png`
- **Screenshot (1280x800):** the settings page, from
  `design/settings--light.png` cropped to 1280x800.

**Description:**

> browser-hand connects Claude Code to this Chrome profile. A program on
> your own computer (the browser-hand native host, installed separately)
> passes Claude's requests to the extension, which opens tabs in its own
> "browser-hand" tab group, reads pages, and clicks, types and scrolls the
> way a person does.
>
> - Claude works only in its own tab group, never in your other tabs.
> - A settings page sets the pace, blocked sites and read-only sites, for
>   every profile at once.
> - A toolbar button records your own steps so Claude can read them back or
>   do them again. Only you can start a recording; passwords are stored
>   masked.
>
> The extension does nothing without the browser-hand native host and
> Claude Code on the same computer.

## Single purpose

> Let the Claude Code assistant on this computer operate this Chrome
> profile, in its own tab group, on the person's request.

## Permission justifications

| Permission | Why |
| --- | --- |
| `nativeMessaging` | Talks to the browser-hand native host on the same computer, which relays Claude Code's requests. |
| `tabs` | Opens, lists and closes the tabs in Claude's tab group, and reads their address and title. |
| `tabGroups` | Keeps each Claude session in its own "browser-hand" tab group, so it cannot touch other tabs. |
| `debugger` | Sends mouse and keyboard input the page treats as real, and takes screenshots of Claude's tabs. Attached only while Claude acts, then detached. |
| `scripting` | Reads a page's structure and text, and fills form fields, in tabs Claude is working in. |
| `webRequest` | Lists the network requests of Claude's tabs when Claude asks for them (to debug a page). |
| `webNavigation` | Knows when a page in Claude's tabs, or in a window the person is recording, has loaded. |
| `declarativeNetRequestWithHostAccess` | Enforces the person's blocked sites: Claude's tabs cannot load them. |
| `storage` | Keeps settings the extension needs locally, the person's recordings, and which tab group belongs to which session. |
| `unlimitedStorage` | Recordings can hold many steps; the extension keeps at most 20 recordings and 50 MB. |
| Host access `<all_urls>` | The person can ask Claude to work on any site; blocked and read-only sites are set by the person. |

**Remote code:** No. All code is in the package; nothing is fetched and run.

## Privacy practices

Data the extension handles, and where it goes:

| Store category | Collected? | Notes |
| --- | --- | --- |
| Website content | Yes | Page text, structure and screenshots of tabs Claude works in, sent to the native host on the same computer and from there to Claude Code, the person's own assistant. |
| User activity | Yes | Only while the person records with the toolbar button: their clicks, keys and typed values (passwords masked), stored in the extension until the person deletes them or Claude reads them at the person's request. |
| Web history | Yes | Addresses of pages in Claude's tabs and in recordings. |
| Personally identifiable information, health, financial, authentication, personal communications, location | No | Not collected. Password fields are masked in recordings. |

Certify:

- Data is not sold to third parties.
- Data is not used or transferred for purposes unrelated to the single
  purpose.
- Data is not used to determine creditworthiness or for lending.

**Privacy policy URL:** the store needs a public page. The repository is
private, so a README link does not work; publish the section below on a
public page first (a GitHub Gist or a page on a site you own).

### Privacy policy text

> browser-hand runs on your own computer. The extension sends page content
> from the tabs it works in (text, structure, screenshots, network request
> lists) only to the browser-hand native host on the same computer, which
> passes it to Claude Code at your request. Recordings you make with the
> toolbar button stay in the extension's local storage until you delete
> them; passwords and similar fields are stored masked. Settings are kept
> in a file on your computer. The extension has no server of its own and
> sends nothing anywhere else. What Claude Code does with what it receives
> is covered by Anthropic's terms for Claude Code.
