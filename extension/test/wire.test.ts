import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Reassembler, type Frame } from "../src/wire";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../host/tests/fixtures/${name}`, import.meta.url), "utf8"));

describe("wire", () => {
  it("passes every fixture frame through unchanged", () => {
    const r = new Reassembler();
    const frames = fixture("frames.json") as Frame[];
    for (const f of frames.filter((f) => f.type !== "chunk")) expect(r.push(f)).toEqual(f);
  });

  it("rejoins the chunks the Rust side wrote into the original call", () => {
    const r = new Reassembler();
    const chunks = fixture("chunked-call.json") as Frame[];
    expect(chunks.length).toBeGreaterThan(1);
    let out: Frame | null = null;
    for (const c of chunks) out = r.push(c);
    expect(out).toMatchObject({ type: "call", id: 42, tool: "upload_image" });
    expect((out as unknown as { args: { data: string } }).args.data).toHaveLength(1_200_000);
  });

  it("refuses chunks out of order", () => {
    const r = new Reassembler();
    const chunks = fixture("chunked-call.json") as Frame[];
    expect(() => r.push(chunks[1]!)).toThrow(/out of order/);
  });
});
