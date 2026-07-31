// test/engine/worker/protocol.test.ts
//
// Fuzz coverage for worker/protocol.ts's packFrameState/unpackFrameState
// round-trip on top of the fixed-value cases already in
// test/engine/contracts.test.ts (0/1/3 views). This file exercises 0..4
// views with randomized-but-float32-exact scalars across many seeds, so any
// off-by-one in the SCALAR_SLOT_COUNT/FLOATS_PER_VIEW layout math shows up
// regardless of which view count happens to trigger it.

import { describe, expect, it } from "vitest";
import {
  FLOATS_PER_VIEW,
  SCALAR_SLOT_COUNT,
  packFrameState,
  unpackFrameState,
  type FrameStateScalars,
  type FrameStateView,
} from "@/lib/engine/worker/protocol";

/** Mulberry32 — small deterministic PRNG so failures are reproducible without a seed log. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quantize to float32 precision so equality checks aren't lossy-by-construction. */
function f32(n: number): number {
  return Math.fround(n);
}

function randomScalars(rand: () => number): FrameStateScalars {
  return {
    scrollCurrent: f32((rand() - 0.5) * 4000),
    scrollVelocity: f32((rand() - 0.5) * 2000),
    scrollProgress: f32(rand()),
    pointerX: f32(rand() * 2 - 1),
    pointerY: f32(rand() * 2 - 1),
    pointerVX: f32((rand() - 0.5) * 10),
    pointerVY: f32((rand() - 0.5) * 10),
  };
}

function randomViews(rand: () => number, count: number): FrameStateView[] {
  const views: FrameStateView[] = [];
  for (let i = 0; i < count; i++) {
    views.push({
      viewId: i,
      top: f32(rand() * 5000),
      left: f32(rand() * 2000 - 1000),
      width: f32(rand() * 1000 + 1),
      height: f32(rand() * 1000 + 1),
      progress: f32(rand()),
    });
  }
  return views;
}

describe("worker/protocol — packFrameState/unpackFrameState fuzz round-trip", () => {
  const SEEDS = [1, 2, 3, 4, 5, 42, 1337, 99999];

  for (const seed of SEEDS) {
    for (let viewCount = 0; viewCount <= 4; viewCount++) {
      it(`round-trips seed=${seed} views=${viewCount}`, () => {
        const rand = mulberry32(seed * 1000 + viewCount);
        const scalars = randomScalars(rand);
        const views = randomViews(rand, viewCount);

        const packed = packFrameState(scalars, views);
        expect(packed).toBeInstanceOf(Float32Array);
        expect(packed.length).toBe(SCALAR_SLOT_COUNT + viewCount * FLOATS_PER_VIEW);

        const unpacked = unpackFrameState(packed);
        expect(unpacked).toEqual({ ...scalars, views });
      });
    }
  }

  it("never throws for any view count in 0..4 given a well-formed buffer", () => {
    const rand = mulberry32(7);
    for (let viewCount = 0; viewCount <= 4; viewCount++) {
      const packed = packFrameState(randomScalars(rand), randomViews(rand, viewCount));
      expect(() => unpackFrameState(packed)).not.toThrow();
    }
  });
});
