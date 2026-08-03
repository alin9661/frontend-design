// test/engine/core/pointer.test.ts
//
// lib/engine/core/pointer.ts — normalized pointer tracking + the two pure
// helpers (viewNDC, springStep). PointerTracker is driven through a fake
// `el` (a real EventTarget with injected innerWidth/innerHeight) and the
// Ticker's manual tick() seam, per design doc §6 ("spring convergence").

import { describe, expect, it } from "vitest";
import { Ticker } from "@/lib/engine/core/ticker";
import { PointerTracker, springStep, viewNDC } from "@/lib/engine/core/pointer";

function fakeWindow(width: number, height: number): Window {
  const target = new EventTarget() as unknown as Window;
  Object.defineProperty(target, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(target, "innerHeight", { value: height, configurable: true });
  return target;
}

function pointerMove(x: number, y: number): Event {
  return Object.assign(new Event("pointermove"), { clientX: x, clientY: y });
}

describe("PointerTracker", () => {
  it("starts at the origin, not-down, not-inside", () => {
    const ticker = new Ticker();
    const tracker = new PointerTracker(ticker, { el: fakeWindow(1000, 800) });
    expect(tracker.state).toEqual({ x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false });
    tracker.destroy();
  });

  it("damps toward the normalized target position over successive ticks", () => {
    const ticker = new Ticker();
    const el = fakeWindow(1000, 800);
    const tracker = new PointerTracker(ticker, { el, damping: 10 });

    el.dispatchEvent(pointerMove(1000, 0)); // right edge, top edge -> target (1, 1)
    expect(tracker.state.inside).toBe(true);
    expect(tracker.state.x).toBe(0); // no tick yet, position hasn't moved

    ticker.tick(16);
    const afterOneTick = tracker.state.x;
    expect(afterOneTick).toBeGreaterThan(0);
    expect(afterOneTick).toBeLessThan(1);

    for (let i = 0; i < 60; i++) ticker.tick(16);
    expect(tracker.state.x).toBeCloseTo(1, 2);
    expect(tracker.state.y).toBeCloseTo(1, 2);

    tracker.destroy();
  });

  it("computes velocity as the damped position delta over dt", () => {
    const ticker = new Ticker();
    const el = fakeWindow(1000, 800);
    const tracker = new PointerTracker(ticker, { el, damping: 10 });

    el.dispatchEvent(pointerMove(1000, 400)); // target (1, 0)
    ticker.tick(16);

    expect(tracker.state.vx).toBeGreaterThan(0); // moving toward +x
    expect(tracker.state.vy).toBeCloseTo(0, 5); // y target unchanged

    tracker.destroy();
  });

  it("tracks down/up state", () => {
    const ticker = new Ticker();
    const el = fakeWindow(1000, 800);
    const tracker = new PointerTracker(ticker, { el });

    el.dispatchEvent(new Event("pointerdown"));
    expect(tracker.state.down).toBe(true);

    el.dispatchEvent(new Event("pointerup"));
    expect(tracker.state.down).toBe(false);

    tracker.destroy();
  });

  it("clears inside on pointerleave", () => {
    const ticker = new Ticker();
    const el = fakeWindow(1000, 800);
    const tracker = new PointerTracker(ticker, { el });

    el.dispatchEvent(pointerMove(500, 400));
    expect(tracker.state.inside).toBe(true);

    el.dispatchEvent(new Event("pointerleave"));
    expect(tracker.state.inside).toBe(false);

    tracker.destroy();
  });

  it("destroy() unsubscribes from the ticker and removes DOM listeners", () => {
    const ticker = new Ticker();
    const el = fakeWindow(1000, 800);
    const tracker = new PointerTracker(ticker, { el });

    tracker.destroy();

    // Further ticks/events must not throw and must not move state.
    el.dispatchEvent(pointerMove(1000, 0));
    ticker.tick(16);
    expect(tracker.state).toEqual({ x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false });
  });
});

describe("viewNDC", () => {
  it("maps the rect's center to (0, 0)", () => {
    const rect = { top: 100, left: 50, width: 200, height: 100 };
    const { x, y } = viewNDC(150, 150, rect, 0); // center: clientX=150, clientY=150
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(0, 10);
  });

  it("maps the top-left corner to (-1, 1) and bottom-right to (1, -1) (y flipped up)", () => {
    const rect = { top: 100, left: 50, width: 200, height: 100 };
    const topLeft = viewNDC(50, 100, rect, 0);
    expect(topLeft.x).toBeCloseTo(-1, 10);
    expect(topLeft.y).toBeCloseTo(1, 10);

    const bottomRight = viewNDC(250, 200, rect, 0);
    expect(bottomRight.x).toBeCloseTo(1, 10);
    expect(bottomRight.y).toBeCloseTo(-1, 10);
  });

  it("accounts for scrollY: a rect's document-space top is offset by scroll before projecting", () => {
    // rect.top=1100 (document-space); scrolled to 1000 -> viewport-relative top=100.
    const rect = { top: 1100, left: 0, width: 200, height: 100 };
    const { y } = viewNDC(0, 100, rect, 1000); // clientY=100 lands exactly on the (scrolled) top edge
    expect(y).toBeCloseTo(1, 10);
  });
});

describe("springStep", () => {
  it("converges to the target position with zero residual velocity over many steps", () => {
    let pos = 0;
    let vel = 0;
    const target = 10;
    const stiffness = 170;
    const damping = 26; // ~critically damped for stiffness=170
    const dt = 1 / 60;

    for (let i = 0; i < 300; i++) {
      ({ pos, vel } = springStep(pos, vel, target, stiffness, damping, dt));
    }

    expect(pos).toBeCloseTo(target, 2);
    expect(vel).toBeCloseTo(0, 2);
  });

  it("moves toward the target on the very first step from rest", () => {
    const { pos, vel } = springStep(0, 0, 10, 170, 26, 1 / 60);
    expect(pos).toBeGreaterThan(0);
    expect(vel).toBeGreaterThan(0);
  });

  it("is symmetric for negative targets", () => {
    const positive = springStep(0, 0, 10, 170, 26, 1 / 60);
    const negative = springStep(0, 0, -10, 170, 26, 1 / 60);
    expect(negative.pos).toBeCloseTo(-positive.pos, 10);
    expect(negative.vel).toBeCloseTo(-positive.vel, 10);
  });

  it("dt=0 leaves position and velocity unchanged", () => {
    const { pos, vel } = springStep(5, 2, 10, 170, 26, 0);
    expect(pos).toBe(5);
    expect(vel).toBe(2);
  });
});
