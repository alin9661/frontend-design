// lib/engine/worker/frame-shared.ts
//
// Shared helpers between worker/host.ts's MainThreadHost and
// worker/render.worker.ts's RAF tick — both RenderHost implementations
// independently duplicated this exact bookkeeping (unpacking FRAME_STATE
// into the ScrollState/PointerState shape Stage.setFrame() consumes,
// summing SceneModule.getStats() across every registered view, and the
// STATS-interval accumulator) before this file existed. Extracted here so
// there is exactly one copy each (design review item E5) and both hosts stay
// identical by construction instead of by discipline.

import type { PointerState, ScrollState, SceneModule } from "../types";
import type { FrameState } from "./protocol";

/**
 * Both RenderHost implementations' scroll/pointer state before the very
 * first real FRAME_STATE arrives (or immediately after `init()`, before any
 * frame has been applied). Used ONLY as that initial default — a later
 * `resize()` must NOT fall back to these (design review item F4: a resize
 * used to snap scroll/pointer back to these DEFAULTS instead of retaining
 * the last-known real frame state, causing a visible jump). See
 * `MainThreadHost`/render.worker.ts's own retained `lastScroll`/
 * `lastPointer` state for how that's avoided.
 */
export const DEFAULT_SCROLL: ScrollState = { target: 0, current: 0, velocity: 0, progress: 0, limit: 0 };
export const DEFAULT_POINTER: PointerState = { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false };

/** How often (ms) both RenderHost implementations post a STATS message. */
export const STATS_INTERVAL_MS = 1000;

/**
 * Per-tick `dt` is clamped to this many seconds (~15.6fps floor, i.e. 64ms)
 * before being handed to `Stage.update()`/scene physics. Without a clamp, a
 * long stall — a backgrounded tab resuming, a slow GC pause, a devtools
 * breakpoint — would feed a huge `dt` into spring integrators and
 * `Timeline.sample()`-driven scenes and produce a visible jump/teleport on
 * the next frame instead of just a dropped frame. Both hosts clamp
 * identically so a scene behaves the same regardless of which RenderHost is
 * driving it.
 */
export const MAX_DT_S = 0.064;

/**
 * Pure: converts an unpacked FRAME_STATE into the ScrollState/PointerState
 * shape `Stage.setFrame()` consumes. FRAME_STATE only carries
 * scrollCurrent/velocity/progress — VirtualScroll's `target`/`limit`
 * bookkeeping is main-thread-only and not needed by Stage — so `target`
 * mirrors `current` and `limit` is always 0. `pointerDown`/`pointerInside`
 * come from the real PointerTracker state via `protocol.ts`'s `pointerFlags`
 * slot (design review item A) instead of the previously hardcoded
 * `down: false, inside: true`.
 */
export function frameStateToScrollPointer(state: FrameState): { scroll: ScrollState; pointer: PointerState } {
  return {
    scroll: {
      target: state.scrollCurrent,
      current: state.scrollCurrent,
      velocity: state.scrollVelocity,
      progress: state.scrollProgress,
      limit: 0,
    },
    pointer: {
      x: state.pointerX,
      y: state.pointerY,
      vx: state.pointerVX,
      vy: state.pointerVY,
      down: state.pointerDown,
      inside: state.pointerInside,
    },
  };
}

/**
 * Sums every registered view's optional `SceneModule.getStats()` (splats +
 * the slowest sortMs among them) for the `?debug` HUD's STATS channel
 * (design doc §6). Only splat-lounge implements this today — surfacing its
 * SplatMesh's real splat count/sortMs instead of a hardcoded 0/0.
 */
export function collectSceneStats(modules: Iterable<SceneModule>): { splats: number; sortMs: number } {
  let splats = 0;
  let sortMs = 0;
  for (const module of modules) {
    const s = module.getStats?.();
    if (!s) continue;
    splats += s.splats ?? 0;
    sortMs = Math.max(sortMs, s.sortMs ?? 0);
  }
  return { splats, sortMs };
}

/**
 * Interval accumulator for the STATS message both RenderHost implementations
 * post ~once/sec: `record()` accumulates one frame's render time and returns
 * the averaged ms + resets once `STATS_INTERVAL_MS` has elapsed, or `null`
 * if it isn't time to post yet.
 */
export class StatsReporter {
  private accumMs = 0;
  private accumFrames = 0;
  private lastPostTime: number;

  constructor(startTime = 0) {
    this.lastPostTime = startTime;
  }

  /** Records one frame's render time; returns the averaged ms since the
   * last post once `STATS_INTERVAL_MS` has elapsed (and resets the
   * accumulator), else `null` (too soon to post). */
  record(now: number, renderMs: number): number | null {
    this.accumMs += renderMs;
    this.accumFrames += 1;
    if (now - this.lastPostTime < STATS_INTERVAL_MS) return null;

    const avg = this.accumFrames > 0 ? this.accumMs / this.accumFrames : 0;
    this.accumMs = 0;
    this.accumFrames = 0;
    this.lastPostTime = now;
    return avg;
  }

  /** Resets the accumulator and re-bases the interval clock at `now` —
   * called when ticking (re)starts (e.g. render.worker.ts's
   * `startTicking()`) so a stale `lastPostTime` from a previous INIT/DISPOSE
   * cycle in the same worker/module instance can't cause the very next
   * frame to post STATS immediately. */
  reset(now = 0): void {
    this.accumMs = 0;
    this.accumFrames = 0;
    this.lastPostTime = now;
  }
}
