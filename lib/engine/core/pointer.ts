// lib/engine/core/pointer.ts
//
// Pointer tracking (design doc §4, core/pointer.ts): a normalized
// full-viewport position (`PointerState.x/y`, -1..1) with damped velocity,
// plus a pure exported helper gl/raycast.ts (and tests) can use without a
// `PointerTracker` instance:
//   - `viewNDC` — converts a raw client-pixel pointer position into a
//     per-view NDC position (-1..1) given that view's document-space rect
//     and the current scrollY, i.e. "where is the pointer inside THIS
//     view's canvas region".
//
// `springStep` (a semi-implicit-Euler spring integrator used by bespoke
// hover/impulse scenes, §5 "Pointer field") used to live here too, but this
// module binds `window` and registers DOM listeners (transitively importing
// core/ticker.ts's rAF + `document.visibilitychange`) — not safe for
// worker-safe callers to import just to get a pure numeric helper (H4 fix).
// It now lives in ./math (alongside `damp`, the primitive it plays the same
// role as) and is re-exported here so existing importers of
// `core/pointer.ts`'s `springStep` keep working unchanged.

import { Ticker, TickOrder } from "./ticker";
import { damp } from "./math";
import type { PointerState, RectData } from "../types";

export { springStep } from "./math";

export interface PointerTrackerOptions {
  el?: Window; // injectable for tests
  damping?: number; // lambda for velocity smoothing; default 10
}

const DEFAULT_DAMPING = 10;

interface ClientEvent {
  clientX: number;
  clientY: number;
}

export class PointerTracker {
  private readonly el: Window;
  private readonly damping: number;
  private readonly unsubscribeTick: () => void;

  private _state: PointerState = { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false };
  private targetX = 0;
  private targetY = 0;
  private destroyed = false;

  private readonly onMove = (e: Event): void => {
    const { clientX, clientY } = e as unknown as ClientEvent;
    const w = this.el.innerWidth;
    const h = this.el.innerHeight;
    if (w <= 0 || h <= 0) return;
    this.targetX = clamp01Range((clientX / w) * 2 - 1);
    this.targetY = clamp01Range(-((clientY / h) * 2 - 1));
    if (!this._state.inside) this._state = { ...this._state, inside: true };
  };

  private readonly onDown = (): void => {
    this._state = { ...this._state, down: true };
  };

  private readonly onUp = (): void => {
    this._state = { ...this._state, down: false };
  };

  private readonly onLeave = (): void => {
    this._state = { ...this._state, inside: false };
  };

  constructor(ticker: Ticker, opts: PointerTrackerOptions = {}) {
    this.el = opts.el ?? (window as unknown as Window);
    this.damping = opts.damping ?? DEFAULT_DAMPING;

    this.el.addEventListener("pointermove", this.onMove);
    this.el.addEventListener("pointerdown", this.onDown);
    this.el.addEventListener("pointerup", this.onUp);
    this.el.addEventListener("pointerleave", this.onLeave);

    this.unsubscribeTick = ticker.add((dt) => this.onTick(dt), TickOrder.INPUT);
  }

  get state(): Readonly<PointerState> {
    return this._state;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribeTick();
    this.el.removeEventListener("pointermove", this.onMove);
    this.el.removeEventListener("pointerdown", this.onDown);
    this.el.removeEventListener("pointerup", this.onUp);
    this.el.removeEventListener("pointerleave", this.onLeave);
  }

  private onTick(dt: number): void {
    const x = damp(this._state.x, this.targetX, this.damping, dt);
    const y = damp(this._state.y, this.targetY, this.damping, dt);
    const vx = dt > 0 ? (x - this._state.x) / dt : this._state.vx;
    const vy = dt > 0 ? (y - this._state.y) / dt : this._state.vy;
    this._state = { ...this._state, x, y, vx, vy };
  }
}

function clamp01Range(v: number): number {
  return Math.min(Math.max(v, -1), 1);
}

/** Converts a raw client-pixel pointer position into NDC (-1..1, +y up)
 * relative to `rect` (a view's document-space rect) given the current
 * `scrollY`. Pure — no DOM access. */
export function viewNDC(clientX: number, clientY: number, rect: RectData, scrollY: number): { x: number; y: number } {
  const viewportTop = rect.top - scrollY;
  const localX = rect.width !== 0 ? (clientX - rect.left) / rect.width : 0;
  const localY = rect.height !== 0 ? (clientY - viewportTop) / rect.height : 0;
  return { x: localX * 2 - 1, y: -(localY * 2 - 1) };
}
