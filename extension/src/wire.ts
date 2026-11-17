// Helpers over the generated wire types (`docs/protocol.md`). Chrome does the
// length framing on the native port, so this side only rejoins chunks.
import type { Content, ErrorCode, Frame } from "./wire.gen";

export type { Content, ErrorCode, Frame };
export type CallFrame = Extract<Frame, { type: "call" }>;
export type ResultFrame = Extract<Frame, { type: "result" }>;

export const PROTOCOL = 1;

/** A tool failure that becomes an error `result` frame. */
export class ToolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function ok(id: number, content: Content[]): ResultFrame {
  return { type: "result", id, ok: true, content };
}

export function err(id: number, code: ErrorCode, message: string): ResultFrame {
  return { type: "result", id, ok: false, error: { code, message } };
}

export function text(value: unknown): Content {
  return { type: "text", text: typeof value === "string" ? value : JSON.stringify(value) };
}

/** Rejoins `chunk` frames into the frame they carry; others pass through. */
export class Reassembler {
  private parts = new Map<number, { next: number; data: string[] }>();

  push(frame: Frame): Frame | null {
    if (frame.type !== "chunk") return frame;
    const entry = this.parts.get(frame.id) ?? { next: 0, data: [] };
    if (entry.next !== frame.seq) {
      this.parts.delete(frame.id);
      throw new Error(`chunk ${frame.seq} of ${frame.id} out of order`);
    }
    entry.next += 1;
    entry.data.push(frame.data);
    this.parts.set(frame.id, entry);
    if (!frame.last) return null;
    this.parts.delete(frame.id);
    const bytes = Uint8Array.from(atob(entry.data.join("")), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Frame;
  }
}
