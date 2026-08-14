import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectQualityTier } from "@/lib/engine/core/quality";

describe("@/lib/engine/core/quality", () => {
  it.each([
    ["hardwareConcurrency at the low boundary", { hardwareConcurrency: 2, dpr: 1 }, "low"],
    ["hardwareConcurrency above the low boundary", { hardwareConcurrency: 3, dpr: 1 }, "medium"],
    ["DPR above the low boundary", { hardwareConcurrency: 8, dpr: 2.51 }, "low"],
    ["DPR at the low boundary", { hardwareConcurrency: 8, dpr: 2.5 }, "high"],
    ["first frame above the low boundary", { hardwareConcurrency: 8, dpr: 1, firstFrameMs: 33 }, "low"],
    ["first frame at the low boundary", { hardwareConcurrency: 8, dpr: 1, firstFrameMs: 32 }, "medium"],
    ["hardwareConcurrency at the medium boundary", { hardwareConcurrency: 4, dpr: 1 }, "medium"],
    ["hardwareConcurrency above the medium boundary", { hardwareConcurrency: 5, dpr: 1 }, "high"],
    ["first frame above the medium boundary", { hardwareConcurrency: 8, dpr: 1, firstFrameMs: 19 }, "medium"],
    ["first frame at the medium boundary", { hardwareConcurrency: 8, dpr: 1, firstFrameMs: 18 }, "high"],
    ["omitted first-frame timing", { hardwareConcurrency: 8, dpr: 1 }, "high"],
    ["unknown hardware concurrency", { hardwareConcurrency: Number.NaN, dpr: 1 }, "medium"],
    ["unknown DPR", { hardwareConcurrency: 8, dpr: Number.NaN }, "high"],
    ["unknown first-frame timing", { hardwareConcurrency: 4, dpr: 1, firstFrameMs: Number.NaN }, "medium"],
  ] as const)("maps %s to %s", (_label, probe, expected) => {
    expect(detectQualityTier(probe)).toBe(expected);
  });

  it("keeps the module import list free of three and GL renderer dependencies", () => {
    const filename = resolve(process.cwd(), "lib/engine/core/quality.ts");
    const source = readFileSync(filename, "utf8");

    expect(source).not.toMatch(/from\s+["']three["']/);
    expect(source).not.toMatch(/from\s+["'][^"']*\/gl\//);
  });
});
