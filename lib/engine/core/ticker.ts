// lib/engine/core/ticker.ts
//
// Priority-bucketed frame scheduler (design doc §4, core/ticker.ts). Owns
// no rendering itself — it just calls subscribers in `order` each frame
// with a clamped, frame-rate-independent `dt` (seconds) and running
// `elapsed` (seconds). `tick(dtMs)` is the manual-advance test seam: call
// it directly to drive the whole engine deterministically without a real
// requestAnimationFrame loop.
//
// `start()`/`stop()` drive a real rAF loop and pause on
// `document.visibilitychange` — both are main-thread-only concerns, guarded
// so this file stays usable from tests (jsdom has `document`, but a worker
// does not).

import { TickOrder, type TickFn } from "../types";

export { TickOrder };

/** Per design doc §4: raw frame delta is clamped to this many milliseconds
 * before being handed to subscribers, so a tabbed-out/janky frame never
 * produces a huge simulation step (e.g. a scroll target snapping across the
 * whole page in one tick). */
const MAX_DT_MS = 64;

interface Entry {
  fn: TickFn;
  order: number;
  seq: number;
}

export class Ticker {
  private entries: Entry[] = [];
  private seqCounter = 0;
  private _running = false;
  private elapsedMs = 0;
  private rafId: number | null = null;
  private lastFrameTimeMs: number | null = null;
  private visibilityHandler: (() => void) | null = null;

  /** Subscribes `fn`, run in ascending `order` (ties keep insertion order).
   * Returns an unsubscribe function. */
  add(fn: TickFn, order: number = TickOrder.SCENE): () => void {
    const entry: Entry = { fn, order, seq: this.seqCounter++ };
    this.entries.push(entry);
    this.entries.sort((a, b) => a.order - b.order || a.seq - b.seq);
    return () => {
      const idx = this.entries.indexOf(entry);
      if (idx !== -1) this.entries.splice(idx, 1);
    };
  }

  /** Starts a real requestAnimationFrame loop (main-thread only; a no-op if
   * rAF isn't available, e.g. under jsdom without a stub). Idempotent. */
  start(): void {
    if (this._running) return;
    this._running = true;
    this.lastFrameTimeMs = null;
    this.attachVisibilityHandler();
    this.scheduleFrame();
  }

  /** Stops the rAF loop and detaches the visibility listener. Idempotent. */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    this.cancelScheduledFrame();
    this.detachVisibilityHandler();
  }

  /** Manual advance — the test seam. Clamps `dtMs`, converts to seconds,
   * and calls every subscriber in priority order with `(dt, elapsed)`. */
  tick(dtMs: number): void {
    const clampedMs = clampDt(dtMs);
    const dt = clampedMs / 1000;
    this.elapsedMs += clampedMs;
    const elapsed = this.elapsedMs / 1000;

    // Snapshot so a subscriber that unsubscribes (itself or another) during
    // this pass doesn't mutate the array we're iterating.
    for (const entry of [...this.entries]) {
      entry.fn(dt, elapsed);
    }
  }

  get running(): boolean {
    return this._running;
  }

  private scheduleFrame(): void {
    if (typeof requestAnimationFrame === "undefined") return;
    if (typeof document !== "undefined" && document.hidden) return;
    this.rafId = requestAnimationFrame(this.onRaf);
  }

  private cancelScheduledFrame(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }

  private onRaf = (timeMs: number): void => {
    if (!this._running) return;
    const last = this.lastFrameTimeMs ?? timeMs;
    this.lastFrameTimeMs = timeMs;
    this.tick(timeMs - last);
    this.scheduleFrame();
  };

  private attachVisibilityHandler(): void {
    if (typeof document === "undefined") return;
    this.visibilityHandler = () => {
      if (document.hidden) {
        this.cancelScheduledFrame();
      } else {
        // Resuming after a pause: don't let the next frame see a dt spanning
        // the whole hidden duration.
        this.lastFrameTimeMs = null;
        if (this._running) this.scheduleFrame();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private detachVisibilityHandler(): void {
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.visibilityHandler = null;
  }
}

function clampDt(dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs < 0) return 0;
  return Math.min(dtMs, MAX_DT_MS);
}
