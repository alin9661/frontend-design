// lib/engine/core/rect-tracker.ts
//
// Document-space rect tracking (design doc §4, core/rect-tracker.ts).
// Layout is only ever read on `track()`/`refresh()` — everything a
// consumer does per-frame (`inView`, `viewportY`, `progress`) is pure
// arithmetic against the last-measured rect, so there are zero per-frame
// layout reads no matter how many views subscribe to scroll.
//
// `measure` is injectable so tests never need a real laid-out DOM — a fake
// `(el) => DOMRect` is enough to drive every code path.

import { clamp } from "./math";
import type { RectData, TrackedRect } from "../types";

export type MeasureFn = (el: Element) => DOMRect;

/** `top`/`left` are document-space (viewport rect + scrollY at the time of
 * the last `track()`/`refresh()`), matching `RectData`. Mutated in place by
 * `refresh()` so a `TrackedRect` returned from `track()` stays live. */
class MutableTrackedRect implements TrackedRect {
  top = 0;
  left = 0;
  width = 0;
  height = 0;

  inView(scrollY: number, viewportH: number, margin = 0): boolean {
    const viewTop = scrollY - margin;
    const viewBottom = scrollY + viewportH + margin;
    return this.top + this.height > viewTop && this.top < viewBottom;
  }

  viewportY(scrollY: number): number {
    return this.top - scrollY;
  }

  /** 0 when the element's top edge is about to enter at the viewport's
   * bottom edge; 1 when the element's bottom edge has just left the
   * viewport's top edge. Clamped, so it's safe to use directly as a
   * Timeline `p`. */
  progress(scrollY: number, viewportH: number): number {
    const span = viewportH + this.height;
    if (span <= 0) return 0;
    return clamp((scrollY + viewportH - this.top) / span, 0, 1);
  }
}

interface Entry {
  el: Element;
  rect: MutableTrackedRect;
}

export class RectTracker {
  private readonly measureFn: MeasureFn;
  private readonly entries = new Map<Element, Entry>();
  private lastScrollY = 0;

  constructor(opts: { measure?: MeasureFn } = {}) {
    this.measureFn = opts.measure ?? ((el) => el.getBoundingClientRect());
  }

  /** Starts tracking `el`, measuring it immediately against the
   * last-known scrollY. Calling this again for an already-tracked element
   * returns the same live `TrackedRect` instead of creating a duplicate. */
  track(el: Element): TrackedRect {
    const existing = this.entries.get(el);
    if (existing) return existing.rect;

    const rect = new MutableTrackedRect();
    this.entries.set(el, { el, rect });
    this.measureOne(el, rect, this.lastScrollY);
    return rect;
  }

  untrack(el: Element): void {
    this.entries.delete(el);
  }

  /** Re-measures every tracked element's viewport rect and converts it to
   * document-space using `scrollY`. Call on resize / fonts.ready — never
   * automatically, and never per-frame. */
  refresh(scrollY: number): void {
    this.lastScrollY = scrollY;
    for (const { el, rect } of this.entries.values()) {
      this.measureOne(el, rect, scrollY);
    }
  }

  private measureOne(el: Element, rect: MutableTrackedRect, scrollY: number): void {
    const bcr = this.measureFn(el);
    const data: RectData = { top: bcr.top + scrollY, left: bcr.left, width: bcr.width, height: bcr.height };
    rect.top = data.top;
    rect.left = data.left;
    rect.width = data.width;
    rect.height = data.height;
  }
}
