// lib/engine/core/normalize-wheel.ts
//
// Pure WheelEvent -> pixel-delta normalizer (design doc §4,
// core/normalize-wheel.ts). Browsers report wheel deltas in one of three
// units depending on input device / OS (WheelEvent.deltaMode): pixels
// (trackpads, most mice), lines (some mice, older browsers), or pages
// (rare, e.g. spacebar-less "page" scroll devices). scroll.ts always wants
// pixels, so this collapses all three into one consistent pixelX/pixelY.

/** WheelEvent.DOM_DELTA_LINE: multiply line deltas by roughly one text
 * line's height to approximate the pixel distance a browser would have
 * scrolled natively. */
const LINE_HEIGHT_PX = 40;

/** WheelEvent.DOM_DELTA_PAGE: multiply page deltas by an approximate
 * viewport height in pixels. */
const PAGE_HEIGHT_PX = 800;

export interface NormalizedWheel {
  pixelX: number;
  pixelY: number;
}

/** Converts a WheelEvent's deltaX/deltaY into pixel units regardless of its
 * deltaMode. deltaMode 0 (DOM_DELTA_PIXEL) passes through unchanged. */
export function normalizeWheel(e: WheelEvent): NormalizedWheel {
  let pixelX = e.deltaX;
  let pixelY = e.deltaY;

  if (e.deltaMode === 1) {
    // DOM_DELTA_LINE
    pixelX *= LINE_HEIGHT_PX;
    pixelY *= LINE_HEIGHT_PX;
  } else if (e.deltaMode === 2) {
    // DOM_DELTA_PAGE
    pixelX *= PAGE_HEIGHT_PX;
    pixelY *= PAGE_HEIGHT_PX;
  }
  // deltaMode 0 (DOM_DELTA_PIXEL, the common case): already pixels.

  return { pixelX, pixelY };
}
