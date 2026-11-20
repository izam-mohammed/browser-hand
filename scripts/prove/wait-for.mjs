// Proves `wait_for`: it returns when text, a URL part or a vanishing shows
// up, through a real page load, and times out with words that name what it
// waited for (plans/17-hands-free-and-guarded.md, Phase 1).
import { check, run } from "./headless.mjs";

await run({}, async (h) => {
  const { tabId } = await h.json("tabs_create");
  await h.call("navigate", { url: `${h.web}/delayed`, tabId });

  let t0 = Date.now();
  let r = await h.call("wait_for", { tabId, text: "ready now", timeout_s: 10 });
  const took = Date.now() - t0;
  check(!r.isError && /Found the text "ready now"/.test(r.text), `text appeared: ${r.text}`);
  check(took < 9000, `it returned when the text showed (${took} ms), not at the timeout`);

  await h.call("navigate", { url: `${h.web}/delayed`, tabId });
  r = await h.call("wait_for", { tabId, text: "Loading", gone: true, timeout_s: 10 });
  check(!r.isError && /is gone/.test(r.text), `text vanished: ${r.text}`);

  await h.call("navigate", { url: `${h.web}/hash`, tabId });
  r = await h.call("wait_for", { tabId, url_contains: "#done", timeout_s: 10 });
  check(!r.isError && /#done/.test(r.text), `URL part appeared: ${r.text}`);

  r = await h.call("wait_for", { tabId, text: "never on this page", timeout_s: 2 });
  check(r.isError && /timeout/.test(r.text) && /never on this page/.test(r.text), `a timeout names what it waited for: ${r.text}`);

  r = await h.call("wait_for", { tabId });
  check(r.isError && /exactly one of text, ref or url_contains/.test(r.text), `no condition is refused: ${r.text}`);
  console.log("PASS: wait_for returned on the text, the vanishing and the URL, and timed out with the reason");
});
