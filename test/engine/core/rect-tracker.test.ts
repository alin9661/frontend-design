// test/engine/core/rect-tracker.test.ts
//
// lib/engine/core/rect-tracker.ts — document-space rect tracking with an
// injectable `measure` so no real laid-out DOM is required. Covers
// document-space conversion, live updates on refresh(), and the boundary
// values of inView/viewportY/progress (design doc §6: "rect math").

import { describe, expect, it } from "vitest";
import { RectTracker } from "@/lib/engine/core/rect-tracker";

function fakeRect(top: number, left: number, width: number, height: number): DOMRect {
  return { top, left, width, height, bottom: top + height, right: left + width, x: left, y: top, toJSON() {} } as DOMRect;
}

describe("RectTracker.track", () => {
  it("converts a viewport-relative rect to document-space using the last-known scrollY", () => {
    const el = {} as Element;
    const tracker = new RectTracker({ measure: () => fakeRect(100, 20, 300, 400) });
    tracker.refresh(500); // set lastScrollY before tracking
    const rect = tracker.track(el);

    expect(rect.top).toBe(600); // 100 (viewport) + 500 (scrollY)
    expect(rect.left).toBe(20);
    expect(rect.width).toBe(300);
    expect(rect.height).toBe(400);
  });

  it("uses scrollY=0 as the default before any refresh() call", () => {
    const tracker = new RectTracker({ measure: () => fakeRect(50, 0, 100, 100) });
    const rect = tracker.track({} as Element);
    expect(rect.top).toBe(50);
  });

  it("returns the same live TrackedRect for a re-tracked element instead of duplicating", () => {
    const el = {} as Element;
    const tracker = new RectTracker({ measure: () => fakeRect(0, 0, 100, 100) });
    const first = tracker.track(el);
    const second = tracker.track(el);
    expect(first).toBe(second);
  });

  it("defaults measure to el.getBoundingClientRect when none is injected", () => {
    const el = { getBoundingClientRect: () => fakeRect(10, 10, 50, 50) } as unknown as Element;
    const tracker = new RectTracker();
    const rect = tracker.track(el);
    expect(rect.top).toBe(10);
    expect(rect.width).toBe(50);
  });
});

describe("RectTracker.refresh — live updates, zero per-frame layout reads", () => {
  it("re-measures and mutates the same TrackedRect instance in place", () => {
    let currentTop = 100;
    const tracker = new RectTracker({ measure: () => fakeRect(currentTop, 0, 100, 100) });
    const rect = tracker.track({} as Element);
    expect(rect.top).toBe(100);

    currentTop = 250;
    tracker.refresh(0);

    expect(rect.top).toBe(250); // same object, updated fields
  });

  it("only calls the measure function for tracked (not untracked) elements", () => {
    let calls = 0;
    const measure = () => {
      calls++;
      return fakeRect(0, 0, 10, 10);
    };
    const tracker = new RectTracker({ measure });
    const a = {} as Element;
    const b = {} as Element;
    tracker.track(a);
    tracker.track(b);
    expect(calls).toBe(2);

    tracker.untrack(a);
    tracker.refresh(0);

    expect(calls).toBe(3); // only `b` re-measured
  });
});

describe("TrackedRect.viewportY", () => {
  it("returns the element's position relative to the viewport (top - scrollY)", () => {
    const tracker = new RectTracker({ measure: () => fakeRect(0, 0, 100, 100) });
    tracker.refresh(300); // document-space top = 300
    const rect = tracker.track({} as Element);

    expect(rect.viewportY(300)).toBe(0); // scrolled exactly to it
    expect(rect.viewportY(0)).toBe(300); // not scrolled yet
    expect(rect.viewportY(400)).toBe(-100); // scrolled past it
  });
});

describe("TrackedRect.inView", () => {
  it("is true when the element overlaps the viewport window", () => {
    const tracker = new RectTracker({ measure: () => fakeRect(500, 0, 100, 300) }); // doc-space top=500..800
    const rect = tracker.track({} as Element);

    expect(rect.inView(600, 800)).toBe(true); // viewport [600, 1400] overlaps [500,800]
  });

  it("is false when the element is entirely above or below the viewport", () => {
    const tracker = new RectTracker({ measure: () => fakeRect(500, 0, 100, 300) }); // [500, 800]
    const rect = tracker.track({} as Element);

    expect(rect.inView(2000, 800)).toBe(false); // viewport [2000, 2800], well below
    expect(rect.inView(0, 100)).toBe(false); // viewport [0, 100], well above
  });

  it("respects the boundary exactly at the edges (exclusive touch = not in view)", () => {
    const tracker = new RectTracker({ measure: () => fakeRect(500, 0, 100, 300) }); // [500, 800]
    const rect = tracker.track({} as Element);

    // viewport bottom exactly at element top -> not overlapping
    expect(rect.inView(200, 300)).toBe(false); // viewport [200,500]
    // viewport top exactly at element bottom -> not overlapping
    expect(rect.inView(800, 300)).toBe(false); // viewport [800,1100]
  });

  it("expands the viewport window by margin on both sides", () => {
    const tracker = new RectTracker({ measure: () => fakeRect(1000, 0, 100, 100) }); // [1000,1100]
    const rect = tracker.track({} as Element);

    expect(rect.inView(700, 200)).toBe(false); // viewport [700,900], no margin
    expect(rect.inView(700, 200, 150)).toBe(true); // viewport expands to [550,1050], now overlaps
  });
});

describe("TrackedRect.progress — 0 enter-bottom -> 1 leave-top, clamped", () => {
  it("is 0 the instant the element's top touches the viewport's bottom edge (entering)", () => {
    const viewportH = 800;
    const height = 200;
    // doc-space top = 1000; progress=0 requires top === scrollY + viewportH.
    const tracker = new RectTracker({ measure: () => fakeRect(1000, 0, 100, height) });
    tracker.refresh(0);
    const rect = tracker.track({} as Element);
    expect(rect.progress(1000 - viewportH, viewportH)).toBeCloseTo(0, 10);
  });

  it("is 1 the instant the element's bottom touches the viewport's top edge (fully left)", () => {
    const viewportH = 800;
    const height = 200;
    const tracker = new RectTracker({ measure: () => fakeRect(300, 0, 100, height) }); // doc-space top=300, bottom=500
    tracker.refresh(0);
    const rect = tracker.track({} as Element);
    // progress=1 when top + height === scrollY  =>  scrollY = 500
    expect(rect.progress(500, viewportH)).toBeCloseTo(1, 10);
  });

  it("is 0.5 when the element exactly fills the viewport (top at scrollY, height === viewportH)", () => {
    const viewportH = 800;
    const tracker = new RectTracker({ measure: () => fakeRect(1000, 0, 100, viewportH) });
    tracker.refresh(0);
    const rect = tracker.track({} as Element);
    expect(rect.progress(1000, viewportH)).toBeCloseTo(0.5, 10);
  });

  it("clamps below 0 and above 1 (well before entering / well after leaving)", () => {
    const viewportH = 800;
    const height = 200;
    const tracker = new RectTracker({ measure: () => fakeRect(5000, 0, 100, height) });
    tracker.refresh(0);
    const rect = tracker.track({} as Element);

    expect(rect.progress(0, viewportH)).toBe(0); // nowhere near the element yet
    expect(rect.progress(100000, viewportH)).toBe(1); // scrolled way past it
  });

  it("returns 0 rather than dividing by zero when viewportH and height are both 0", () => {
    const tracker = new RectTracker({ measure: () => fakeRect(0, 0, 100, 0) });
    tracker.refresh(0);
    const rect = tracker.track({} as Element);
    expect(rect.progress(0, 0)).toBe(0);
  });
});
