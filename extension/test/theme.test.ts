import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeCss } from "../theme.mjs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const theme = read("../../design/theme.md");

describe("the settings page's CSS", () => {
  it("is fresh: src/options/theme.gen.css is what design/theme.md makes (run npm run build)", () => {
    expect(read("../src/options/theme.gen.css")).toBe(themeCss(theme));
  });

  it("holds every colour in both modes and the global tokens", () => {
    const css = themeCss(theme);
    for (const name of [
      "bg",
      "surface",
      "raised",
      "border",
      "control",
      "text",
      "text2",
      "text3",
      "accent",
      "accentText",
      "onAccent",
      "success",
      "warning",
      "danger",
      "info",
    ]) {
      expect(css.match(new RegExp(`--color-${name}:`, "g")), name).toHaveLength(2);
    }
    expect(css).toContain("--color-accent: #D97706;");
    expect(css).toContain("--color-accent: #F59E0B;");
    expect(css).toContain("--space-xl: 24px;");
    expect(css).toContain("--radius-lg: 12px;");
    expect(css).toContain("--opacity-tint: 0.14;");
    expect(css).toMatch(/--font-mono: "JetBrains Mono", /);
  });

  it("the page's own CSS names no colour: every colour is a token", () => {
    const own = read("../src/options/options.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(own).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("refuses a theme.md with a mode missing", () => {
    expect(() => themeCss(theme.replace(/^\| `dark\/.*$/gm, ""))).toThrow(/as many light as dark/);
  });
});
