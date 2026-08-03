// lib/engine/gl/timeline.ts
//
// Pure keyframe sampler — replaces gsap (unreliable in workers). Worker-safe:
// no DOM, no globals, no scheduling of its own. A scene module owns a
// Timeline, feeds it `sample(p)` from `onProgress(p)` (see SceneModule in
// ../types), and reads the mutated target objects during `update()`.
//
// See docs/deep-wave-engine-design.md §4 gl/timeline.ts for the exact public
// signature this file must match.

import type { Ease, TrackKeyframe } from "../types";

const linear: Ease = (t) => t;

interface Track {
  target: Record<string, number>;
  prop: string;
  /** Sorted ascending by `t` once, at `add()` time — sample() never sorts. */
  keys: TrackKeyframe[];
}

interface CallEntry {
  t: number;
  fn: (dir: 1 | -1) => void;
}

/** Piecewise-linear-with-easing interpolation across a sorted keyframe list. */
function sampleKeys(keys: TrackKeyframe[], p: number): number {
  if (keys.length === 0) return 0;
  const first = keys[0]!;
  if (keys.length === 1 || p <= first.t) return first.v;

  const last = keys[keys.length - 1]!;
  if (p >= last.t) return last.v;

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (p >= a.t && p <= b.t) {
      const span = b.t - a.t;
      const localT = span === 0 ? 1 : (p - a.t) / span;
      const eased = (b.ease ?? linear)(localT);
      return a.v + (b.v - a.v) * eased;
    }
  }
  // Unreachable given the bounds checks above, but keeps the function total.
  return last.v;
}

/**
 * Pure keyframe sampler. `add()` registers a property track on a plain
 * target object (mutated in place by `sample()`); `call()` registers a
 * playhead-crossing callback fired with the direction of travel; `sample()`
 * evaluates every track and fires any crossed `call()` entries. Idempotent:
 * calling `sample()` twice with the same `p` mutates targets identically and
 * fires no callbacks the second time.
 */
export class Timeline {
  private tracks: Track[] = [];
  private calls: CallEntry[] = [];
  private lastP: number | null = null;

  add(target: Record<string, number>, prop: string, keys: TrackKeyframe[]): this {
    const sorted = [...keys].sort((a, b) => a.t - b.t);
    this.tracks.push({ target, prop, keys: sorted });
    return this;
  }

  call(t: number, fn: (dir: 1 | -1) => void): this {
    this.calls.push({ t, fn });
    return this;
  }

  sample(p: number): void {
    for (const track of this.tracks) {
      track.target[track.prop] = sampleKeys(track.keys, p);
    }

    if (this.lastP !== null && this.lastP !== p) {
      const dir: 1 | -1 = p > this.lastP ? 1 : -1;
      for (const c of this.calls) {
        const crossedForward = dir === 1 && this.lastP < c.t && p >= c.t;
        const crossedBackward = dir === -1 && this.lastP > c.t && p <= c.t;
        if (crossedForward || crossedBackward) c.fn(dir);
      }
    }

    this.lastP = p;
  }
}
