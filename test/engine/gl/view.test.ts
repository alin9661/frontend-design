// test/engine/gl/view.test.ts
//
// gl/view.ts: per-view camera math (1 world unit = 1 CSS px at z=0), the
// pure inView/progress/scissor-rect helpers driving Stage's culling and
// scissored rendering, and the View class wiring them together.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  VIEW_FOV,
  View,
  cameraDistanceForHeight,
  computeInView,
  computeProgress,
  computeScissorRect,
} from "@/lib/engine/gl/view";
import type { SceneModule, ViewContext } from "@/lib/engine/types";

function noopScene(): SceneModule {
  return {
    init: () => {},
    update: () => {},
    dispose: () => {},
  };
}

describe("cameraDistanceForHeight — 1 unit = 1 CSS px at z=0, fov 45", () => {
  it("matches the documented formula viewportH/2 / tan(fov/2)", () => {
    const viewportH = 600;
    const expected = viewportH / 2 / Math.tan((VIEW_FOV * Math.PI) / 180 / 2);
    expect(cameraDistanceForHeight(viewportH)).toBeCloseTo(expected, 6);
  });

  it("scales with viewport height", () => {
    expect(cameraDistanceForHeight(1000)).toBeGreaterThan(cameraDistanceForHeight(500));
  });

  it("never divides by zero for a zero-height rect", () => {
    expect(Number.isFinite(cameraDistanceForHeight(0))).toBe(true);
  });
});

describe("computeInView — rect/scroll culling", () => {
  const rect = { top: 1000, left: 0, width: 300, height: 400 };

  it("is in view when the rect overlaps the viewport", () => {
    expect(computeInView(rect, 900, 800)).toBe(true); // rect top at 100 within [0,800]
  });

  it("is out of view when scrolled well past it", () => {
    expect(computeInView(rect, 3000, 800)).toBe(false);
  });

  it("is out of view before it's scrolled to", () => {
    expect(computeInView(rect, 0, 800)).toBe(false); // rect top at 1000, viewport ends at 800
  });

  it("a positive margin extends the in-view window on both edges", () => {
    // rect top at 1000, viewportH 500 -> without margin, out of view (top 1000 >= 500)
    expect(computeInView(rect, 0, 500)).toBe(false);
    expect(computeInView(rect, 0, 500, 600)).toBe(true);
  });
});

describe("computeProgress — 0 enter-bottom -> 1 leave-top", () => {
  it("is 0 right as the rect enters the bottom of the viewport", () => {
    const rect = { top: 800, left: 0, width: 100, height: 400 };
    expect(computeProgress(rect, 0, 800)).toBeCloseTo(0, 5);
  });

  it("is 1 right as the rect leaves the top of the viewport", () => {
    const rect = { top: 800, left: 0, width: 100, height: 400 };
    // rect leaves top when rect.top - scrollY + rect.height = 0 -> scrollY = 1200
    expect(computeProgress(rect, 1200, 800)).toBeCloseTo(1, 5);
  });

  it("is clamped to [0,1] outside that range", () => {
    const rect = { top: 800, left: 0, width: 100, height: 400 };
    expect(computeProgress(rect, -10000, 800)).toBe(0);
    expect(computeProgress(rect, 10000, 800)).toBe(1);
  });
});

describe("computeScissorRect — document-space rect + scroll -> device-pixel scissor rect", () => {
  it("places a rect flush with the top of the viewport at the top of the canvas (bottom-left GL origin)", () => {
    const rect = { top: 0, left: 0, width: 100, height: 200 };
    const scissor = computeScissorRect(rect, 0, 800, 1);
    // top-flush rect of height 200 in an 800-tall canvas -> y = 800 - 0 - 200 = 600
    expect(scissor).toEqual({ x: 0, y: 600, width: 100, height: 200 });
  });

  it("scales by dpr", () => {
    const rect = { top: 0, left: 10, width: 100, height: 200 };
    const scissor = computeScissorRect(rect, 0, 800, 2);
    expect(scissor).toEqual({ x: 20, y: 1200, width: 200, height: 400 });
  });

  it("accounts for scroll offset", () => {
    const rect = { top: 500, left: 0, width: 100, height: 200 };
    const scissorAtRest = computeScissorRect(rect, 0, 800, 1);
    const scissorScrolled = computeScissorRect(rect, 100, 800, 1);
    // scrolling down moves the rect's viewport-relative top up, so its
    // bottom-left-origin y grows.
    expect(scissorScrolled.y).toBeGreaterThan(scissorAtRest.y);
  });
});

describe("View", () => {
  it("sets aspect and z-distance from its initial rect", () => {
    const view = new View(0, { top: 0, left: 0, width: 300, height: 200 }, noopScene());
    expect(view.camera.aspect).toBeCloseTo(1.5, 5);
    expect(view.camera.position.z).toBeCloseTo(cameraDistanceForHeight(200), 5);
  });

  it("updateRect re-applies aspect/z-distance to the same camera instance", () => {
    const view = new View(0, { top: 0, left: 0, width: 300, height: 200 }, noopScene());
    const camera = view.camera;
    view.updateRect({ top: 0, left: 0, width: 400, height: 400 });
    expect(view.camera).toBe(camera); // same camera object, just re-configured
    expect(view.camera.aspect).toBeCloseTo(1, 5);
    expect(view.camera.position.z).toBeCloseTo(cameraDistanceForHeight(400), 5);
  });

  it("inView/progress delegate to the pure helpers using the current rect", () => {
    const view = new View(0, { top: 1000, left: 0, width: 100, height: 200 }, noopScene());
    expect(view.inView(3000, 800)).toBe(false);
    expect(view.inView(900, 800)).toBe(true);
    expect(view.progress(900, 800)).toBeGreaterThan(0);
  });

  it("owns a distinct THREE.Scene per instance", () => {
    const a = new View(0, { top: 0, left: 0, width: 100, height: 100 }, noopScene());
    const b = new View(1, { top: 0, left: 0, width: 100, height: 100 }, noopScene());
    expect(a.scene).not.toBe(b.scene);
    expect(a.scene).toBeInstanceOf(THREE.Scene);
  });
});
