// lib/engine/core/scroll.ts
//
// HYBRID virtual scroll (design doc §4, core/scroll.ts + §1 "our deltas").
// The page never gets a fake scroll container — `window.scrollY` stays the
// canonical, real, native scroll position (keyboard, anchors,
// find-in-page, and screen readers keep working untouched). Only the wheel
// gesture is intercepted: `normalizeWheel` turns it into a pixel delta,
// accumulated into `target`, and each tick we damp `current` toward
// `target` and imperatively `scrollTo` the real document to that damped
// value — producing the smooth/lagged "virtual scroll" feel without
// virtualizing anything.
//
// Two escape hatches keep this honest:
//   - External divergence resync: if `window.scrollY` ever differs from
//     the value we ourselves last wrote (native touch inertia, a keyboard
//     PageDown, an anchor jump, `Ctrl+F` scrolling to a match, ...), we
//     snap `target`/`current` to the real position on the next tick rather
//     than fighting it.
//   - Reduced motion: per §6, a11y requires *native* scroll with *static*
//     GL frames. So when `reducedMotion` is true the wheel listener is
//     never installed at all, and every tick just mirrors
//     `window.scrollY` straight into `current` with zero damping lag.

import { Ticker, TickOrder } from "./ticker";
import { Emitter } from "./events";
import { clamp, damp } from "./math";
import { normalizeWheel } from "./normalize-wheel";
import { prefersReducedMotion } from "./reduced-motion";
import type { ScrollOptions, ScrollState } from "../types";

const DEFAULT_LAMBDA = 8;
const DEFAULT_WHEEL_MULTIPLIER = 1;

/** How far (px) `window.scrollY` may differ from the value we last wrote
 * via `scrollTo` before we treat it as an externally-caused divergence
 * rather than browser sub-pixel rounding of our own write. */
const DIVERGENCE_EPSILON_PX = 1;

export class VirtualScroll {
  private readonly ticker: Ticker;
  private readonly lambda: number;
  private readonly wheelMultiplier: number;
  private readonly el: Window;
  private readonly reducedMotion: boolean;
  private readonly emitter = new Emitter<{ scroll: ScrollState }>();
  private readonly unsubscribeTick: () => void;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;

  private _state: ScrollState;
  private lastWrittenY: number;
  private destroyed = false;

  constructor(ticker: Ticker, opts: ScrollOptions = {}) {
    this.ticker = ticker;
    this.lambda = opts.lambda ?? DEFAULT_LAMBDA;
    this.wheelMultiplier = opts.wheelMultiplier ?? DEFAULT_WHEEL_MULTIPLIER;
    this.el = opts.el ?? (window as unknown as Window);
    this.reducedMotion = opts.reducedMotion ?? prefersReducedMotion();

    const initialY = this.el.scrollY ?? 0;
    this._state = { target: initialY, current: initialY, velocity: 0, progress: 0, limit: 0 };
    this.lastWrittenY = initialY;

    if (!this.reducedMotion) {
      this.wheelHandler = (e: WheelEvent): void => {
        // Let the browser handle pinch/ctrl-wheel zoom (a11y-relevant — do
        // NOT swallow page zoom) and purely-horizontal trackpad pans (this
        // engine only ever consumes pixelY): bail before preventDefault so
        // native behavior survives for both gestures.
        if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();
        const { pixelY } = normalizeWheel(e);
        this._state = {
          ...this._state,
          target: clamp(this._state.target + pixelY * this.wheelMultiplier, 0, this._state.limit),
        };
      };
      this.el.addEventListener("wheel", this.wheelHandler, { passive: false });
    }

    this.unsubscribeTick = this.ticker.add((dt) => this.onTick(dt), TickOrder.SCROLL);
  }

  get state(): Readonly<ScrollState> {
    return this._state;
  }

  on(event: "scroll", cb: (s: ScrollState) => void): () => void {
    return this.emitter.on(event, cb);
  }

  /** Programmatically scrolls to `y` (clamped to the current limit). With
   * `immediate`, snaps `current` there too (and writes it to the real
   * document) instead of easing over subsequent ticks. */
  scrollTo(y: number, opts: { immediate?: boolean } = {}): void {
    const target = clamp(y, 0, this._state.limit);
    if (opts.immediate) {
      this._state = { ...this._state, target, current: target, velocity: 0 };
      this.el.scrollTo(0, target);
      this.lastWrittenY = target;
    } else {
      this._state = { ...this._state, target };
    }
  }

  /** Updates the scrollable limit (real document height minus viewport
   * height), clamping the current target/position into range. Call on
   * resize / fonts.ready — this module never reads layout itself. */
  resize(limit: number): void {
    this._state = {
      ...this._state,
      limit,
      target: clamp(this._state.target, 0, limit),
      current: clamp(this._state.current, 0, limit),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribeTick();
    if (this.wheelHandler) {
      this.el.removeEventListener("wheel", this.wheelHandler);
      this.wheelHandler = null;
    }
    this.emitter.clear();
  }

  private onTick(dt: number): void {
    const actualY = this.el.scrollY ?? 0;

    if (this.reducedMotion) {
      // Native scroll only: mirror reality, no damping, no writes.
      const velocity = dt > 0 ? (actualY - this._state.current) / dt : 0;
      this._state = {
        target: actualY,
        current: actualY,
        velocity,
        progress: progressOf(actualY, this._state.limit),
        limit: this._state.limit,
      };
      this.lastWrittenY = actualY;
      this.emitter.emit("scroll", this._state);
      return;
    }

    if (Math.abs(actualY - this.lastWrittenY) > DIVERGENCE_EPSILON_PX) {
      // Something other than our own scrollTo moved the page (native touch
      // inertia, keyboard, anchor jump, find-in-page, screen reader...).
      this._state = { ...this._state, target: actualY, current: actualY, velocity: 0 };
    }

    const next = VirtualScroll.step(this._state, dt, this.lambda);
    this._state = next;
    this.el.scrollTo(0, next.current);
    this.lastWrittenY = next.current;
    this.emitter.emit("scroll", next);
  }

  /** Pure: damps `current` toward `target` by one `dt`-sized step and
   * recomputes `velocity`/`progress`. No DOM access — the whole reason
   * this is exposed statically is so tests (and the instance's own tick
   * handler) can exercise the math in isolation. */
  static step(state: ScrollState, dt: number, lambda: number): ScrollState {
    const current = damp(state.current, state.target, lambda, dt);
    const velocity = dt > 0 ? (current - state.current) / dt : state.velocity;
    return { ...state, current, velocity, progress: progressOf(current, state.limit) };
  }
}

function progressOf(current: number, limit: number): number {
  return limit > 0 ? clamp(current / limit, 0, 1) : 0;
}
