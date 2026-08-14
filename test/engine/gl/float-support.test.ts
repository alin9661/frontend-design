// test/engine/gl/float-support.test.ts
//
// The pure decision table gets exhaustive coverage (all 16 capability
// combinations, in both requirement modes) because it is cheap and because
// every wrong cell is a device that either renders black or falls back to CPU
// for no reason. `detectFloatSupport` is covered against fake contexts, with
// particular attention to the extension names — probing the sampling
// extension instead of the renderability one is the exact bug this module was
// added to prevent.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  detectFloatSupport,
  floatSupportToTextureType,
  pickFloatSupport,
  type FloatCapabilities,
} from "@/lib/engine/gl/float-support";

type ExtensionContext = {
  getExtension(name: string): object | null;
  texStorage2D?: () => void;
};

function fakeContext(
  supportedExtensions: string[],
  version: "webgl1" | "webgl2",
): WebGLRenderingContext | WebGL2RenderingContext {
  const supported = new Set(supportedExtensions);
  const context: ExtensionContext = {
    getExtension: (name) => (supported.has(name) ? {} : null),
  };

  if (version === "webgl2") {
    context.texStorage2D = () => undefined;
  }

  return context as unknown as WebGLRenderingContext | WebGL2RenderingContext;
}

function caps(
  colorBufferFloat: boolean,
  colorBufferHalfFloat: boolean,
  floatLinear: boolean,
  halfFloatLinear: boolean,
): FloatCapabilities {
  return { colorBufferFloat, colorBufferHalfFloat, floatLinear, halfFloatLinear };
}

describe("pickFloatSupport", () => {
  // Default mode: the consumer samples with NearestFilter (what Gpgpu does),
  // so linear-filter capability must NOT influence the verdict at all.
  it.each([
    [false, false, false, false, "none"],
    [false, false, true, true, "none"],
    [false, true, false, false, "half-float"],
    [false, true, true, true, "half-float"],
    [true, false, false, false, "float"],
    [true, false, true, true, "float"],
    [true, true, false, false, "float"],
    [true, true, true, true, "float"],
  ] as const)(
    "nearest-filter consumer: cbF=%s cbHF=%s fLin=%s hfLin=%s -> %s",
    (colorBufferFloat, colorBufferHalfFloat, floatLinear, halfFloatLinear, expected) => {
      expect(
        pickFloatSupport(caps(colorBufferFloat, colorBufferHalfFloat, floatLinear, halfFloatLinear)),
      ).toBe(expected);
    },
  );

  it("ignores linear-filter capability entirely when it is not required", () => {
    // Renderable float, unfilterable — the combination that a linear-gated
    // probe wrongly demotes. It must still come back "float".
    expect(pickFloatSupport(caps(true, false, false, false))).toBe("float");
    expect(pickFloatSupport(caps(false, true, false, false))).toBe("half-float");
  });

  it.each([
    [false, false, false, false, "none"],
    [false, false, false, true, "none"],
    [false, false, true, false, "none"],
    [false, false, true, true, "none"],
    [false, true, false, false, "none"],
    [false, true, false, true, "half-float"],
    [false, true, true, false, "none"],
    [false, true, true, true, "half-float"],
    [true, false, false, false, "none"],
    [true, false, false, true, "none"],
    [true, false, true, false, "float"],
    [true, false, true, true, "float"],
    [true, true, false, false, "none"],
    [true, true, false, true, "half-float"],
    [true, true, true, false, "float"],
    [true, true, true, true, "float"],
  ] as const)(
    "linear-filter consumer: cbF=%s cbHF=%s fLin=%s hfLin=%s -> %s",
    (colorBufferFloat, colorBufferHalfFloat, floatLinear, halfFloatLinear, expected) => {
      expect(
        pickFloatSupport(
          caps(colorBufferFloat, colorBufferHalfFloat, floatLinear, halfFloatLinear),
          { linearFilter: true },
        ),
      ).toBe(expected);
    },
  );

  it("falls from float to half-float when only float lacks linear filtering", () => {
    expect(pickFloatSupport(caps(true, true, false, true), { linearFilter: true })).toBe(
      "half-float",
    );
    expect(pickFloatSupport(caps(true, true, false, true))).toBe("float");
  });
});

describe("detectFloatSupport", () => {
  it("detects renderable float attachments in WebGL2", () => {
    expect(detectFloatSupport(fakeContext(["EXT_color_buffer_float"], "webgl2"))).toBe("float");
  });

  it("treats EXT_color_buffer_float as granting half-float renderability too", () => {
    // The extension enables RGBA16F alongside RGBA32F. With a linear-filter
    // requirement that float cannot satisfy, the verdict must land on
    // half-float rather than falling all the way to none.
    const gl = fakeContext(["EXT_color_buffer_float"], "webgl2");

    expect(detectFloatSupport(gl, { linearFilter: true })).toBe("half-float");
  });

  it("falls back to WebGL2 half-float support when float is unavailable", () => {
    const gl = fakeContext(["EXT_color_buffer_half_float"], "webgl2");

    expect(detectFloatSupport(gl)).toBe("half-float");
  });

  it("treats half-float linear filtering as core in WebGL2", () => {
    const gl = fakeContext(["EXT_color_buffer_half_float"], "webgl2");

    expect(detectFloatSupport(gl, { linearFilter: true })).toBe("half-float");
  });

  it("detects WebGL1 float renderability from WEBGL_color_buffer_float", () => {
    const gl = fakeContext(["WEBGL_color_buffer_float"], "webgl1");

    expect(detectFloatSupport(gl)).toBe("float");
  });

  it("does not accept WebGL1 OES_texture_float as proof of renderability", () => {
    // OES_texture_float grants SAMPLING only. A context with just this
    // extension will fail framebuffer completeness on a float attachment, so
    // reporting "float" here is the silent-black-simulation bug.
    const gl = fakeContext(["OES_texture_float", "OES_texture_float_linear"], "webgl1");

    expect(detectFloatSupport(gl)).toBe("none");
  });

  it("detects WebGL1 half-float renderability from EXT_color_buffer_half_float", () => {
    const gl = fakeContext(["EXT_color_buffer_half_float"], "webgl1");

    expect(detectFloatSupport(gl)).toBe("half-float");
  });

  it("requires the WebGL1 half-float linear extension when linear filtering is required", () => {
    const withoutLinear = fakeContext(["EXT_color_buffer_half_float"], "webgl1");
    const withLinear = fakeContext(
      ["EXT_color_buffer_half_float", "OES_texture_half_float_linear"],
      "webgl1",
    );

    expect(detectFloatSupport(withoutLinear, { linearFilter: true })).toBe("none");
    expect(detectFloatSupport(withLinear, { linearFilter: true })).toBe("half-float");
  });

  it("returns none when every extension query returns null", () => {
    expect(detectFloatSupport(fakeContext([], "webgl2"))).toBe("none");
    expect(detectFloatSupport(fakeContext([], "webgl1"))).toBe("none");
  });

  it("returns none when getExtension is missing", () => {
    expect(detectFloatSupport({} as WebGLRenderingContext)).toBe("none");
  });

  it("returns none when extension queries throw", () => {
    const hostileContext = {
      getExtension: () => {
        throw new Error("context lost");
      },
    } as unknown as WebGLRenderingContext;

    expect(detectFloatSupport(hostileContext)).toBe("none");
  });
});

describe("floatSupportToTextureType", () => {
  it.each([
    ["float", THREE.FloatType],
    ["half-float", THREE.HalfFloatType],
    ["none", null],
  ] as const)("maps %s to the expected Three.js texture type", (support, expected) => {
    expect(floatSupportToTextureType(support)).toBe(expected);
  });
});
