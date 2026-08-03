// lib/scenes/particles/shaders.ts
//
// GLSL sources for the "particles" scene (design doc §5 row 3): a curl-noise
// steam/energy field rising out of a can-silhouette region. Plain strings,
// same convention as gl/shaders/noise.ts — concatenated with `simplex3d` +
// `curlNoise` by scene.ts before compiling (`curlNoise` calls `simplex3d`,
// so it must come first in the final source; see gl/shaders/noise.ts's
// header comment).
//
// Two independent shader pairs live here:
//
// 1. RENDER shaders (`renderVertexShader` / `renderFragmentShader`) — the
//    THREE.Points material actually drawn every frame. Motion is ANALYTIC:
//    each vertex re-derives its own position from a per-particle seed (base
//    position + random phase, packed into `uSeedTexture`) plus a repeating
//    rise-and-drift cycle driven by `uTime`, with curl noise added as the
//    drift term. This needs no render-to-texture feedback loop at all, so
//    it works with zero dependency on a GpgpuRenderer — the guaranteed,
//    always-on path.
//
// 2. SIMULATION shaders (`simulationFragmentShader`, run through
//    gl/gpgpu.ts's `Gpgpu` ping-pong pair) — a real position+life advection
//    pass, the "using gl/gpgpu.ts ping-pong FBOs" the design doc calls for.
//    It needs an actual GpgpuRenderer to execute (render-to-texture is
//    unavoidably render-call-shaped), which ViewContext does not currently
//    expose to SceneModule.update() — see scene.ts's header comment for the
//    full contract-gap writeup. `uUseSimTexture` in the render shader blends
//    toward this texture's result once/if it's ever actually computed, so
//    turning that pipeline on later is a pure enhancement, not a rewrite.

/** Shared by both shader pairs: analytic and simulated drift use the same tuning knobs. */
export const particleUniformNames = [
  "uSeedTexture",
  "uPositionTexture",
  "uUseSimTexture",
  "uTime",
  "uDelta",
  "uCurlScale",
  "uSpeed",
  "uRiseHeight",
  "uFirstFrame",
  "uPointSize",
  "uColor",
] as const;

/**
 * Fullscreen-quad vertex shader for the gpgpu simulation pass — Gpgpu's own
 * mesh is a `THREE.PlaneGeometry(2, 2)` (see gl/gpgpu.ts), which already
 * provides a `uv` attribute; this just passes it through.
 */
export const simulationVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

/**
 * Position+life advection: `uTexture` (bound by Gpgpu.compute — see
 * gl/gpgpu.ts) holds the previous frame's (xyz = position, w = life 0..1);
 * `uFirstFrame` (1.0 on the very first compute() call, 0.0 thereafter) mixes
 * in `uSeedTexture` instead, since a freshly-allocated WebGLRenderTarget's
 * initial contents are undefined — this sidesteps needing a separate
 * "seed the FBO" render pass. Depends on `simplex3d` + `curlNoise` (from
 * gl/shaders/noise.ts) being concatenated before this source.
 */
export const simulationFragmentShader = /* glsl */ `
uniform sampler2D uTexture;
uniform sampler2D uSeedTexture;
uniform float uTime;
uniform float uDelta;
uniform float uSpeed;
uniform float uCurlScale;
uniform float uRiseHeight;
uniform float uFirstFrame;
varying vec2 vUv;

void main() {
  vec4 seed = texture2D(uSeedTexture, vUv);
  vec4 prev = mix(texture2D(uTexture, vUv), seed, uFirstFrame);

  vec3 pos = prev.xyz;
  float life = prev.w;

  vec3 flow = curlNoise(pos * uCurlScale + vec3(0.0, uTime * 0.15, 0.0));
  pos += (flow * 0.6 + vec3(0.0, 1.0, 0.0)) * uSpeed * uDelta;
  life -= uDelta * (uSpeed / max(uRiseHeight, 1.0));

  if (life <= 0.0) {
    pos = seed.xyz;
    life = 1.0;
  }

  gl_FragColor = vec4(pos, life);
}
`;

/**
 * Points vertex shader: `aUv` addresses this particle's texel in both
 * `uSeedTexture` (always valid — plain JS-authored DataTexture) and
 * `uPositionTexture` (the gpgpu "read" texture, only meaningful once/if
 * `uUseSimTexture` has been ramped to 1 by scene.ts after a real compute()
 * call actually ran). `analyticSample` is the always-on fallback: it
 * replays a deterministic rise-and-respawn cycle purely as a function of
 * `uTime`, phase-offset per particle by `seed.w`, with curl noise for
 * lateral drift — no render target read-back required. Depends on
 * `simplex3d` + `curlNoise` being concatenated before this source.
 */
export const renderVertexShader = /* glsl */ `
attribute vec2 aUv;
uniform sampler2D uSeedTexture;
uniform sampler2D uPositionTexture;
uniform float uUseSimTexture;
uniform float uTime;
uniform float uCurlScale;
uniform float uSpeed;
uniform float uRiseHeight;
uniform float uPointSize;
varying float vLife;

vec4 analyticSample(vec2 uv) {
  vec4 seed = texture2D(uSeedTexture, uv);
  float cycleSpeed = uSpeed / max(uRiseHeight, 1.0);
  float cycle = fract(uTime * cycleSpeed + seed.w);

  vec3 pos = seed.xyz + vec3(0.0, cycle * uRiseHeight, 0.0);
  vec3 flow = curlNoise(pos * uCurlScale + vec3(0.0, uTime * 0.15, 0.0));
  pos += flow * (uRiseHeight * 0.12) * cycle;

  return vec4(pos, 1.0 - cycle);
}

void main() {
  vec4 analytic = analyticSample(aUv);
  vec4 simSample = texture2D(uPositionTexture, aUv);
  vec4 sampled = mix(analytic, simSample, uUseSimTexture);
  vLife = sampled.w;

  vec4 mvPosition = modelViewMatrix * vec4(sampled.xyz, 1.0);
  gl_PointSize = uPointSize * (300.0 / max(-mvPosition.z, 1.0));
  gl_Position = projectionMatrix * mvPosition;
}
`;

/** Additive round sprite, faded by `vLife` (0 at respawn-imminent, 1 freshly spawned). */
export const renderFragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vLife;

void main() {
  vec2 centered = gl_PointCoord - 0.5;
  float d = length(centered);
  if (d > 0.5) discard;
  float alpha = smoothstep(0.5, 0.0, d) * clamp(vLife, 0.0, 1.0);
  gl_FragColor = vec4(uColor, alpha);
}
`;
