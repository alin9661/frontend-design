// test/engine/core/scroll.test.ts
//
// lib/engine/core/scroll.ts — HYBRID VirtualScroll. `window.scrollY` stays
// real/canonical; only wheel is intercepted. Covers: the pure `step()` step
// math, wheel accumulation + clamping, external-divergence resync (native
// touch/keyboard/anchor scroll), and reducedMotion's "listener not
// installed at all" branch (design doc §4 + §6, both required).
//
// `el` is always an injected fake window — never the real jsdom `window` —
// so scrollY can be mutated directly to simulate both our own writes and
// externally-caused scroll changes.

import { describe, expect, it, vi } from "vitest";
import { Ticker } from "@/lib/engine/core/ticker";
import { VirtualScroll } from "@/lib/engine/core/scroll";
import { damp, clamp } from "@/lib/engine/core/math";
import type { ScrollState } from "@/lib/engine/types";

class FakeWindow extends EventTarget {
  scrollY = 0;
  scrollTo = vi.fn((_x: number, y: number) => {
    this.scrollY = y;
  });
}

function wheelEvent(deltaY: number): WheelEvent {
  return new WheelEvent("wheel", { deltaY, deltaMode: 0, cancelable: true });
}

describe("VirtualScroll.step — pure damping math", () => {
  it("matches damp(current, target, lambda, dt) exactly for current/velocity", () => {
    const state: ScrollState = { target: 1000, current: 0, velocity: 0, progress: 0, limit: 2000 };
    const dt = 1 / 60;
    const lambda = 8;

    const next = VirtualScroll.step(state, dt, lambda);

    const expectedCurrent = damp(0, 1000, lambda, dt);
    expect(next.current).toBeCloseTo(expectedCurrent, 10);
    expect(next.velocity).toBeCloseTo((expectedCurrent - 0) / dt, 10);
  });

  it("computes progress as current/limit, clamped to [0,1]", () => {
    const state: ScrollState = { target: 500, current: 500, velocity: 0, progress: 0, limit: 1000 };
    const next = VirtualScroll.step(state, 1 / 60, 8);
    expect(next.progress).toBeCloseTo(0.5, 5);
  });

  it("progress is 0 when limit is 0 (no divide-by-zero)", () => {
    const state: ScrollState = { target: 0, current: 0, velocity: 0, progress: 0, limit: 0 };
    const next = VirtualScroll.step(state, 1 / 60, 8);
    expect(next.progress).toBe(0);
  });

  it("does not mutate the input state (pure)", () => {
    const state: ScrollState = { target: 100, current: 0, velocity: 0, progress: 0, limit: 1000 };
    const snapshot = { ...state };
    VirtualScroll.step(state, 1 / 60, 8);
    expect(state).toEqual(snapshot);
  });

  it("leaves velocity as the prior state's velocity when dt=0", () => {
    const state: ScrollState = { target: 100, current: 0, velocity: 5, progress: 0, limit: 1000 };
    const next = VirtualScroll.step(state, 0, 8);
    expect(next.current).toBe(0); // damp with dt=0 is a no-op
    expect(next.velocity).toBe(5);
  });
});

describe("VirtualScroll — wheel accumulation", () => {
  it("accumulates normalized wheel pixelY into target, clamped to [0, limit]", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(1000);

    el.dispatchEvent(wheelEvent(300));

    expect(scroll.state.target).toBe(300);

    scroll.destroy();
  });

  it("clamps target at the resize()-set limit", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(500);

    el.dispatchEvent(wheelEvent(10000));

    expect(scroll.state.target).toBe(500);
    scroll.destroy();
  });

  it("clamps target at 0 for upward wheel past the top", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(1000);

    el.dispatchEvent(wheelEvent(-500));

    expect(scroll.state.target).toBe(0);
    scroll.destroy();
  });

  it("applies wheelMultiplier", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window, wheelMultiplier: 2 });
    scroll.resize(1000);

    el.dispatchEvent(wheelEvent(100));

    expect(scroll.state.target).toBe(200);
    scroll.destroy();
  });

  it("preventDefault()s the wheel event (non-passive interception)", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(1000);

    const evt = wheelEvent(100);
    const spy = vi.spyOn(evt, "preventDefault");
    el.dispatchEvent(evt);

    expect(spy).toHaveBeenCalled();
    scroll.destroy();
  });

  it("ticking damps current toward the wheel-accumulated target and writes it via el.scrollTo", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window, lambda: 8 });
    scroll.resize(1000);

    el.dispatchEvent(wheelEvent(500));
    ticker.tick(16);

    expect(scroll.state.current).toBeGreaterThan(0);
    expect(scroll.state.current).toBeLessThan(500);
    expect(el.scrollTo).toHaveBeenCalledWith(0, scroll.state.current);
    expect(el.scrollY).toBe(scroll.state.current);

    scroll.destroy();
  });

  it("converges current to target after many ticks", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window, lambda: 8 });
    scroll.resize(1000);

    el.dispatchEvent(wheelEvent(400));
    for (let i = 0; i < 120; i++) ticker.tick(16);

    expect(scroll.state.current).toBeCloseTo(400, 0);
    scroll.destroy();
  });
});

describe("VirtualScroll — external divergence resync", () => {
  it("snaps target/current to el.scrollY when it changes without going through wheel/scrollTo", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(2000);

    el.dispatchEvent(wheelEvent(300));
    ticker.tick(16); // damps partway, writes el.scrollY via scrollTo

    // Simulate something external (native touch inertia, PageDown, anchor
    // jump, find-in-page) moving the real scroll position directly.
    el.scrollY = 1500;
    ticker.tick(16);

    expect(scroll.state.target).toBe(1500);
    expect(scroll.state.current).toBe(1500);
    expect(scroll.state.velocity).toBe(0);

    scroll.destroy();
  });

  it("does not falsely resync when el.scrollY matches our own last write", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(2000);

    el.dispatchEvent(wheelEvent(300));
    ticker.tick(16);
    const afterFirstTick = scroll.state.current;

    ticker.tick(16); // el.scrollY still equals what we wrote; should keep damping toward 300, not reset to it

    expect(scroll.state.current).toBeGreaterThan(afterFirstTick);
    expect(scroll.state.current).toBeLessThan(300);

    scroll.destroy();
  });
});

describe("VirtualScroll — reducedMotion: wheel listener not installed at all", () => {
  it("does not attach a wheel listener when reducedMotion is true", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const addSpy = vi.spyOn(el, "addEventListener");
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window, reducedMotion: true });

    expect(addSpy).not.toHaveBeenCalledWith("wheel", expect.anything(), expect.anything());

    scroll.destroy();
  });

  it("dispatching a wheel event has no effect on target under reducedMotion", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window, reducedMotion: true });
    scroll.resize(1000);

    el.dispatchEvent(wheelEvent(300));

    expect(scroll.state.target).toBe(0);
    scroll.destroy();
  });

  it("mirrors el.scrollY directly into current every tick, with no damping lag", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window, reducedMotion: true });
    scroll.resize(1000);

    el.scrollY = 400; // native scroll moved the page
    ticker.tick(16);

    expect(scroll.state.current).toBe(400);
    expect(scroll.state.target).toBe(400);
    expect(el.scrollTo).not.toHaveBeenCalled(); // never fights native scroll

    scroll.destroy();
  });

  it("installs the wheel listener when reducedMotion is false (the other branch)", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const addSpy = vi.spyOn(el, "addEventListener");
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window, reducedMotion: false });

    expect(addSpy).toHaveBeenCalledWith("wheel", expect.any(Function), { passive: false });
    scroll.destroy();
  });
});

describe("VirtualScroll.scrollTo", () => {
  it("immediate: snaps current/target and writes el.scrollTo synchronously", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(1000);

    scroll.scrollTo(700, { immediate: true });

    expect(scroll.state.current).toBe(700);
    expect(scroll.state.target).toBe(700);
    expect(el.scrollY).toBe(700);
    scroll.destroy();
  });

  it("non-immediate: only sets target, current eases toward it on subsequent ticks", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(1000);

    scroll.scrollTo(700);

    expect(scroll.state.target).toBe(700);
    expect(scroll.state.current).toBe(0);

    ticker.tick(16);
    expect(scroll.state.current).toBeGreaterThan(0);
    expect(scroll.state.current).toBeLessThan(700);
    scroll.destroy();
  });

  it("clamps to the current limit", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(500);

    scroll.scrollTo(10000, { immediate: true });

    expect(scroll.state.current).toBe(500);
    scroll.destroy();
  });
});

describe("VirtualScroll.resize", () => {
  it("sets the limit and reclamps an out-of-range target/current", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(1000);
    scroll.scrollTo(900, { immediate: true });

    scroll.resize(500); // page shrank

    expect(scroll.state.limit).toBe(500);
    expect(scroll.state.target).toBe(500);
    expect(scroll.state.current).toBe(500);
    scroll.destroy();
  });
});

describe("VirtualScroll.on / destroy", () => {
  it("emits 'scroll' with the new state on every tick", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(1000);
    const cb = vi.fn();
    scroll.on("scroll", cb);

    el.dispatchEvent(wheelEvent(100));
    ticker.tick(16);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(scroll.state);
    scroll.destroy();
  });

  it("on() returns an unsubscribe function", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(1000);
    const cb = vi.fn();
    const unsubscribe = scroll.on("scroll", cb);
    unsubscribe();

    ticker.tick(16);

    expect(cb).not.toHaveBeenCalled();
    scroll.destroy();
  });

  it("destroy() unsubscribes from the ticker and removes the wheel listener", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(1000);
    const removeSpy = vi.spyOn(el, "removeEventListener");

    scroll.destroy();

    expect(removeSpy).toHaveBeenCalledWith("wheel", expect.any(Function));

    const stateBefore = scroll.state;
    el.dispatchEvent(wheelEvent(100));
    ticker.tick(16);
    expect(scroll.state).toEqual(stateBefore); // no longer subscribed to the ticker
  });

  it("destroy() is idempotent", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    expect(() => {
      scroll.destroy();
      scroll.destroy();
    }).not.toThrow();
  });
});

describe("VirtualScroll — defaults", () => {
  it("defaults lambda to 8 and wheelMultiplier to 1", () => {
    const ticker = new Ticker();
    const el = new FakeWindow();
    const scroll = new VirtualScroll(ticker, { el: el as unknown as Window });
    scroll.resize(1000);

    el.dispatchEvent(wheelEvent(100));
    expect(scroll.state.target).toBe(100); // multiplier 1

    ticker.tick(16);
    const expectedCurrent = damp(0, 100, 8, 16 / 1000);
    expect(scroll.state.current).toBeCloseTo(clamp(expectedCurrent, 0, 1000), 5);

    scroll.destroy();
  });
});
