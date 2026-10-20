# Page tools baseline

Measured 20/10/2026 in the Default profile, Chrome on macOS, viewport
1920 x 1024. Time is the whole tool call as the MCP client sees it (server,
socket, extension and page); size is the characters returned.

| Page | `read_page` | `read_page` interactive | Other |
| --- | --- | --- | --- |
| News-style article: `en.wikipedia.org/wiki/Web_browser` | 26 ms, 50,093 chars (hits the 50,000 cap) | 6 ms, 41,832 chars | `get_page_text` 22 ms, 19,192 chars |
| Web app: `excalidraw.com` | 10 ms, 2,000 chars | 2 ms, 1,361 chars | |
| Long form: `selenium.dev/selenium/web/formPage.html` | 3 ms, 4,723 chars | 2 ms, 1,452 chars | `find "email field"` 2 ms, 659 chars |

The walker is fast everywhere; the cost is size. A long article fills the
50,000-character cap, so `filter: "interactive"`, `depth` or `ref_id` are
what keep it small, as the server instructions already say.
