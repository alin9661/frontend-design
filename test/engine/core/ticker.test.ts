// test/engine/core/ticker.test.ts
//
// lib/engine/core/ticker.ts — priority-bucketed frame scheduler. Most
// behavior is exercised through the manual tick() seam per design doc §4;
// start()/stop()'s real rAF loop and visibilitychange pause are exercised
// by stubbing requestAnimationFrame/cancelAnimationFrame and dispatching a
// real visibilitychange event against jsdom's `document`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ticker, TickOrder } from "@/lib/engine/core/ticker";

describe("Ticker.add / tick — ordering and unsubscribe", () => {
  it("calls subscribers in ascending order regardless of subscription order", () => {
    const ticker = new Ticker();
    const calls: string[] = [];
    ticker.add(() => calls.push("scene"), TickOrder.SCENE);
    ticker.add(() => calls.push("input"), TickOrder.INPUT);
    ticker.add(() => calls.push("render"), TickOrder.RENDER);
    ticker.add(() => calls.push("scroll"), TickOrder.SCROLL);

    ticker.tick(16);

    expect(calls).toEqual(["input", "scroll", "scene", "render"]);
  });

  it("breaks ties by insertion order", () => {
    const ticker = new Ticker();
    const calls: string[] = [];
    ticker.add(() => calls.push("first"), TickOrder.SCENE);
    ticker.add(() => calls.push("second"), TickOrder.SCENE);

    ticker.tick(16);

    expect(calls).toEqual(["first", "second"]);
  });

  it("passes dt (seconds) and running elapsed (seconds) to every subscriber", () => {
    const ticker = new Ticker();
    const seen: Array<{ dt: number; elapsed: number }> = [];
    ticker.add((dt, elapsed) => seen.push({ dt, elapsed }));

    ticker.tick(16);
    ticker.tick(16);

    expect(seen[0]!.dt).toBeCloseTo(0.016, 5);
    expect(seen[0]!.elapsed).toBeCloseTo(0.016, 5);
    expect(seen[1]!.dt).toBeCloseTo(0.016, 5);
    expect(seen[1]!.elapsed).toBeCloseTo(0.032, 5);
  });

  it("add() returns an unsubscribe function that stops future calls", () => {
    const ticker = new Ticker();
    const fn = vi.fn();
    const unsubscribe = ticker.add(fn);

    ticker.tick(16);
    unsubscribe();
    ticker.tick(16);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a subscriber unsubscribing itself mid-tick does not disrupt the current pass", () => {
    const ticker = new Ticker();
    const calls: string[] = [];
    let unsubscribeA: () => void;
    unsubscribeA = ticker.add(() => {
      calls.push("a");
      unsubscribeA();
    }, TickOrder.INPUT);
    ticker.add(() => calls.push("b"), TickOrder.SCENE);

    ticker.tick(16);
    expect(calls).toEqual(["a", "b"]);

    ticker.tick(16);
    expect(calls).toEqual(["a", "b", "b"]);
  });
});

describe("Ticker.tick — dt clamp", () => {
  it("clamps a huge dt to 64ms (0.064s) before calling subscribers", () => {
    const ticker = new Ticker();
    let seenDt = 0;
    ticker.add((dt) => (seenDt = dt));

    ticker.tick(1000);

    expect(seenDt).toBeCloseTo(0.064, 10);
  });

  it("clamps elapsed accumulation too, not just the per-call dt", () => {
    const ticker = new Ticker();
    let seenElapsed = 0;
    ticker.add((_dt, elapsed) => (seenElapsed = elapsed));

    ticker.tick(1000);
    ticker.tick(1000);

    expect(seenElapsed).toBeCloseTo(0.128, 10); // two clamped 64ms steps
  });

  it("does not clamp a dt already under the 64ms ceiling", () => {
    const ticker = new Ticker();
    let seenDt = 0;
    ticker.add((dt) => (seenDt = dt));

    ticker.tick(32);

    expect(seenDt).toBeCloseTo(0.032, 10);
  });

  it("treats a negative dt as zero", () => {
    const ticker = new Ticker();
    let seenDt = -1;
    ticker.add((dt) => (seenDt = dt));

    ticker.tick(-50);

    expect(seenDt).toBe(0);
  });
});

describe("Ticker.running", () => {
  it("is false initially, true after start(), false after stop()", () => {
    const ticker = new Ticker();
    expect(ticker.running).toBe(false);

    const raf = vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      ticker.start();
      expect(ticker.running).toBe(true);
      ticker.stop();
      expect(ticker.running).toBe(false);
    } finally {
      raf.unstubAllGlobals();
    }
  });

  it("start() is idempotent (a second call does not schedule a second frame)", () => {
    const rafSpy = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      const ticker = new Ticker();
      ticker.start();
      ticker.start();
      expect(rafSpy).toHaveBeenCalledTimes(1);
      ticker.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stop() is idempotent (a second call is a safe no-op)", () => {
    const ticker = new Ticker();
    expect(() => {
      ticker.stop();
      ticker.stop();
    }).not.toThrow();
  });
});

describe("Ticker — visibilitychange pause (main thread only)", () => {
  const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");

  function setHidden(value: boolean): void {
    Object.defineProperty(document, "hidden", { configurable: true, value });
  }

  afterEach(() => {
    if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
    else delete (document as { hidden?: boolean }).hidden;
  });

  it("cancels the scheduled frame when the document becomes hidden", () => {
    const rafSpy = vi.fn(() => 7);
    const cafSpy = vi.fn();
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("cancelAnimationFrame", cafSpy);
    try {
      setHidden(false);
      const ticker = new Ticker();
      ticker.start();
      expect(rafSpy).toHaveBeenCalledTimes(1);

      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));

      expect(cafSpy).toHaveBeenCalledWith(7);
      ticker.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resumes scheduling when the document becomes visible again", () => {
    const rafSpy = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      setHidden(false);
      const ticker = new Ticker();
      ticker.start();
      expect(rafSpy).toHaveBeenCalledTimes(1);

      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(rafSpy).toHaveBeenCalledTimes(1); // no new frame scheduled while hidden

      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(rafSpy).toHaveBeenCalledTimes(2);

      ticker.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stop() detaches the visibilitychange listener (further hidden events don't call cancelAnimationFrame)", () => {
    const rafSpy = vi.fn(() => 1);
    const cafSpy = vi.fn();
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("cancelAnimationFrame", cafSpy);
    try {
      setHidden(false);
      const ticker = new Ticker();
      ticker.start();
      ticker.stop();
      cafSpy.mockClear();

      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));

      expect(cafSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
