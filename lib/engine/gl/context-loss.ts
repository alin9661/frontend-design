// lib/engine/gl/context-loss.ts
//
// Centralized `webglcontextlost`/`webglcontextrestored` wiring (design doc
// §4 gl/context-loss.ts): stop ticking and notify the host on loss (worker
// posts CONTEXT_LOST up to main); on restore, the caller re-runs every
// view's `init` — that's `Stage.reinit()`, kept in stage.ts since it's the
// one holding the ViewContext data, not duplicated here. This file owns only
// the event plumbing, against a minimal `addEventListener`/`removeEventListener`
// seam so it's testable against a plain EventTarget (or a real
// HTMLCanvasElement/OffscreenCanvas) without a live WebGL context.

export interface ContextLossTarget {
  addEventListener(type: string, listener: EventListener, options?: unknown): void;
  removeEventListener(type: string, listener: EventListener, options?: unknown): void;
}

export interface ContextLossOptions {
  onLost?: () => void;
  onRestored?: () => void;
}

/**
 * Wires `webglcontextlost`/`webglcontextrestored` on a canvas-like target.
 * `webglcontextlost` events are cancelable and MUST have `preventDefault()`
 * called for the browser to fire `webglcontextrestored` at all — this
 * handler always does that before invoking `onLost`.
 */
export class ContextLossHandler {
  private target: ContextLossTarget;
  private opts: ContextLossOptions;
  private lostHandler = (e: Event): void => {
    e.preventDefault?.();
    this.opts.onLost?.();
  };
  private restoredHandler = (): void => {
    this.opts.onRestored?.();
  };

  constructor(target: ContextLossTarget, opts: ContextLossOptions = {}) {
    this.target = target;
    this.opts = opts;
    this.target.addEventListener("webglcontextlost", this.lostHandler);
    this.target.addEventListener("webglcontextrestored", this.restoredHandler);
  }

  /** For tests / manual simulation — same code path a real browser event takes. */
  simulateLost(): void {
    this.lostHandler(new Event("webglcontextlost", { cancelable: true }));
  }

  simulateRestored(): void {
    this.restoredHandler();
  }

  dispose(): void {
    this.target.removeEventListener("webglcontextlost", this.lostHandler);
    this.target.removeEventListener("webglcontextrestored", this.restoredHandler);
  }
}
