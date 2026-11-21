// Proves the site allow list in a real Chrome for Testing: with
// `sites.allowed = ["localhost/*"]`, a tool cannot open 127.0.0.1, the
// network rule stops an iframe to it, and a tab the person opens is left
// alone (plans/17-hands-free-and-guarded.md, Phase 3).
import { check, run } from "./headless.mjs";

const config = () => `[sites]\nallowed = ["localhost/*"]\n`;

await run({ config }, async (h) => {
  const { tabId } = await h.json("tabs_create");

  let r = await h.call("navigate", { url: `${h.web}/`, tabId });
  check(!r.isError, `a listed site opens: ${r.text.slice(0, 80)}`);

  r = await h.call("navigate", { url: `${h.webAlt}/direct`, tabId });
  check(r.isError && /not on the allowed sites list/.test(r.text), `an unlisted site is refused with the reason: ${r.text.slice(0, 120)}`);
  check(!h.hits.some((x) => x.host === "127.0.0.1" && x.url === "/direct"), "the unlisted site was never requested");

  // The network rule: a listed page with an iframe to the unlisted site.
  await h.call("navigate", { url: `${h.web}/frame`, tabId });
  await h.sleep(2500);
  check(!h.hits.some((x) => x.host === "127.0.0.1" && x.url === "/inner"), "the iframe to the unlisted site never reached the server");

  // Control: the person's own tab, outside the group, is not touched.
  await h.openTab(`${h.webAlt}/outside`);
  await h.sleep(1500);
  check(h.hits.some((x) => x.host === "127.0.0.1" && x.url === "/outside"), "a tab outside the group still loads the unlisted site");
  console.log("PASS: the allow list refused an unlisted site in the tool gate and the network, and left the person's own tab alone");
});
