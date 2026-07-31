// test/engine/gl/renderer.test.ts
//
// gl/renderer.ts's DOM-free pieces: DPR clamping, the explicit setSize(w,h,dpr)
// against the RendererLike mock (no ResizeObserver, no real WebGL needed),
// pure quality-tier detection, and the pure renderer-params resolver.
// `createRenderer` itself needs a real GL context (unavailable in jsdom) and
// is intentionally not exercised here — see renderer.ts's own comment.

import { describe, expect, it } from "vitest";
import {
  MAX_DPR_DEFAULT,
  MAX_DPR_LOW,
  MIN_DPR,
  clampDpr,
  detectQualityTier,
  resolveRendererParams,
  setSize,
} from "@/lib/engine/gl/renderer";
import type { RendererLike } from "@/lib/engine/types";

function mockRenderer(): RendererLike & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    setSize: (...args) => calls.push(["setSize", ...args]),
    setScissor: (...args) => calls.push(["setScissor", ...args]),
    setScissorTest: (...args) => calls.push(["setScissorTest", ...args]),
    setViewport: (...args) => calls.push(["setViewport", ...args]),
    render: (...args) => calls.push(["render", ...args]),
    dispose: (...args) => calls.push(["dispose", ...args]),
  };
}

describe("clampDpr", () => {
  it("clamps to MIN_DPR when below 1", () => {
    expect(clampDpr(0.5)).toBe(MIN_DPR);
  });

  it("clamps to MAX_DPR_DEFAULT (2) on high/medium tiers", () => {
    expect(clampDpr(3, "high")).toBe(MAX_DPR_DEFAULT);
    expect(clampDpr(3, "medium")).toBe(MAX_DPR_DEFAULT);
  });

  it("clamps to MAX_DPR_LOW (1.5) on the low tier", () => {
    expect(clampDpr(3, "low")).toBe(MAX_DPR_LOW);
  });

  it("passes through an in-range value unchanged", () => {
    expect(clampDpr(1.75, "high")).toBe(1.75);
  });

  it("falls back to MIN_DPR for a non-finite dpr", () => {
    expect(clampDpr(NaN)).toBe(MIN_DPR);
    expect(clampDpr(Infinity)).toBe(MIN_DPR);
  });
});

describe("setSize — explicit w,h,dpr against RendererLike (no ResizeObserver)", () => {
  it("bakes the clamped dpr into the device-pixel size and never updates CSS style", () => {
    const renderer = mockRenderer();
    setSize(renderer, 400, 300, 2, "high");
    expect(renderer.calls).toEqual([["setSize", 800, 600, false]]);
  });

  it("clamps an excessive dpr per tier before sizing", () => {
    const renderer = mockRenderer();
    setSize(renderer, 100, 100, 4, "low");
    // low tier clamps to 1.5 -> 150x150
    expect(renderer.calls).toEqual([["setSize", 150, 150, false]]);
  });

  it("never emits a zero-sized dimension", () => {
    const renderer = mockRenderer();
    setSize(renderer, 0, 0, 1);
    expect(renderer.calls).toEqual([["setSize", 1, 1, false]]);
  });
});

describe("detectQualityTier — pure, DOM-free", () => {
  it("is low tier on <=2 cores", () => {
    expect(detectQualityTier({ hardwareConcurrency: 2, dpr: 1 })).toBe("low");
  });

  it("is low tier on very high dpr even with plenty of cores", () => {
    expect(detectQualityTier({ hardwareConcurrency: 8, dpr: 3 })).toBe("low");
  });

  it("is low tier when a measured first-frame is slow", () => {
    expect(detectQualityTier({ hardwareConcurrency: 8, dpr: 1, firstFrameMs: 40 })).toBe("low");
  });

  it("is medium tier on 3-4 cores", () => {
    expect(detectQualityTier({ hardwareConcurrency: 4, dpr: 1 })).toBe("medium");
  });

  it("is medium tier on a moderately slow first frame", () => {
    expect(detectQualityTier({ hardwareConcurrency: 8, dpr: 1, firstFrameMs: 20 })).toBe("medium");
  });

  it("is high tier on plenty of cores, normal dpr, fast first frame", () => {
    expect(detectQualityTier({ hardwareConcurrency: 8, dpr: 2, firstFrameMs: 8 })).toBe("high");
  });

  it("is high tier when firstFrameMs is omitted and cores/dpr are healthy", () => {
    expect(detectQualityTier({ hardwareConcurrency: 8, dpr: 1 })).toBe("high");
  });
});

describe("resolveRendererParams — pure defaulting", () => {
  const canvas = {} as HTMLCanvasElement;

  it("fills in documented defaults", () => {
    const params = resolveRendererParams({ canvas });
    expect(params).toMatchObject({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
      stencil: false,
    });
  });

  it("respects caller overrides", () => {
    const params = resolveRendererParams({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
    expect(params).toMatchObject({
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
  });
});
