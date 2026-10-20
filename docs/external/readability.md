# @mozilla/readability

Fetched: 17/10/2026 from https://github.com/mozilla/readability (README.md)
and `npm view @mozilla/readability`.
Version: 0.6.0, Apache-2.0.

## What this project uses

- `new Readability(document, options)`; options are "all optional"
  (`debug`, `maxElemsToParse`, `nbTopCandidates`, `charThreshold`,
  `keepClasses`, `serializer`, others).
- `parse()` "returns an object containing" `title`, `content`, `textContent`,
  `length`, `excerpt`, `byline`, `dir`, `siteName`, `lang`, `publishedTime`.
  `get_page_text` uses `title` and `textContent`.

## Errors

Not stated; `parse()` can return `null` when no article is found (the
project treats `null` as "no article" and falls back to `body.innerText`).
The `null` case is from the library's type definitions, not the README.

## Limits

`maxElemsToParse` caps work on huge pages; default not stated in the README.

## Gotchas

- "The `parse()` method works by modifying the DOM." Always pass
  `document.cloneNode(true)`, never the live document.
- `isProbablyReaderable` "is likely to produce both false positives and false
  negatives"; not used.
