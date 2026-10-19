// `find`: rank elements against a plain-language query by words in their
// role, name, placeholder, value and text. Local and offline by design
// (plans/02-page-tools.md, decision 2).
import { allElements, isInteractiveRole, nameOf, refFor, roleOf } from "./walker";

export const MAX_RESULTS = 20;

/** Words in a query that name a role rather than a label. */
const ROLE_WORDS: Record<string, string[]> = {
  button: ["button"],
  btn: ["button"],
  link: ["link"],
  field: ["textbox", "searchbox", "combobox"],
  input: ["textbox", "searchbox", "combobox", "checkbox", "radio"],
  box: ["textbox", "searchbox", "checkbox"],
  textbox: ["textbox"],
  search: ["searchbox"],
  checkbox: ["checkbox"],
  check: ["checkbox"],
  radio: ["radio"],
  dropdown: ["combobox", "listbox"],
  select: ["combobox", "listbox"],
  menu: ["menuitem", "combobox"],
  tab: ["tab"],
  heading: ["heading"],
  title: ["heading"],
  image: ["img"],
  picture: ["img"],
  slider: ["slider"],
};

const STOP = new Set(["the", "a", "an", "of", "for", "to", "in", "on", "with", "that", "this", "and", "or", "containing"]);

function words(s: string): string[] {
  return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w));
}

export interface Match {
  ref: string;
  role: string;
  name: string;
  score: number;
}

export function find(root: Element, query: string): { matches: Match[]; total: number } {
  const q = words(query);
  const wantedRoles = new Set(q.flatMap((w) => ROLE_WORDS[w] ?? []));
  const labelWords = q.filter((w) => !ROLE_WORDS[w]);

  const scored: Match[] = [];
  for (const el of allElements(root)) {
    const role = roleOf(el);
    if (!role) continue;
    const name = nameOf(el);
    // A password's value is never matched: a hit would confirm the secret.
    const value = (el as HTMLInputElement).type === "password" ? "" : (el as HTMLInputElement).value;
    const extra = [el.getAttribute("placeholder"), value, el.getAttribute("title"), el.id]
      .filter(Boolean)
      .join(" ");
    const hay = new Set(words(`${name} ${extra}`));

    let score = 0;
    if (wantedRoles.size && wantedRoles.has(role)) score += 3;
    for (const w of labelWords) {
      if (hay.has(w)) score += 2;
      else if ([...hay].some((h) => h.startsWith(w) || w.startsWith(h))) score += 1;
    }
    if (labelWords.length && name.toLowerCase() === labelWords.join(" ")) score += 3;
    if (score === 0) continue;
    if (labelWords.length && score < 2) continue; // a role match alone is not enough when words were given
    if (isInteractiveRole(role)) score += 0.5;
    scored.push({ ref: refFor(el), role, name, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return { matches: scored.slice(0, MAX_RESULTS), total: scored.length };
}

export function formatFind(query: string, result: { matches: Match[]; total: number }): string {
  if (!result.matches.length) return `No elements match "${query}". Try other words, or read_page.`;
  const lines = result.matches.map((m) => `- ${m.role}${m.name ? ` "${m.name}"` : ""} [${m.ref}]`);
  if (result.total > MAX_RESULTS) {
    lines.push(`(${result.total} elements match; showing the best ${MAX_RESULTS}. Use a more specific query.)`);
  }
  return lines.join("\n");
}
