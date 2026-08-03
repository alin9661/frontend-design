// test/engine/gl/noise.test.ts
//
// gl/shaders/noise.ts + gl/shaders/chunks.ts export plain GLSL strings (no
// three/DOM dependency — worker-safe). These are compiled by the GPU, not by
// vitest, so the practical unit-test surface is: each export is a non-empty
// string, and it contains the function-name tokens a consuming shader would
// concatenate against (curlNoise/fbm depend on simplex3d being present).

import { describe, expect, it } from "vitest";
import { curlNoise, fbm, simplex3d, simplex4d } from "@/lib/engine/gl/shaders/noise";
import { brandColors, easing, rotation } from "@/lib/engine/gl/shaders/chunks";

describe("shaders/noise.ts — required tokens", () => {
  it("simplex3d defines a `float simplex3d(vec3` function", () => {
    expect(simplex3d).toContain("float simplex3d(vec3");
  });

  it("simplex4d defines a `float simplex4d(vec4` function", () => {
    expect(simplex4d).toContain("float simplex4d(vec4");
  });

  it("curlNoise defines `vec3 curlNoise(vec3` and depends on simplex3d", () => {
    expect(curlNoise).toContain("vec3 curlNoise(vec3");
    expect(curlNoise).toContain("simplex3d(");
  });

  it("fbm defines `float fbm(vec3` and depends on simplex3d", () => {
    expect(fbm).toContain("float fbm(vec3");
    expect(fbm).toContain("simplex3d(");
  });

  it("every export is non-empty GLSL text", () => {
    for (const chunk of [simplex3d, simplex4d, curlNoise, fbm]) {
      expect(chunk.length).toBeGreaterThan(20);
      expect(chunk).toContain("{");
      expect(chunk).toContain("}");
    }
  });

  it("simplex3d and curlNoise/fbm concatenate into balanced-brace GLSL source", () => {
    const source = `${simplex3d}\n${curlNoise}\n${fbm}`;
    const opens = (source.match(/\{/g) ?? []).length;
    const closes = (source.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});

describe("shaders/chunks.ts — required tokens", () => {
  it("easing exports easeOutExpo, easeInOutCubic, easeOutBack", () => {
    expect(easing).toContain("float easeOutExpo(float t)");
    expect(easing).toContain("float easeInOutCubic(float t)");
    expect(easing).toContain("float easeOutBack(float t)");
  });

  it("rotation exports 2D and 3D rotation helpers", () => {
    expect(rotation).toContain("mat2 rotate2d(float a)");
    expect(rotation).toContain("mat3 rotateX(float a)");
    expect(rotation).toContain("mat3 rotateY(float a)");
    expect(rotation).toContain("mat3 rotateZ(float a)");
  });

  it("brandColors exports brand color helpers", () => {
    expect(brandColors).toContain("vec3 brandMintBg()");
    expect(brandColors).toContain("vec3 brandCream()");
  });
});
