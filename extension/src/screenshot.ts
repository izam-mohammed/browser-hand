// `screenshot` and `zoom`: CDP Page.captureScreenshot on the tab, in the
// viewport's CSS pixel frame so coordinates Claude reads off the image are
// the ones `computer` takes (plans/plan-humane-input.md, decision 5).
import type { DebuggerManager } from "./debugger";
import { ToolError } from "./wire";

/** Long edges past these are scaled down (Anthropic's guidance for web
 * apps, docs/research/humane-input.md § 5). */
export const MAX_WIDTH = 1280;
export const MAX_HEIGHT = 800;
export const CAPTURE_TIMEOUT_MS = 10_000;
const JPEG_QUALITY = 80;

export interface Shot {
  data: string;
  mimeType: string;
  text: string;
}

interface Metrics {
  cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
}

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new ToolError("timeout", `${what} took over ${CAPTURE_TIMEOUT_MS / 1000} s`)), CAPTURE_TIMEOUT_MS),
    ),
  ]);
}

/** Output size per CSS pixel for a full screenshot. */
export function fitScale(width: number, height: number, userScale = 1): number {
  const fit = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  return fit * Math.min(1, Math.max(0.1, userScale));
}

/** Output size per CSS pixel for a zoomed region: enlarged up to 3x. */
export function zoomScale(width: number, height: number, userScale = 1): number {
  const enlarge = Math.min(3, Math.max(1, Math.min(MAX_WIDTH / width, MAX_HEIGHT / height)));
  return enlarge * Math.min(1, Math.max(0.1, userScale));
}

export async function capture(
  dbg: DebuggerManager,
  tabId: number,
  opts: { scale?: number; region?: [number, number, number, number] },
): Promise<Shot> {
  const metrics = await dbg.send<Metrics>(tabId, "Page.getLayoutMetrics");
  const vv = metrics.cssVisualViewport;
  const dprEval = await dbg.send<{ result: { value: number } }>(tabId, "Runtime.evaluate", {
    expression: "window.devicePixelRatio",
    returnByValue: true,
  });
  const dpr = dprEval.result?.value || 1;

  let clip: { x: number; y: number; width: number; height: number };
  let outScale: number;
  if (opts.region) {
    const [x0, y0, x1, y1] = opts.region;
    if (!(x1 > x0 && y1 > y0)) throw new ToolError("bad_args", "region must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0");
    clip = { x: vv.pageX + x0, y: vv.pageY + y0, width: x1 - x0, height: y1 - y0 };
    outScale = zoomScale(clip.width, clip.height, opts.scale);
  } else {
    clip = { x: vv.pageX, y: vv.pageY, width: vv.clientWidth, height: vv.clientHeight };
    outScale = fitScale(clip.width, clip.height, opts.scale);
  }

  // The clip's scale multiplies device pixels, so divide out the ratio to
  // size the image in CSS pixels times outScale.
  const shot = await withTimeout(
    dbg.send<{ data: string }>(tabId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: JPEG_QUALITY,
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { ...clip, scale: outScale / dpr },
    }),
    "Screenshot",
  );

  const w = Math.round(clip.width * outScale);
  const h = Math.round(clip.height * outScale);
  const frame = `viewport ${Math.round(vv.clientWidth)}x${Math.round(vv.clientHeight)} CSS px`;
  const text = opts.region
    ? `Zoomed region [${opts.region.join(", ")}] of tab ${tabId} (${frame}); image ${w}x${h}, ${outScale.toFixed(2)}x. Coordinates for clicks stay in the viewport frame.`
    : `Screenshot of tab ${tabId}: ${frame}; image ${w}x${h} (scale ${outScale.toFixed(3)}). Give click coordinates in the viewport frame: image pixel / ${outScale.toFixed(3)}.`;
  return { data: shot.data, mimeType: "image/jpeg", text };
}

/** For a tab Chrome will not attach to: the visible area of the active tab. */
export async function captureVisible(tab: chrome.tabs.Tab): Promise<Shot> {
  if (!tab.active || tab.windowId === undefined) {
    throw new ToolError("debugger_refused", "Cannot screenshot this tab: Chrome refused to attach and it is not the active tab");
  }
  const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: JPEG_QUALITY });
  return {
    data: url.slice(url.indexOf(",") + 1),
    mimeType: "image/jpeg",
    text: `Screenshot of tab ${tab.id} via captureVisibleTab (device pixels; debugger unavailable on this page).`,
  };
}
