import { describe, expect, it } from "vitest";
import {
  createDragInspector,
  integrateAxis,
  wrapAngle,
  DRAG_INSPECT_DEFAULTS,
  DRAG_INSPECT_TOUCH_ACTION,
  DRAG_INSPECT_TOUCH_ACTION_IDLE,
  type DragInspector,
} from "@/lib/visuals/drag-inspect";

const FRAME = 1 / 60;

/** Drives a horizontal flick that ends with a measurable release velocity. */
function flick(inspector: DragInspector): void {
  inspector.onPointerDown(0, 0);
  inspector.onPointerMove(20, 0); // crosses the lock threshold
  inspector.update(FRAME);
  inspector.onPointerMove(50, 0); // 30px of real rotation
  inspector.onPointerUp();
}

describe("axis lock", () => {
  it("never locks horizontal or asks for preventDefault on a mostly-vertical gesture", () => {
    const inspector = createDragInspector();
    expect(inspector.onPointerDown(100, 100)).toBe(false);

    // Downward swipe with real-world sideways jitter.
    const path: Array<[number, number]> = [
      [101, 104],
      [103, 118],
      [99, 150],
      [104, 220],
      [98, 320],
    ];
    for (const [x, y] of path) {
      expect(inspector.onPointerMove(x, y)).toBe(false);
      expect(inspector.state.axis).not.toBe("horizontal");
      expect(inspector.state.shouldPreventDefault).toBe(false);
    }

    expect(inspector.state.axis).toBe("vertical");
    expect(inspector.state.dragging).toBe(false);
    expect(inspector.state.yaw).toBe(0);
    expect(inspector.state.pitch).toBe(0);
  });

  it("keeps a vertical lock latched for the rest of the gesture", () => {
    const inspector = createDragInspector();
    inspector.onPointerDown(100, 100);
    inspector.onPointerMove(100, 140); // vertical wins
    expect(inspector.state.axis).toBe("vertical");

    // A big sideways move afterwards must not steal the scroll back.
    expect(inspector.onPointerMove(600, 140)).toBe(false);
    expect(inspector.state.axis).toBe("vertical");
    expect(inspector.state.shouldPreventDefault).toBe(false);
    expect(inspector.state.yaw).toBe(0);
  });

  it("locks horizontal and asks for preventDefault on a mostly-horizontal gesture", () => {
    const inspector = createDragInspector();
    inspector.onPointerDown(100, 100);

    expect(inspector.onPointerMove(120, 102)).toBe(true);
    expect(inspector.state.axis).toBe("horizontal");
    expect(inspector.state.shouldPreventDefault).toBe(true);
    expect(inspector.state.dragging).toBe(true);

    expect(inspector.onPointerMove(160, 102)).toBe(true);
    expect(inspector.state.yaw).toBeCloseTo(40 * DRAG_INSPECT_DEFAULTS.sensitivity, 10);
  });

  it("consumes and rotates nothing while the gesture is still under the threshold", () => {
    const inspector = createDragInspector({ axisLockThreshold: 8 });
    inspector.onPointerDown(100, 100);

    expect(inspector.onPointerMove(104, 103)).toBe(false);
    expect(inspector.onPointerMove(107, 99)).toBe(false);
    expect(inspector.state.axis).toBe("none");
    expect(inspector.state.shouldPreventDefault).toBe(false);
    expect(inspector.state.yaw).toBe(0);
    expect(inspector.state.pitch).toBe(0);
    // A pointer is down on the can even though nothing has been decided.
    expect(inspector.state.dragging).toBe(true);
  });

  it("gives an exact diagonal tie to the page, not to the inspector", () => {
    const inspector = createDragInspector({ axisLockThreshold: 8 });
    inspector.onPointerDown(0, 0);
    expect(inspector.onPointerMove(10, 10)).toBe(false);
    expect(inspector.state.axis).toBe("vertical");
  });

  it("does not jump the pose by the threshold distance when it locks", () => {
    const inspector = createDragInspector({ axisLockThreshold: 30, sensitivity: 0.01 });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(40, 0); // locks here, 40px from the origin
    expect(inspector.state.yaw).toBe(0);

    inspector.onPointerMove(60, 0); // only the 20px past the lock point counts
    expect(inspector.state.yaw).toBeCloseTo(0.2, 10);
  });

  it("honours the default threshold when the option is omitted", () => {
    const withDefaults = createDragInspector();
    withDefaults.onPointerDown(0, 0);
    expect(withDefaults.onPointerMove(DRAG_INSPECT_DEFAULTS.axisLockThreshold - 1, 0)).toBe(false);
    expect(withDefaults.state.axis).toBe("none");
    expect(withDefaults.onPointerMove(DRAG_INSPECT_DEFAULTS.axisLockThreshold, 0)).toBe(true);
    expect(withDefaults.state.axis).toBe("horizontal");

    const withOption = createDragInspector({ axisLockThreshold: 40 });
    withOption.onPointerDown(0, 0);
    expect(withOption.onPointerMove(20, 0)).toBe(false);
    expect(withOption.state.axis).toBe("none");
    expect(withOption.onPointerMove(41, 0)).toBe(true);
    expect(withOption.state.axis).toBe("horizontal");
  });

  it("ignores moves and releases that arrive without a pointerdown", () => {
    const inspector = createDragInspector();
    expect(inspector.onPointerMove(500, 0)).toBe(false);
    inspector.onPointerUp();
    expect(inspector.state.yaw).toBe(0);
    expect(inspector.state.axis).toBe("none");
    expect(inspector.state.dragging).toBe(false);
  });

  it("pins the touch-action policy the integrator must apply to the element", () => {
    // `pan-y` is what makes vertical scrolling native (never stolen) while
    // still delivering horizontal gestures to the inspector.
    const tokens = DRAG_INSPECT_TOUCH_ACTION.split(/\s+/);
    expect(tokens).toContain("pan-y");
    // ...and `pinch-zoom` is what keeps the visitor's ability to zoom. A bare
    // `pan-y` revokes it for the element AND its whole subtree (WCAG 1.4.4),
    // which is why the two must ship together.
    expect(tokens).toContain("pinch-zoom");
    // `none` would make the element a scroll trap; `auto` would fight the
    // inspector for horizontal gestures.
    expect(tokens).not.toContain("none");
    expect(tokens).not.toContain("auto");
  });

  it("offers an idle value that gives every gesture back when inspection is not live", () => {
    // Rule 2 of the policy: an element that is not currently arbitrating a
    // drag must not keep paying for one (the platform's edge-swipe gestures
    // are the ones that hurt).
    expect(DRAG_INSPECT_TOUCH_ACTION_IDLE).toBe("auto");
    expect(DRAG_INSPECT_TOUCH_ACTION_IDLE).not.toBe(DRAG_INSPECT_TOUCH_ACTION);
  });
});

describe("rotation", () => {
  it("drives pitch from vertical travel once the gesture is ours", () => {
    const inspector = createDragInspector({ sensitivity: 0.01 });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(20, 0); // horizontal lock
    inspector.onPointerMove(20, 10);
    expect(inspector.state.pitch).toBeCloseTo(0.1, 10);
    expect(inspector.state.yaw).toBe(0);
  });

  it("clamps pitch at both ends while yaw keeps wrapping", () => {
    const inspector = createDragInspector({ sensitivity: 0.01, minPitch: -0.4, maxPitch: 0.4 });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(20, 0);

    inspector.onPointerMove(20, 1000);
    expect(inspector.state.pitch).toBeCloseTo(0.4, 10);

    inspector.onPointerMove(20, -1000);
    expect(inspector.state.pitch).toBeCloseTo(-0.4, 10);
  });

  it("wraps yaw into (-PI, PI] instead of clamping it", () => {
    const inspector = createDragInspector({ sensitivity: 0.01 });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(20, 0);

    inspector.onPointerMove(420, 0); // +4.0 rad
    expect(inspector.state.yaw).toBeCloseTo(4 - Math.PI * 2, 10);
    expect(inspector.state.yaw).toBeGreaterThan(-Math.PI);
    expect(inspector.state.yaw).toBeLessThanOrEqual(Math.PI);

    inspector.onPointerMove(820, 0); // +4.0 rad again, total 8.0
    expect(inspector.state.yaw).toBeCloseTo(8 - Math.PI * 2, 10);
    expect(inspector.state.yaw).toBeLessThanOrEqual(Math.PI);
  });

  it("wrapAngle maps the boundaries onto a half-open range", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5, 12);
    expect(wrapAngle(Math.PI * 5)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI * 2.25)).toBeCloseTo(-Math.PI * 0.25, 12);
  });
});

describe("inertia", () => {
  it("carries a flick and decays it to rest", () => {
    const inspector = createDragInspector({ damping: 3, returnSpring: 0 });
    flick(inspector);

    const released = inspector.state;
    expect(released.dragging).toBe(false);
    expect(released.yawVelocity).toBeGreaterThan(0);
    expect(released.settled).toBe(false);

    const yawAtRelease = released.yaw;
    const velocityAtRelease = released.yawVelocity;

    inspector.update(FRAME);
    const afterOneFrame = inspector.state.yaw;
    expect(afterOneFrame).toBeGreaterThan(yawAtRelease);

    inspector.update(FRAME);
    // Decaying, not linear: the second frame travels less than the first.
    expect(inspector.state.yaw - afterOneFrame).toBeLessThan(afterOneFrame - yawAtRelease);

    for (let i = 0; i < 600; i += 1) inspector.update(FRAME);
    // Closed form: total post-release travel is v0 / damping.
    expect(inspector.state.yaw).toBeCloseTo(yawAtRelease + velocityAtRelease / 3, 6);
    expect(inspector.state.yawVelocity).toBeCloseTo(0, 6);
    expect(inspector.state.settled).toBe(true);
  });

  it("keeps a release that lands between frames, and stays still when it has never ticked", () => {
    const withTick = createDragInspector({ damping: 3 });
    withTick.onPointerDown(0, 0);
    withTick.onPointerMove(20, 0);
    withTick.update(FRAME); // establishes a frame duration
    withTick.onPointerMove(60, 0);
    withTick.onPointerUp(); // no update() between the move and the release
    expect(withTick.state.yawVelocity).toBeGreaterThan(0);

    const neverTicked = createDragInspector({ damping: 3 });
    neverTicked.onPointerDown(0, 0);
    neverTicked.onPointerMove(20, 0);
    neverTicked.onPointerMove(60, 0);
    neverTicked.onPointerUp();
    expect(neverTicked.state.yawVelocity).toBe(0);
    expect(neverTicked.state.settled).toBe(true);
  });

  it("kills stored velocity when pitch is pinned against its clamp", () => {
    const inspector = createDragInspector({ damping: 1, minPitch: -0.2, maxPitch: 0.2 });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(20, 0);
    inspector.update(FRAME);
    inspector.onPointerMove(20, 40); // drags well past the clamp
    inspector.update(FRAME);
    expect(inspector.state.pitchVelocity).toBeGreaterThan(0);

    inspector.onPointerUp();
    inspector.update(FRAME);
    expect(inspector.state.pitch).toBeCloseTo(0.2, 10);
    expect(inspector.state.pitchVelocity).toBe(0);
  });

  it("grabbing the can again kills the in-flight inertia", () => {
    const inspector = createDragInspector({ damping: 2 });
    flick(inspector);
    expect(inspector.state.yawVelocity).toBeGreaterThan(0);

    inspector.onPointerDown(200, 200);
    expect(inspector.state.yawVelocity).toBe(0);

    const held = inspector.state.yaw;
    inspector.update(FRAME);
    expect(inspector.state.yaw).toBe(held);
  });

  it("treats a non-positive or non-finite dt as a no-op", () => {
    const inspector = createDragInspector({ damping: 3 });
    flick(inspector);
    const { yaw, yawVelocity } = inspector.state;

    inspector.update(0);
    inspector.update(-0.5);
    inspector.update(Number.NaN);
    expect(inspector.state.yaw).toBe(yaw);
    expect(inspector.state.yawVelocity).toBe(yawVelocity);
  });
});

describe("frame-rate independence", () => {
  function settleTwoWays(options: Parameters<typeof createDragInspector>[0]): {
    big: DragInspector;
    small: DragInspector;
  } {
    const big = createDragInspector(options);
    const small = createDragInspector(options);
    flick(big);
    flick(small);
    // Identical starting conditions, then the same 100ms spent two ways.
    expect(big.state.yaw).toBe(small.state.yaw);
    expect(big.state.yawVelocity).toBe(small.state.yawVelocity);

    big.update(0.1);
    for (let i = 0; i < 10; i += 1) small.update(0.01);
    return { big, small };
  }

  it("lands one 100ms step and ten 10ms steps in the same place (pure inertia)", () => {
    const { big, small } = settleTwoWays({ damping: 3.5, returnSpring: 0 });
    expect(big.state.yaw).toBeCloseTo(small.state.yaw, 9);
    expect(big.state.yawVelocity).toBeCloseTo(small.state.yawVelocity, 9);
    expect(big.state.pitch).toBeCloseTo(small.state.pitch, 9);
  });

  it("lands one 100ms step and ten 10ms steps in the same place (inertia + spring-back)", () => {
    const { big, small } = settleTwoWays({ damping: 3.5, returnSpring: 6 });
    expect(big.state.yaw).toBeCloseTo(small.state.yaw, 9);
    expect(big.state.yawVelocity).toBeCloseTo(small.state.yawVelocity, 9);
  });

  it("stays exact when the spring rate equals the damping rate (repeated root)", () => {
    const { big, small } = settleTwoWays({ damping: 4, returnSpring: 4 });
    expect(big.state.yaw).toBeCloseTo(small.state.yaw, 9);
    expect(big.state.yawVelocity).toBeCloseTo(small.state.yawVelocity, 9);
  });

  it("integrateAxis matches the analytic damped-inertia solution", () => {
    const u0 = 0.25;
    const v0 = 4;
    const lambda = 3;
    const dt = 0.37;
    const { u, v } = integrateAxis(u0, v0, lambda, 0, dt);
    expect(u).toBeCloseTo(u0 + (v0 * (1 - Math.exp(-lambda * dt))) / lambda, 12);
    expect(v).toBeCloseTo(v0 * Math.exp(-lambda * dt), 12);

    // Semigroup: the exact flow composes, which is what buys frame-rate
    // independence in `update`.
    const half = integrateAxis(u0, v0, lambda, 2, dt / 2);
    const composed = integrateAxis(half.u, half.v, lambda, 2, dt / 2);
    const whole = integrateAxis(u0, v0, lambda, 2, dt);
    expect(composed.u).toBeCloseTo(whole.u, 12);
    expect(composed.v).toBeCloseTo(whole.v, 12);
  });
});

describe("spring-back", () => {
  it("returns to the rest pose when a return spring is configured", () => {
    const inspector = createDragInspector({ damping: 5, returnSpring: 6, restPitch: 0.1 });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(20, 0);
    inspector.onPointerMove(120, 40);
    inspector.onPointerUp();
    expect(Math.abs(inspector.state.yaw)).toBeGreaterThan(0.5);

    for (let i = 0; i < 600; i += 1) inspector.update(FRAME);
    expect(inspector.state.yaw).toBeCloseTo(0, 5);
    expect(inspector.state.pitch).toBeCloseTo(0.1, 5);
    expect(inspector.state.settled).toBe(true);
  });

  it("parks the can wherever inertia left it when the spring is disabled", () => {
    const inspector = createDragInspector({ damping: 5, returnSpring: 0 });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(20, 0);
    inspector.onPointerMove(120, 40);
    inspector.onPointerUp();

    for (let i = 0; i < 600; i += 1) inspector.update(FRAME);
    expect(inspector.state.yaw).toBeGreaterThan(0.5);
    expect(inspector.state.pitch).toBeGreaterThan(0.1);
    expect(inspector.state.settled).toBe(true);
  });

  it("springs back along the shortest angular path across the wrap seam", () => {
    const inspector = createDragInspector({
      restYaw: -3,
      damping: 5,
      returnSpring: 5,
      sensitivity: 0.01,
    });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(20, 0);
    inspector.onPointerMove(620, 0); // +6.0 rad from rest => yaw ~= 3.0
    inspector.onPointerCancel(); // stop dead, isolate the spring
    expect(inspector.state.yaw).toBeCloseTo(3, 6);

    inspector.update(0.1);
    // The short way home is forward across +PI, not backward through 0.
    expect(inspector.state.yaw).toBeGreaterThan(3);

    for (let i = 0; i < 600; i += 1) inspector.update(FRAME);
    expect(inspector.state.yaw).toBeCloseTo(-3, 5);
  });
});

describe("reduced motion", () => {
  it("follows the finger exactly and stops dead on release", () => {
    const inspector = createDragInspector({ reducedMotion: true, damping: 3, returnSpring: 6 });
    inspector.onPointerDown(0, 0);
    expect(inspector.onPointerMove(20, 0)).toBe(true);
    inspector.update(FRAME);
    inspector.onPointerMove(50, 10);

    // Exactly the finger: 30px yaw, 10px pitch past the lock point.
    expect(inspector.state.yaw).toBeCloseTo(0.3, 10);
    expect(inspector.state.pitch).toBeCloseTo(0.1, 10);

    inspector.onPointerUp();
    expect(inspector.state.yawVelocity).toBe(0);
    expect(inspector.state.pitchVelocity).toBe(0);
    expect(inspector.state.settled).toBe(true);

    for (let i = 0; i < 60; i += 1) inspector.update(FRAME);
    // No inertia AND no spring-back, despite both being configured.
    expect(inspector.state.yaw).toBeCloseTo(0.3, 10);
    expect(inspector.state.pitch).toBeCloseTo(0.1, 10);
  });

  it("keeps moving after release when reduced motion is off", () => {
    const inspector = createDragInspector({ reducedMotion: false, damping: 3, returnSpring: 6 });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(20, 0);
    inspector.update(FRAME);
    inspector.onPointerMove(50, 10);
    inspector.onPointerUp();

    const yawAtRelease = inspector.state.yaw;
    expect(inspector.state.yawVelocity).toBeGreaterThan(0);
    inspector.update(FRAME);
    expect(inspector.state.yaw).not.toBe(yawAtRelease);

    for (let i = 0; i < 600; i += 1) inspector.update(FRAME);
    expect(inspector.state.yaw).toBeCloseTo(0, 5);
  });

  it("still hands vertical gestures to the page under reduced motion", () => {
    const inspector = createDragInspector({ reducedMotion: true });
    inspector.onPointerDown(0, 0);
    expect(inspector.onPointerMove(2, 30)).toBe(false);
    expect(inspector.state.axis).toBe("vertical");
    expect(inspector.state.shouldPreventDefault).toBe(false);
  });
});

describe("gesture teardown", () => {
  it("onPointerCancel stops the can dead and releases the gesture", () => {
    const inspector = createDragInspector({ damping: 2 });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(20, 0);
    inspector.update(FRAME);
    inspector.onPointerMove(60, 0);
    inspector.update(FRAME);
    expect(inspector.state.yawVelocity).toBeGreaterThan(0);

    inspector.onPointerCancel();
    const parked = inspector.state.yaw;
    expect(inspector.state.axis).toBe("none");
    expect(inspector.state.dragging).toBe(false);
    expect(inspector.state.yawVelocity).toBe(0);

    for (let i = 0; i < 10; i += 1) inspector.update(FRAME);
    expect(inspector.state.yaw).toBe(parked);
  });

  it("reset restores the rest pose and clears the gesture", () => {
    const inspector = createDragInspector({ restYaw: 0.5, restPitch: 0.2, damping: 2 });
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(20, 0);
    inspector.onPointerMove(200, 60);
    expect(inspector.state.yaw).not.toBeCloseTo(0.5, 6);

    inspector.reset();
    expect(inspector.state.yaw).toBeCloseTo(0.5, 10);
    expect(inspector.state.pitch).toBeCloseTo(0.2, 10);
    expect(inspector.state.axis).toBe("none");
    expect(inspector.state.dragging).toBe(false);
    expect(inspector.state.yawVelocity).toBe(0);
    expect(inspector.state.settled).toBe(true);
  });

  it("clamps an out-of-range rest pitch instead of starting outside the limits", () => {
    const inspector = createDragInspector({ restPitch: 9, minPitch: -0.3, maxPitch: 0.3 });
    expect(inspector.state.pitch).toBeCloseTo(0.3, 10);
  });

  it("hands out a fresh state snapshot after every mutation", () => {
    const inspector = createDragInspector();
    const before = inspector.state;
    inspector.onPointerDown(0, 0);
    inspector.onPointerMove(40, 0); // locks
    inspector.onPointerMove(80, 0); // rotates
    expect(before.yaw).toBe(0);
    expect(before.dragging).toBe(false);
    expect(inspector.state.yaw).toBeGreaterThan(0);
    expect(inspector.state.dragging).toBe(true);
  });
});
