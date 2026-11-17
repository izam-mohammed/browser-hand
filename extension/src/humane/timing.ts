// Durations for moves, clicks and keys (plans/03-humane-input.md).
import { PARAMS, type Params } from "./params";
import { clamp, lognormal, normal, type Rng, uniform } from "./random";

/** Fitts's law movement time in ms for a move of `distance` px to a target
 * `width` px wide. */
export function fittsMs(distance: number, width: number, p: Params = PARAMS): number {
  if (distance < 1) return 0;
  return p.fittsA + p.fittsB * Math.log2(distance / Math.max(width, 1) + 1);
}

export function dwellMs(rng: Rng, p: Params = PARAMS): number {
  return uniform(rng, p.dwellMs);
}

export function clickHoldMs(rng: Rng, p: Params = PARAMS): number {
  return uniform(rng, p.clickHoldMs);
}

export function multiClickGapMs(rng: Rng, p: Params = PARAMS): number {
  return uniform(rng, p.multiClickGapMs);
}

/** Time from pressing one key to pressing the next (the inter-key
 * interval). The caller waits this less the time the key was held. */
export function keyGapMs(rng: Rng, prevChar = "", p: Params = PARAMS): number {
  // The interval between key presses is skewed right with a floor; the
  // hold is part of it, so the gap after release is the rest (input.ts).
  const interval = Math.max(p.keyGapFloorMs, lognormal(rng, p.keyGapMeanMs, p.keyGapSdMs));
  const extra = /[\s.,;:!?]/.test(prevChar) ? uniform(rng, p.wordPauseMs) : 0;
  return interval + extra;
}

export function keyHoldMs(rng: Rng, p: Params = PARAMS): number {
  return clamp(normal(rng, p.keyHoldMeanMs, p.keyHoldSdMs), 40, 250);
}

export function wheelGapMs(rng: Rng, p: Params = PARAMS): number {
  return uniform(rng, p.wheelGapMs);
}
