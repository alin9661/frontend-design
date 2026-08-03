// test/engine/gl/timeline.test.ts
//
// gl/timeline.ts — pure keyframe sampler. Covers: sampling at fixed p
// values (including easing and out-of-range clamping), multiple tracks on
// one target, idempotency, and call() crossing detection in both
// directions (including large jumps that skip over a crossing point).

import { describe, expect, it } from "vitest";
import { Timeline } from "@/lib/engine/gl/timeline";
import type { Ease } from "@/lib/engine/types";

describe("Timeline.sample — keyframe interpolation table", () => {
  it("interpolates linearly between two keyframes with no ease", () => {
    const target = { x: 0 };
    const tl = new Timeline().add(target, "x", [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
    ]);

    tl.sample(0);
    expect(target.x).toBe(0);
    tl.sample(0.5);
    expect(target.x).toBe(5);
    tl.sample(1);
    expect(target.x).toBe(10);
  });

  it("clamps to the first/last keyframe value outside the [t0, tN] range", () => {
    const target = { x: 0 };
    const tl = new Timeline().add(target, "x", [
      { t: 0.25, v: 100 },
      { t: 0.75, v: 200 },
    ]);

    tl.sample(-1);
    expect(target.x).toBe(100);
    tl.sample(2);
    expect(target.x).toBe(200);
  });

  it("applies the segment's ease function to the local t", () => {
    const target = { x: 0 };
    const squareEase: Ease = (t) => t * t;
    const tl = new Timeline().add(target, "x", [
      { t: 0, v: 0 },
      { t: 1, v: 10, ease: squareEase },
    ]);

    tl.sample(0.5); // squareEase(0.5) = 0.25 -> 0 + (10-0)*0.25 = 2.5
    expect(target.x).toBe(2.5);
  });

  it("drives multiple independent tracks (possibly on different targets) from one sample() call", () => {
    const a = { x: 0 };
    const b = { y: 0 };
    const tl = new Timeline()
      .add(a, "x", [{ t: 0, v: 0 }, { t: 1, v: 1 }])
      .add(b, "y", [{ t: 0, v: 100 }, { t: 1, v: 0 }]);

    tl.sample(0.5);
    expect(a.x).toBe(0.5);
    expect(b.y).toBe(50);
  });

  it("is idempotent: sampling the same p twice mutates targets identically and fires no callback twice", () => {
    const target = { x: 0 };
    let calls = 0;
    const tl = new Timeline()
      .add(target, "x", [{ t: 0, v: 0 }, { t: 1, v: 1 }])
      .call(0.5, () => calls++);

    tl.sample(0); // baseline — first-ever sample never fires crossing callbacks
    tl.sample(0.6); // crosses 0.5 forward
    expect(calls).toBe(1);
    tl.sample(0.6);
    expect(calls).toBe(1); // same p again -> no re-fire
    expect(target.x).toBe(0.6);
  });

  it("a single keyframe holds its value across the whole range", () => {
    const target = { x: 0 };
    const tl = new Timeline().add(target, "x", [{ t: 0.5, v: 42 }]);
    tl.sample(0);
    expect(target.x).toBe(42);
    tl.sample(1);
    expect(target.x).toBe(42);
  });
});

describe("Timeline.call — crossing detection, both directions", () => {
  it("fires with dir=1 when the playhead crosses t moving forward", () => {
    const hits: Array<1 | -1> = [];
    const tl = new Timeline().call(0.5, (dir) => hits.push(dir));

    tl.sample(0); // establishes baseline, no fire
    tl.sample(0.4);
    expect(hits).toEqual([]);
    tl.sample(0.6); // crosses 0.5 forward
    expect(hits).toEqual([1]);
  });

  it("fires with dir=-1 when the playhead crosses t moving backward", () => {
    const hits: Array<1 | -1> = [];
    const tl = new Timeline().call(0.5, (dir) => hits.push(dir));

    tl.sample(0.6);
    tl.sample(0.6); // baseline at 0.6, past the crossing point already (no fire, per forward semantics above it already fired once)
    hits.length = 0; // isolate the backward crossing
    tl.sample(0.4); // crosses 0.5 backward
    expect(hits).toEqual([-1]);
  });

  it("fires exactly once for a big forward jump that skips straight over t (scrub-both-directions use case)", () => {
    const hits: Array<1 | -1> = [];
    const tl = new Timeline().call(0.5, (dir) => hits.push(dir));

    tl.sample(0);
    tl.sample(1); // jumps clean over 0.5 in one sample — must still fire
    expect(hits).toEqual([1]);
  });

  it("does not fire when the playhead moves without crossing t", () => {
    const hits: Array<1 | -1> = [];
    const tl = new Timeline().call(0.5, (dir) => hits.push(dir));

    tl.sample(0.1);
    tl.sample(0.2);
    tl.sample(0.3);
    expect(hits).toEqual([]);
  });

  it("supports multiple call() entries firing independently at different t", () => {
    const order: string[] = [];
    const tl = new Timeline()
      .call(0.2, (dir) => order.push(`a:${dir}`))
      .call(0.8, (dir) => order.push(`b:${dir}`));

    tl.sample(0);
    tl.sample(1); // crosses both a and b forward
    expect(order).toEqual(["a:1", "b:1"]);
  });
});
