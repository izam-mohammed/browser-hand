// Cursor paths: a cubic Bezier bowed to one side, sampled on a minimum-jerk
// profile so the cursor speeds up and slows into the target, with an
// overshoot and correction on long moves (plans/03-humane-input.md,
// decision 3).
import { PARAMS, type Params } from "./params";
import { clamp, uniform, type Rng } from "./random";
import { fittsMs } from "./timing";

export interface Pt {
  x: number;
  y: number;
}

/** Minimum-jerk position along a move, 0..1 for time 0..1 (Flash and Hogan). */
export function minimumJerk(t: number): number {
  return 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5;
}

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, s: number): Pt {
  const u = 1 - s;
  return {
    x: u ** 3 * p0.x + 3 * u * u * s * p1.x + 3 * u * s * s * p2.x + s ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u * u * s * p1.y + 3 * u * s * s * p2.y + s ** 3 * p3.y,
  };
}

/** Points one tick apart from `from` (exclusive) to `to` (inclusive). */
export function segment(from: Pt, to: Pt, durationMs: number, rng: Rng, p: Params = PARAMS): Pt[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return [to];

  // Anchors on one side of the line, offset by a share of the distance.
  const spread = clamp(dist, p.spreadMin, p.spreadMax);
  const side = rng() < 0.5 ? -1 : 1;
  const nx = (-dy / dist) * side;
  const ny = (dx / dist) * side;
  const anchor = (t: number): Pt => {
    const off = spread * uniform(rng, [0.1, 0.5]);
    return { x: from.x + dx * t + nx * off, y: from.y + dy * t + ny * off };
  };
  const a1 = anchor(uniform(rng, [0.2, 0.45]));
  const a2 = anchor(uniform(rng, [0.55, 0.8]));

  const steps = Math.max(2, Math.round(durationMs / p.moveIntervalMs));
  const out: Pt[] = [];
  for (let i = 1; i <= steps; i++) out.push(bezier(from, a1, a2, to, minimumJerk(i / steps)));
  out[out.length - 1] = { ...to };
  return out;
}

/** The whole move: one curve, or an overshoot then a short correction. */
export function movePath(from: Pt, to: Pt, targetWidth: number, rng: Rng, p: Params = PARAMS): Pt[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const total = fittsMs(dist, targetWidth, p);
  if (dist < p.overshootFromPx) return segment(from, to, total, rng, p);

  const angle = rng() * 2 * Math.PI;
  const r = rng() * p.overshootRadiusPx;
  const over = { x: to.x + Math.cos(angle) * r, y: to.y + Math.sin(angle) * r };
  const main = segment(from, over, total * (1 - p.correctionShare), rng, p);
  const fix = segment(over, to, total * p.correctionShare, rng, p);
  return [...main, ...fix];
}

/** Where on an element to aim: near the centre, never the edge. */
export function aimPoint(center: Pt, width: number, height: number, rng: Rng, p: Params = PARAMS): Pt {
  return {
    x: center.x + (rng() * 2 - 1) * (width / 2) * p.aimSpread,
    y: center.y + (rng() * 2 - 1) * (height / 2) * p.aimSpread,
  };
}
