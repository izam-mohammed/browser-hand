// `get_page_text`: the article when Readability finds one, else the body
// text (docs/external/readability.md).
import { Readability } from "@mozilla/readability";

export const MAX_TEXT = 100_000;

function squash(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

export function pageText(doc: Document): string {
  let title = doc.title;
  let body = "";
  try {
    // parse() edits the DOM it is given, so it gets a copy.
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    if (article?.textContent && article.textContent.trim().length > 200) {
      title = article.title || title;
      body = article.textContent;
    }
  } catch {
    // fall through to the body text
  }
  if (!body) body = (doc.body as HTMLElement | null)?.innerText ?? doc.body?.textContent ?? "";
  let out = `${title}\n${doc.location?.href ?? ""}\n\n${squash(body)}`;
  if (out.length > MAX_TEXT) out = `${out.slice(0, MAX_TEXT)}\n[truncated: ${out.length} characters in full]`;
  return out;
}
