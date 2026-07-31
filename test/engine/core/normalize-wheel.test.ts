// test/engine/core/normalize-wheel.test.ts
//
// lib/engine/core/normalize-wheel.ts — deltaMode-aware WheelEvent
// normalizer. Covers all three deltaMode branches (design doc §6 requires
// "normalizeWheel per deltaMode").

import { describe, expect, it } from "vitest";
import { normalizeWheel } from "@/lib/engine/core/normalize-wheel";

function wheelEvent(deltaX: number, deltaY: number, deltaMode: number): WheelEvent {
  return new WheelEvent("wheel", { deltaX, deltaY, deltaMode });
}

describe("normalizeWheel", () => {
  it("deltaMode PIXEL (0): passes deltas through unchanged", () => {
    const result = normalizeWheel(wheelEvent(5, 100, 0));
    expect(result).toEqual({ pixelX: 5, pixelY: 100 });
  });

  it("deltaMode LINE (1): multiplies deltas by the line-height factor", () => {
    const result = normalizeWheel(wheelEvent(1, 3, 1));
    expect(result.pixelX).toBe(40); // 1 * 40
    expect(result.pixelY).toBe(120); // 3 * 40
  });

  it("deltaMode PAGE (2): multiplies deltas by the page-height factor", () => {
    const result = normalizeWheel(wheelEvent(0, 1, 2));
    expect(result.pixelY).toBe(800); // 1 * 800
  });

  it("handles negative deltas (scroll up / left) in every mode", () => {
    expect(normalizeWheel(wheelEvent(0, -100, 0)).pixelY).toBe(-100);
    expect(normalizeWheel(wheelEvent(0, -2, 1)).pixelY).toBe(-80);
    expect(normalizeWheel(wheelEvent(0, -1, 2)).pixelY).toBe(-800);
  });

  it("handles zero deltas", () => {
    expect(normalizeWheel(wheelEvent(0, 0, 0))).toEqual({ pixelX: 0, pixelY: 0 });
  });
});
