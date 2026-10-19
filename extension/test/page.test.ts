// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ConsoleBuffer } from "../src/page/console";
import { find, formatFind } from "../src/page/find";
import { formInput } from "../src/page/forms";
import { HOOK_TAG, installHooks } from "../src/page/hooks";
import { pageText } from "../src/page/text";
import { readPage, resetRefs, resolveRef, walk } from "../src/page/walker";

const FORM = `
  <header><nav><a href="/home">Home</a><a href="/about">About us</a></nav></header>
  <main>
    <h1>Sign in</h1>
    <form>
      <label for="email">Email address</label><input id="email" type="email" placeholder="you@example.com">
      <label>Password <input id="pw" type="password" value="secret"></label>
      <input id="remember" type="checkbox" aria-label="Remember me">
      <select id="lang"><option value="en">English</option><option value="fr">Français</option></select>
      <button id="go" type="submit">Log in</button>
      <div role="button" aria-labelledby="hint">?</div><span id="hint">Help with signing in</span>
      <button hidden>Hidden thing</button>
    </form>
    <p>Loose <b>text</b> here</p>
  </main>`;

beforeEach(() => {
  resetRefs();
  document.title = "Fixture";
  document.body.innerHTML = FORM;
});

describe("walker", () => {
  it("names elements from every labelling source", () => {
    const out = walk(document.body).join("\n");
    expect(out).toContain('textbox "Email address"');
    expect(out).toContain('textbox "Password"');
    expect(out).toContain('checkbox "Remember me"');
    expect(out).toContain('button "Log in"');
    expect(out).toContain('button "Help with signing in"');
    expect(out).toContain('link "About us"');
    expect(out).toContain('heading "Sign in"');
  });

  it("never prints a password value", () => {
    expect(walk(document.body).join("\n")).not.toContain("secret");
  });

  it("keeps refs stable across reads and resolves them", () => {
    const first = readPage(document);
    const second = readPage(document);
    expect(first).toBe(second);
    const ref = /button "Log in" \[(ref_\w+)\]/.exec(first)![1]!;
    expect(resolveRef(ref)).toBe(document.getElementById("go"));
  });

  it("interactive filter keeps only controls and drops hidden ones", () => {
    const out = readPage(document, { filter: "interactive" });
    expect(out).not.toContain("heading");
    expect(out).not.toContain("Hidden thing");
    expect(out).toContain('button "Log in"');
  });

  it("truncates at a line boundary with the full size noted", () => {
    const out = readPage(document, { max_chars: 120 });
    expect(out).toMatch(/\[truncated: \d+ characters in full/);
    const kept = out.split("\n[truncated")[0]!;
    expect(kept.length).toBeLessThanOrEqual(120);
  });

  it("ref_id focuses on one element", () => {
    const all = readPage(document);
    const formRef = /- form \[(ref_\w+)\]/.exec(all)![1]!;
    const out = readPage(document, { ref_id: formRef });
    expect(out).toContain("Log in");
    expect(out).not.toContain("About us");
  });

  it("a ref gone from the page is an error telling Claude to read again", () => {
    readPage(document);
    document.body.innerHTML = "<p>new</p>";
    expect(() => readPage(document, { ref_id: "ref_1" })).toThrow(/read_page again/);
  });

  it("a ref from the previous document never resolves on the next one", () => {
    const old = /button "Log in" \[(ref_\w+)\]/.exec(readPage(document))![1]!;
    resetRefs();
    document.body.innerHTML = FORM;
    const fresh = /button "Log in" \[(ref_\w+)\]/.exec(readPage(document))![1]!;
    expect(fresh).not.toBe(old);
    expect(resolveRef(old)).toBeNull();
    expect(() => readPage(document, { ref_id: old })).toThrow(/read_page again/);
  });
});

describe("find", () => {
  it("ranks the matching control first", () => {
    const r = find(document.body, "log in button");
    expect(r.matches[0]).toMatchObject({ role: "button", name: "Log in" });
  });

  it("matches fields by label words and role words", () => {
    expect(find(document.body, "email field").matches[0]?.name).toBe("Email address");
    expect(find(document.body, "remember checkbox").matches[0]?.name).toBe("Remember me");
  });

  it("never matches on a password field's value", () => {
    // The fixture's password field holds "secret"; find must not confirm it.
    expect(find(document.body, "secret").matches).toEqual([]);
  });

  it("says when nothing matches", () => {
    expect(formatFind("zebra", find(document.body, "zebra"))).toMatch(/No elements match/);
  });
});

describe("form_input", () => {
  const refOf = (id: string) => {
    const out = readPage(document);
    const line = { email: 'textbox "Email address"', remember: 'checkbox "Remember me"', go: 'button "Log in"' }[id]!;
    return new RegExp(`${line} \\[(ref_\\w+)\\]`).exec(out)?.[1] ?? "";
  };

  it("sets a text field and fires input and change", () => {
    const events: string[] = [];
    const email = document.getElementById("email") as HTMLInputElement;
    email.addEventListener("input", () => events.push("input"));
    email.addEventListener("change", () => events.push("change"));
    formInput(refOf("email"), "pat@example.com");
    expect(email.value).toBe("pat@example.com");
    expect(events).toEqual(["input", "change"]);
  });

  it("checks a checkbox from a boolean", () => {
    formInput(refOf("remember"), true);
    expect((document.getElementById("remember") as HTMLInputElement).checked).toBe(true);
  });

  it("selects an option by its text or says which exist", () => {
    readPage(document);
    const sel = document.getElementById("lang") as HTMLSelectElement;
    const ref = /combobox \[(ref_\w+)\]/.exec(readPage(document))![1]!;
    formInput(ref, "Français");
    expect(sel.value).toBe("fr");
    expect(() => formInput(ref, "German")).toThrow(/Options: "English", "Français"/);
  });

  it("refuses a button", () => {
    expect(() => formInput(refOf("go"), "x")).toThrow(/not a form field/);
  });
});

describe("console hooks", () => {
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it("records logs and errors without breaking the page's console", async () => {
    const buffer = new ConsoleBuffer();
    buffer.listen(window);
    installHooks(window as Window & typeof globalThis);
    console.log("hello", { a: 1 });
    console.error("boom");
    await tick();
    expect(buffer.read({ pattern: "hello" })).toContain('log: hello {"a":1}');
    expect(buffer.read({ onlyErrors: true })).toContain("error: boom");
    expect(buffer.read({ onlyErrors: true })).not.toContain("hello");
  });

  it("the page's message listeners never see console entries", async () => {
    installHooks(window as Window & typeof globalThis);
    const seen: unknown[] = [];
    const onMessage = (e: MessageEvent) => seen.push(e.data);
    window.addEventListener("message", onMessage);
    console.log("quiet");
    await tick();
    window.removeEventListener("message", onMessage);
    expect(seen).toEqual([]);
  });

  it("ignores events that are not from the hooks", async () => {
    const buffer = new ConsoleBuffer();
    buffer.listen(window);
    window.postMessage({ [HOOK_TAG]: true, level: "log", text: "posted" }, "*");
    document.dispatchEvent(new CustomEvent(HOOK_TAG, { detail: { level: "log", text: "object" } }));
    document.dispatchEvent(new CustomEvent(HOOK_TAG, { detail: "not json" }));
    await tick();
    expect(buffer.read({})).toBe("No console messages match.");
  });

  it("caps a tagged message the page posts itself at 4,000 characters", () => {
    const buffer = new ConsoleBuffer();
    buffer.listen(window);
    document.dispatchEvent(
      new CustomEvent(HOOK_TAG, { detail: JSON.stringify({ level: "log", text: "x".repeat(50_000), time: 0 }) }),
    );
    const out = buffer.read({});
    expect(out.length).toBeLessThan(4100);
    expect(out).toContain("x".repeat(4000));
  });

  it("clear empties the buffer and a bad pattern is bad_args", () => {
    const buffer = new ConsoleBuffer();
    buffer.push({ level: "log", text: "one", time: 0 });
    buffer.read({ clear: true });
    expect(buffer.read({})).toBe("No console messages match.");
    expect(() => buffer.read({ pattern: "(" })).toThrow(/Bad pattern/);
    expect(HOOK_TAG).toBe("__browserHandConsole");
  });
});

describe("page text", () => {
  it("falls back to the body text when there is no article", () => {
    const out = pageText(document);
    expect(out.split("\n")[0]).toBe("Fixture");
    expect(out).toContain("Sign in");
  });

  it("prefers the article over navigation", () => {
    const para = "Readable paragraph about the topic, long enough to count. ".repeat(12);
    document.body.innerHTML = `<nav>Menu Menu Menu</nav><article><h1>Story</h1><p>${para}</p><p>${para}</p></article><footer>Footer links</footer>`;
    const out = pageText(document);
    expect(out).toContain("Readable paragraph");
    expect(out).not.toContain("Footer links");
  });
});
