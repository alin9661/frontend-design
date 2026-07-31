// lib/engine/gl/shaders/chunks.ts
//
// Small, composable GLSL string chunks shared across scene shaders: easing
// curves (mirrors core/math.ts's easeOutExpo/easeInOutCubic/easeOutBack so
// GPU-side motion matches CPU-side motion), 2D/3D rotation helpers, and
// Mateína brand-color constants (sourced from lib/flavors.ts — READ ONLY
// reference, not imported since gl/ must stay worker-safe / dependency-light
// and GLSL can't import TS anyway).

/** `float easeOutExpo/easeInOutCubic/easeOutBack(float t)` — GLSL mirrors of core/math.ts. */
export const easing = /* glsl */ `
float easeOutExpo(float t) {
  return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
}

float easeInOutCubic(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

float easeOutBack(float t) {
  const float c1 = 1.70158;
  const float c3 = c1 + 1.0;
  return 1.0 + c3 * pow(t - 1.0, 3.0) + c1 * pow(t - 1.0, 2.0);
}
`;

/** `mat2 rotate2d(float)`, `mat3 rotateX/Y/Z(float)` — angle in radians. */
export const rotation = /* glsl */ `
mat2 rotate2d(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

mat3 rotateX(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

mat3 rotateY(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotateZ(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}
`;

/**
 * `vec3 brandMint/brandForest/brandCream()` — the mint flavor's palette
 * (lib/flavors.ts `mint`: bg #24765F, can #7CC9B5) plus the shared cream
 * ink (#F9F9EE) and forest (#1D423C), as linear-space-agnostic sRGB
 * constants for use in fragment shaders (glow tints, fog, gradients).
 */
export const brandColors = /* glsl */ `
vec3 brandMintBg() { return vec3(0.1412, 0.4627, 0.3725); }   // #24765F
vec3 brandMintCan() { return vec3(0.4863, 0.7882, 0.7098); }  // #7CC9B5
vec3 brandCream() { return vec3(0.9765, 0.9765, 0.9333); }    // #F9F9EE
vec3 brandForest() { return vec3(0.1137, 0.2588, 0.2353); }   // #1D423C
`;
