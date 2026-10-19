// Every humane constant in one place, each with its source or marked as an
// ASSUMPTION to tune in the walk (plans/03-humane-input.md, Open decisions).
// Sources: docs/research/humane-input.md.

export const PARAMS = {
  /** One mouseMoved per 16 ms (60 Hz): § 1 Event rate. */
  moveIntervalMs: 16,

  /** Fitts's law MT = a + b log2(D/W + 1). ASSUMPTION: published mouse pairs
   * disagree (§ 1 Duration); these put an 800 px move to a 40 px target near
   * 0.7 s. */
  fittsA: 50,
  fittsB: 150,
  /** Target width when no ref gives one. ASSUMPTION. */
  defaultTargetWidth: 20,

  /** Bezier anchor spread clamp: ghost-cursor defaults (§ 1 Path models). */
  spreadMin: 2,
  spreadMax: 200,
  /** Overshoot only on long moves, landing within this radius: ghost-cursor
   * defaults (§ 1 Overshoot and correction). */
  overshootFromPx: 500,
  overshootRadiusPx: 120,
  /** Share of a long move's time spent on the correction. ASSUMPTION. */
  correctionShare: 0.25,

  /** Pause on the target before pressing. ASSUMPTION (no research figure). */
  dwellMs: [60, 250] as const,
  /** Mouse button held down. ASSUMPTION (no research figure). */
  clickHoldMs: [60, 140] as const,
  /** Gap between the clicks of a double or triple click. ASSUMPTION. */
  multiClickGapMs: [80, 140] as const,
  /** Aim within this share of the element's half-size around its centre. ASSUMPTION. */
  aimSpread: 0.3,

  /** Gap between keys: mean 238.7 ms, SD 111.6, floor about 60 ms (Dhakal et
   * al., CHI 2018; § 2). */
  keyGapMeanMs: 238.7,
  keyGapSdMs: 111.6,
  keyGapFloorMs: 60,
  /** Key held down: mean 116 ms, SD 23.9 (same study). */
  keyHoldMeanMs: 116,
  keyHoldSdMs: 23.9,
  /** Extra pause after a space or punctuation. ASSUMPTION. */
  wordPauseMs: [0, 120] as const,

  /** Wheel notch: deltaY 100, Chromium's figure for default settings (§ 3). */
  wheelDelta: 100,
  /** Gap between wheel notches. ASSUMPTION. */
  wheelGapMs: [30, 90] as const,

  /** Pace "fast": same events, no travel time or gaps. */
  fastStepMs: 0,
} as const;

export type Params = typeof PARAMS;
