// lib/engine/gl/float-support.ts
//
// Capability probe for floating-point RENDER TARGETS (gl/gpgpu.ts's ping-pong
// pair). Split in two on purpose: `pickFloatSupport` is the pure decision and
// carries every test, while `detectFloatSupport` is the thin, untestable-
// without-a-GPU layer that reads extension names off a live context.
//
// The distinction that matters throughout this file: sampling a float texture
// and RENDERING INTO one are separate capabilities with separate extensions.
// WebGL1's `OES_texture_float` grants only the former; a context can hold it
// and still fail framebuffer completeness on a float attachment. Probing the
// wrong one produces exactly the silent-black-simulation failure this module
// exists to prevent, so the renderability extensions are the ones consulted:
// `EXT_color_buffer_float` on WebGL2, `WEBGL_color_buffer_float` on WebGL1.

import * as THREE from "three";

export type FloatSupport = "float" | "half-float" | "none";

export interface FloatCapabilities {
  /** Can this context render INTO a 32-bit float color attachment? */
  colorBufferFloat: boolean;
  /** Can it render INTO a 16-bit half-float color attachment? */
  colorBufferHalfFloat: boolean;
  /** Can a 32-bit float texture be sampled with `LinearFilter`? */
  floatLinear: boolean;
  /** Can a 16-bit half-float texture be sampled with `LinearFilter`? */
  halfFloatLinear: boolean;
}

export interface FloatSupportRequirements {
  /**
   * Set only when the consumer samples its float texture with `LinearFilter`.
   * `Gpgpu` does not — it pins `NearestFilter` on both min and mag, because a
   * ping-pong state texture is addressed texel-for-texel — so it leaves this
   * off. Turning it on where it isn't needed silently demotes hardware that
   * renders to float perfectly well but cannot filter it, which is a common
   * combination on mobile.
   */
  linearFilter?: boolean;
}

/** Pure decision function — no WebGL, no context. Preference: float, half-float, none. */
export function pickFloatSupport(
  caps: FloatCapabilities,
  requirements: FloatSupportRequirements = {},
): FloatSupport {
  const needsLinear = requirements.linearFilter === true;

  if (caps.colorBufferFloat && (!needsLinear || caps.floatLinear)) {
    return "float";
  }

  if (caps.colorBufferHalfFloat && (!needsLinear || caps.halfFloatLinear)) {
    return "half-float";
  }

  return "none";
}

/** Reads renderability extensions off a live context and delegates to `pickFloatSupport`. */
export function detectFloatSupport(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  requirements: FloatSupportRequirements = {},
): FloatSupport {
  const context = gl as unknown as {
    getExtension?: (name: string) => unknown;
    texStorage2D?: unknown;
  };

  if (typeof context.getExtension !== "function") {
    return "none";
  }

  const hasExtension = (name: string): boolean => {
    try {
      return context.getExtension!.call(gl, name) != null;
    } catch {
      // A context lost between creation and probing throws here. "none" sends
      // the caller down its CPU path, which is the right answer for a dead
      // context either way.
      return false;
    }
  };

  // `texStorage2D` is WebGL2-only and present on every implementation, which
  // makes it a more reliable discriminator than `instanceof
  // WebGL2RenderingContext` — that global is absent in jsdom and in some
  // worker scopes, where this module still has to return a sane answer.
  const isWebGL2 = typeof context.texStorage2D === "function";

  if (isWebGL2) {
    const colorBufferFloat = hasExtension("EXT_color_buffer_float");

    return pickFloatSupport(
      {
        colorBufferFloat,
        // EXT_color_buffer_float enables RGBA16F *and* RGBA32F, so a context
        // holding it can render half-float even without the half-float-only
        // extension. Checking only the latter would report "none" on hardware
        // that supports both.
        colorBufferHalfFloat: colorBufferFloat || hasExtension("EXT_color_buffer_half_float"),
        floatLinear: hasExtension("OES_texture_float_linear"),
        // Linear filtering of half-float textures is core WebGL2, not an extension.
        halfFloatLinear: true,
      },
      requirements,
    );
  }

  return pickFloatSupport(
    {
      // NOT OES_texture_float — that grants sampling, not renderability.
      colorBufferFloat: hasExtension("WEBGL_color_buffer_float"),
      colorBufferHalfFloat: hasExtension("EXT_color_buffer_half_float"),
      floatLinear: hasExtension("OES_texture_float_linear"),
      halfFloatLinear: hasExtension("OES_texture_half_float_linear"),
    },
    requirements,
  );
}

/** Maps a support verdict to a Three.js render-target type; `null` means "take the CPU path". */
export function floatSupportToTextureType(
  support: FloatSupport,
): THREE.TextureDataType | null {
  if (support === "float") {
    return THREE.FloatType;
  }

  if (support === "half-float") {
    return THREE.HalfFloatType;
  }

  return null;
}
