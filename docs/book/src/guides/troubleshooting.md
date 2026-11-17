# troubleshooting

Start from what Claude said, and work down.

## "the extension did not answer"

The profile has no connected extension.

1. Open `chrome://extensions` in that profile.
2. Check browser-hand is there and on. If not, **Load unpacked**
   `extension/dist` (Developer mode must be on).
3. Run `plugin/server/browser-hand reload` to reload it in every connected
   profile, or press reload on its card.

The extension ID should be `ednpkicgdjiiihmophoifehfeeoabjdc`. Another ID
means the folder was loaded from somewhere else.

## the host is not running

Chrome starts a native host per profile when the extension connects. If
`list_profiles` shows no profile connected:

- Check the manifest exists:
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.browserhand.host.json`.
  If not, run `plugin/server/browser-hand install`.
- Check `plugin/server/browser-hand` exists: `sh scripts/build.sh` builds it.
- Reload the extension (`reload` above) so Chrome starts the host again.

The settings page shows "Not connected" and the last values, read-only, when
the host is not running.

## a tool answers "blocked"

The site is on your blocked or read-only list. Claude should stop and ask.
Change the lists on the settings page: [blocked and read-only
sites](blocked-sites.md).

## the page does not respond after a click

A JavaScript alert, confirm or prompt may be open, and it blocks the page.
Dismiss it by hand. Claude is told not to trigger them, but a site's own
"are you sure" button can.

## everything is slow

That is the hand at work. See [pace and how input
moves](pace.md): Fast pace, or ask Claude to use `form_input`.

## after a rebuild

`sh scripts/build.sh` reloads the extension in each connected profile. A
profile that was closed during the build needs a `reload` once it is open.

## still stuck

Stop Claude retrying. The skill tells it to stop and ask after two or three
failures in a row; do the same yourself.
