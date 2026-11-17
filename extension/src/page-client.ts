// Service worker side of the content script: sends a page operation to a
// tab's top frame, injecting the script first into tabs opened before the
// extension loaded.
import type { PageOp, PageReply } from "./page/content";
import { type ErrorCode, ToolError } from "./wire";

const NOT_THERE = /Receiving end does not exist|Could not establish connection/;

export async function toPage<T = unknown>(tabId: number, op: PageOp): Promise<T> {
  const send = () =>
    chrome.tabs.sendMessage(tabId, { ...op, __bh: true }, { frameId: 0 }) as Promise<PageReply>;
  let reply: PageReply;
  try {
    reply = await send();
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (!NOT_THERE.test(why)) throw new ToolError("page_error", why);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    } catch (e2) {
      throw new ToolError(
        "page_error",
        `Cannot read this page: ${e2 instanceof Error ? e2.message : String(e2)} (chrome:// pages, the Web Store and other extensions' pages are off limits)`,
      );
    }
    reply = await send();
  }
  if (!reply) throw new ToolError("page_error", "The page did not answer");
  if (!reply.ok) throw new ToolError(reply.code as ErrorCode, reply.message);
  return reply.value as T;
}
