// lib/scenes/origin-film/pollen.ts
//
// Drifting pollen motes for the origin film's harvest beat. Two rendering
// strategies behind one object, chosen by the mandatory capability chain
// `float` -> `half-float` -> CPU:
//
//   - GPU path: a `THREE.Points` cloud whose positions are advected by the
//     repo's ping-pong GPGPU helper (`lib/engine/gl/gpgpu.ts`) using curl
//     noise, a pointer repulsion force, and a scroll-velocity force. The
//     scroll force exists because touch devices have no hover pointer at all
//     — without it the field would be inert on every phone.
//   - CPU path: an `InstancedMesh` whose matrices are written from an
//     ANALYTIC drift (see below). Taken whenever float render targets are
//     unavailable (`support === "none"`, where constructing a `Gpgpu` would
//     throw `GpgpuFloatSupportError` by design) and on the "low" tier even
//     when float support exists. The scene is never left with nothing.
//
// THE ONE NON-OBVIOUS DECISION: the CPU fallback is analytic, not integrated.
// Every mote's position is recomputed from a deterministic seed plus the
// field's elapsed time each frame rather than accumulated into a velocity.
// That costs the same per frame, but it buys two things an integrator
// depends on: `reducedMotion` becomes a genuine freeze (stop advancing
// `elapsed` and the pose is bit-identical forever, with no residual velocity
// to bleed off), and the field is reproducible — two `PollenField`s built
// with the same options and fed the same inputs agree exactly, which is what
// makes the pointer/scroll forces testable without a GPU.
//
// Two smaller notes:
//   - Under `reducedMotion` the GPU path allocates NO render targets at all
//     (`gpgpu` stays null) and renders the static seed pose via
//     `uUseSimTexture = 0`. A frozen simulation has nothing to simulate, and
//     two float FBOs are the most expensive thing in this module.
//   - The seed `DataTexture` is always `FloatType`, even on the half-float
//     path. Sampling an RGBA32F texture with `NearestFilter` is core WebGL2
//     (only *filtering* it needs `OES_texture_float_linear` and only
//     *rendering into* it needs `EXT_color_buffer_float`), so the half-float
//     verdict constrains the render targets, not the seed upload.
//
// Colors come from `lib/palette.ts`. The soft-sprite falloff coefficients
// inside the GLSL are shader math, not brand color — the same documented
// exemption `rig.ts`'s `buildBrew` takes.

import * as THREE from "three";
import { clamp, damp, smoothstep } from "@/lib/engine/core/math";
import type { QualityTier } from "@/lib/engine/types";
import { Gpgpu, type GpgpuRenderer } from "@/lib/engine/gl/gpgpu";
import type { FloatSupport } from "@/lib/engine/gl/float-support";
import { curlNoise, simplex3d } from "@/lib/engine/gl/shaders/noise";
import { glPalette } from "@/lib/palette";

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** Half-extents of the box the field occupies, in the origin film's units. */
export const POLLEN_BOUNDS = { x: 420, y: 300, z: 220 } as const;

/** Simulation texture side per tier on the GPU path; mote count is its square. */
export const POLLEN_SIM_SIZE: Record<QualityTier, number> = {
  low: 16,
  medium: 32,
  high: 48,
};

/** Mote count per tier on the CPU path — instance matrices are written in JS. */
export const POLLEN_CPU_COUNT: Record<QualityTier, number> = {
  low: 80,
  medium: 140,
  high: 200,
};

/** Floor for an explicitly requested count; a field of three motes is a bug. */
export const POLLEN_MIN_COUNT = 8;

export type PollenPath = "gpu" | "cpu";

export interface PollenBudget {
  path: PollenPath;
  /** Motes actually allocated. */
  count: number;
  /** Simulation texture side on the GPU path; `0` on the CPU path. */
  simSize: number;
}

export interface PollenBudgetInput {
  support: FloatSupport;
  quality: QualityTier;
  /** Requested mote count. Omitted means "whatever the tier affords". */
  count?: number;
}

/**
 * Pure resolution of the capability chain and the per-tier budget.
 *
 * "low" prefers the CPU path even when float render targets are available:
 * on that hardware the ping-pong pass costs more than the handful of motes it
 * would animate.
 */
export function resolvePollenBudget(input: PollenBudgetInput): PollenBudget {
  const { support, quality } = input;
  const requested =
    input.count !== undefined && Number.isFinite(input.count)
      ? Math.floor(input.count)
      : undefined;

  if (quality === "low" || support === "none") {
    const cap = POLLEN_CPU_COUNT[quality];
    const count =
      requested === undefined ? cap : Math.round(clamp(requested, POLLEN_MIN_COUNT, cap));
    return { path: "cpu", count, simSize: 0 };
  }

  const capSide = POLLEN_SIM_SIZE[quality];
  const side =
    requested === undefined
      ? capSide
      : Math.round(
          clamp(Math.ceil(Math.sqrt(Math.max(requested, POLLEN_MIN_COUNT))), 2, capSide),
        );
  return { path: "gpu", count: side * side, simSize: side };
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

/** Peak opacity of a mote sprite. */
export const POLLEN_MAX_OPACITY = 0.85;
/** Fraction of the chapter spent fading in, and again fading out. */
export const POLLEN_FADE = 0.25;

/**
 * Pure: chapter progress (0..1, clamped) -> field opacity. A plateaued bell,
 * so the pollen is absent at both chapter edges and fully present through the
 * middle rather than popping on at the boundary.
 */
export function pollenOpacityForProgress(progress: number): number {
  const t = clamp(progress, 0, 1);
  const fadeIn = smoothstep(clamp(t / POLLEN_FADE, 0, 1));
  const fadeOut = smoothstep(clamp((1 - t) / POLLEN_FADE, 0, 1));
  return POLLEN_MAX_OPACITY * fadeIn * fadeOut;
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/** Deterministic 0..1 hash — see the header note on reproducibility. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/**
 * `count` RGBA seeds: xyz is a resting position inside `POLLEN_BOUNDS`, w is a
 * 0..1 per-mote phase (drives drift offset, size and color mix). Deterministic
 * in `count` alone.
 */
export function buildPollenSeeds(count: number): Float32Array {
  const data = new Float32Array(Math.max(0, Math.floor(count)) * 4);
  for (let i = 0; i < data.length / 4; i += 1) {
    data[i * 4] = (hash01(i + 1) * 2 - 1) * POLLEN_BOUNDS.x;
    data[i * 4 + 1] = (hash01(i + 97.3) * 2 - 1) * POLLEN_BOUNDS.y;
    data[i * 4 + 2] = (hash01(i + 313.7) * 2 - 1) * POLLEN_BOUNDS.z * 0.8;
    data[i * 4 + 3] = hash01(i + 719.1);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

/** Fullscreen-quad pass-through; `Gpgpu` supplies a `PlaneGeometry(2, 2)`. */
export const pollenSimulationVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

/**
 * Advection pass. `uTexture` is bound by `Gpgpu.compute()` to the previous
 * state (xyz = position, w = phase); `uFirstFrame` mixes in the seed instead
 * on the very first step, since a fresh render target's contents are
 * undefined. Requires `simplex3d` + `curlNoise` concatenated ahead of it.
 */
export const pollenSimulationFragmentShader = /* glsl */ `
uniform sampler2D uTexture;
uniform sampler2D uSeedTexture;
uniform float uTime;
uniform float uDelta;
uniform float uFirstFrame;
uniform float uCurlScale;
uniform float uDrift;
uniform float uPointerStrength;
uniform float uScrollVelocity;
uniform float uProgress;
uniform vec2 uPointer;
uniform vec3 uBounds;
varying vec2 vUv;

void main() {
  vec4 seed = texture2D(uSeedTexture, vUv);
  vec4 prev = mix(texture2D(uTexture, vUv), seed, uFirstFrame);

  vec3 pos = prev.xyz;
  float phase = prev.w;

  vec3 flow = curlNoise(pos * uCurlScale + vec3(0.0, uTime * 0.08, phase * 3.0));
  vec3 vel = flow * uDrift;

  // Pointer repulsion, in the XY plane only — the film is shot flat on.
  vec2 away = pos.xy - uPointer * uBounds.xy;
  float dist = length(away);
  float falloff = 1.0 - smoothstep(0.0, uBounds.x * 0.55, dist);
  vel.xy += normalize(vec2(away.x, away.y) + vec2(1e-4)) * falloff * falloff * uPointerStrength;

  // Scroll velocity: the only disturbance a touch device can produce.
  vel.y -= uScrollVelocity * uDrift * 2.0;

  // Gentle buoyancy that grows through the chapter.
  vel.y += uDrift * 0.25 * uProgress;

  pos += vel * uDelta;

  // Wrap inside the box so the field never empties out.
  pos = mod(pos + uBounds, 2.0 * uBounds) - uBounds;

  gl_FragColor = vec4(pos, phase);
}
`;

/**
 * Points vertex shader. `uUseSimTexture` is 0 until a real `compute()` has
 * run (and stays 0 forever under reduced motion), in which case the mote sits
 * at its static seed position — that is the "settled pose".
 */
export const pollenRenderVertexShader = /* glsl */ `
attribute vec2 aUv;
uniform sampler2D uSeedTexture;
uniform sampler2D uPositionTexture;
uniform float uUseSimTexture;
uniform float uPointSize;
varying float vPhase;

void main() {
  vec4 seed = texture2D(uSeedTexture, aUv);
  vec4 simulated = texture2D(uPositionTexture, aUv);
  vec3 p = mix(seed.xyz, simulated.xyz, uUseSimTexture);
  vPhase = seed.w;

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uPointSize * (0.6 + 0.8 * vPhase) * (300.0 / max(-mvPosition.z, 1.0));
  gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * Soft round sprite. The falloff constants are shader math (sprite shape),
 * not palette values — same exemption `rig.ts`'s `buildBrew` documents.
 */
export const pollenRenderFragmentShader = /* glsl */ `
uniform vec3 uColorCore;
uniform vec3 uColorHalo;
uniform float uOpacity;
varying float vPhase;

void main() {
  vec2 centered = gl_PointCoord - 0.5;
  float d = length(centered);
  if (d > 0.5) discard;
  float alpha = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(mix(uColorCore, uColorHalo, vPhase), alpha * uOpacity);
}
`;

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export interface PollenFieldOptions {
  /** Requested mote count. Omitted means "whatever the tier affords". */
  count?: number;
  /** Verdict from `detectFloatSupport(gl)` — call it WITHOUT `linearFilter`. */
  support: FloatSupport;
  quality: QualityTier;
  reducedMotion: boolean;
}

export interface PollenUpdateContext {
  /**
   * Render-to-texture seam. `null` whenever the caller has no renderer to
   * lend this frame; the GPU path then holds its last pose instead of
   * stepping, which is correct and never throws.
   */
  renderer: GpgpuRenderer | null;
  /** Chapter progress 0..1. Defaults to 0. */
  progress?: number;
  /** Normalized viewport pointer, -1..1 on both axes. Defaults to the origin. */
  pointer?: { x: number; y: number };
  /** Scroll velocity in px/s, signed. Defaults to 0. */
  scrollVelocity?: number;
}

/** Longest step the sim will take, so a backgrounded tab cannot explode it. */
const MAX_STEP = 1 / 20;
/** Scroll speed (px/s) that saturates the scroll force. */
export const SCROLL_VELOCITY_REFERENCE = 2000;
const POINTER_DAMP = 5;
const SCROLL_DAMP = 3.5;
const CURL_SCALE = 0.004;
const DRIFT = 26;
const POINTER_STRENGTH = 90;
const POINT_SIZE = 7;
/** Radius of a CPU-path mote, in scene units. */
export const POLLEN_MOTE_RADIUS = 3.6;

const CORE_COLOR = new THREE.Color(glPalette.amber);
const HALO_COLOR = new THREE.Color(glPalette.keyWarm);

/**
 * A field of drifting pollen motes. Dependency-injected: it never touches a
 * live `WebGLRenderer`, a canvas or any global — the capability verdict comes
 * in through the constructor and the render-to-texture seam through
 * `update()`, which is what makes the whole thing exercisable in jsdom.
 */
export class PollenField {
  /** Add this to the scene graph; remove it before `dispose()`. */
  readonly object3d: THREE.Group;
  readonly path: PollenPath;
  readonly count: number;
  readonly simSize: number;
  readonly support: FloatSupport;
  readonly quality: QualityTier;
  readonly reducedMotion: boolean;

  /** GPU path only. `null` on the CPU path and under reduced motion. */
  readonly gpgpu: Gpgpu | null = null;
  /** GPU path only. */
  readonly points: THREE.Points | null = null;
  /** GPU path only. */
  readonly seedTexture: THREE.DataTexture | null = null;
  /** GPU path only; `null` under reduced motion (nothing to simulate). */
  readonly simulationMaterial: THREE.ShaderMaterial | null = null;
  /** CPU path only. */
  readonly motes: THREE.InstancedMesh | null = null;

  private readonly seeds: Float32Array;
  private readonly renderMaterial: THREE.ShaderMaterial | null = null;
  private readonly moteMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly scratch = new THREE.Matrix4();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3();

  private elapsed = 0;
  private pointerX = 0;
  private pointerY = 0;
  private scrollPush = 0;
  private progress = 0;
  private disposed = false;

  constructor(options: PollenFieldOptions) {
    const budget = resolvePollenBudget(options);

    this.path = budget.path;
    this.count = budget.count;
    this.simSize = budget.simSize;
    this.support = options.support;
    this.quality = options.quality;
    this.reducedMotion = options.reducedMotion;
    this.seeds = buildPollenSeeds(budget.count);

    this.object3d = new THREE.Group();
    this.object3d.name = "origin-film-pollen";

    if (this.path === "gpu") {
      const seedTexture = new THREE.DataTexture(
        this.seeds,
        this.simSize,
        this.simSize,
        THREE.RGBAFormat,
        THREE.FloatType,
      );
      seedTexture.minFilter = THREE.NearestFilter;
      seedTexture.magFilter = THREE.NearestFilter;
      seedTexture.needsUpdate = true;
      this.seedTexture = seedTexture;

      // A frozen field has nothing to simulate: skip the two float render
      // targets entirely and render the static seed pose.
      if (!this.reducedMotion) {
        this.simulationMaterial = new THREE.ShaderMaterial({
          uniforms: {
            uTexture: { value: null }, // bound by Gpgpu.compute()
            uSeedTexture: { value: seedTexture },
            uTime: { value: 0 },
            uDelta: { value: 0 },
            uFirstFrame: { value: 1 },
            uCurlScale: { value: CURL_SCALE },
            uDrift: { value: DRIFT },
            uPointerStrength: { value: POINTER_STRENGTH },
            uScrollVelocity: { value: 0 },
            uProgress: { value: 0 },
            uPointer: { value: new THREE.Vector2(0, 0) },
            uBounds: {
              value: new THREE.Vector3(POLLEN_BOUNDS.x, POLLEN_BOUNDS.y, POLLEN_BOUNDS.z),
            },
          },
          vertexShader: pollenSimulationVertexShader,
          fragmentShader: `${simplex3d}\n${curlNoise}\n${pollenSimulationFragmentShader}`,
        });

        this.gpgpu = new Gpgpu({
          width: this.simSize,
          height: this.simSize,
          simulationMaterial: this.simulationMaterial,
          support: options.support,
        });
      }

      this.renderMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uSeedTexture: { value: seedTexture },
          uPositionTexture: { value: seedTexture },
          uUseSimTexture: { value: 0 },
          uPointSize: { value: POINT_SIZE },
          uOpacity: { value: 0 },
          uColorCore: { value: CORE_COLOR.clone() },
          uColorHalo: { value: HALO_COLOR.clone() },
        },
        vertexShader: pollenRenderVertexShader,
        fragmentShader: pollenRenderFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(this.count * 3), 3),
      );
      geometry.setAttribute("aUv", buildSimUvAttribute(this.simSize));
      geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, 0, 0),
        Math.hypot(POLLEN_BOUNDS.x, POLLEN_BOUNDS.y, POLLEN_BOUNDS.z),
      );

      const points = new THREE.Points(geometry, this.renderMaterial);
      points.name = "origin-film-pollen-points";
      // Positions live in the shader, so the CPU-side bounds are a lie the
      // frustum culler must not act on.
      points.frustumCulled = false;
      this.points = points;
      this.object3d.add(points);
    } else {
      this.moteMaterial = new THREE.MeshBasicMaterial({
        color: CORE_COLOR.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const motes = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(POLLEN_MOTE_RADIUS, 0),
        this.moteMaterial,
        this.count,
      );
      motes.name = "origin-film-pollen-motes";
      motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      motes.frustumCulled = false;
      this.motes = motes;
      this.object3d.add(motes);

      // Write the resting pose immediately, so the field is correct even if
      // update() is never called (reduced motion, or a paused view).
      this.writeCpuPose();
    }
  }

  /** Simulated seconds consumed so far. Frozen under reduced motion. */
  get time(): number {
    return this.elapsed;
  }

  /** Current field opacity, derived from the last `progress` seen. */
  get opacity(): number {
    return pollenOpacityForProgress(this.progress);
  }

  update(dt: number, ctx: PollenUpdateContext): void {
    if (this.disposed) return;

    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, MAX_STEP);
    this.progress = clamp(ctx.progress ?? 0, 0, 1);
    this.applyOpacity(pollenOpacityForProgress(this.progress));

    // Reduced motion: presence still tracks the user's own scrolling, but the
    // pose never moves again.
    if (this.reducedMotion) return;

    const pointer = ctx.pointer ?? { x: 0, y: 0 };
    this.pointerX = damp(this.pointerX, clamp(pointer.x, -1, 1), POINTER_DAMP, step);
    this.pointerY = damp(this.pointerY, clamp(pointer.y, -1, 1), POINTER_DAMP, step);
    this.scrollPush = damp(
      this.scrollPush,
      clamp((ctx.scrollVelocity ?? 0) / SCROLL_VELOCITY_REFERENCE, -1, 1),
      SCROLL_DAMP,
      step,
    );

    if (this.path === "gpu") {
      this.stepGpu(step, ctx.renderer);
    } else {
      this.elapsed += step;
      this.writeCpuPose();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.object3d.clear();

    // Gpgpu.dispose() frees its own ping-pong targets and quad geometry, but
    // not the simulation material we handed it.
    this.gpgpu?.dispose();
    this.simulationMaterial?.dispose();
    this.seedTexture?.dispose();

    if (this.points) {
      this.points.geometry.dispose();
    }
    this.renderMaterial?.dispose();

    if (this.motes) {
      this.motes.geometry.dispose();
      this.motes.dispose();
    }
    this.moteMaterial?.dispose();
  }

  private applyOpacity(value: number): void {
    if (this.renderMaterial) {
      this.renderMaterial.uniforms.uOpacity!.value = value;
    }
    if (this.moteMaterial) {
      this.moteMaterial.opacity = value;
    }
  }

  private stepGpu(step: number, renderer: GpgpuRenderer | null): void {
    const gpgpu = this.gpgpu;
    const sim = this.simulationMaterial;
    const render = this.renderMaterial;
    if (!gpgpu || !sim || !render || !renderer) return;

    this.elapsed += step;

    sim.uniforms.uTime!.value = this.elapsed;
    sim.uniforms.uDelta!.value = step;
    sim.uniforms.uProgress!.value = this.progress;
    sim.uniforms.uScrollVelocity!.value = this.scrollPush;
    (sim.uniforms.uPointer!.value as THREE.Vector2).set(this.pointerX, this.pointerY);

    gpgpu.compute(renderer);

    sim.uniforms.uFirstFrame!.value = 0;
    render.uniforms.uPositionTexture!.value = gpgpu.read.texture;
    render.uniforms.uUseSimTexture!.value = 1;
  }

  /** Analytic drift — see the header note on why this is not integrated. */
  private writeCpuPose(): void {
    const motes = this.motes;
    if (!motes) return;

    const t = this.elapsed;
    const pointerWorldX = this.pointerX * POLLEN_BOUNDS.x;
    const pointerWorldY = this.pointerY * POLLEN_BOUNDS.y;

    for (let i = 0; i < this.count; i += 1) {
      const baseX = this.seeds[i * 4]!;
      const baseY = this.seeds[i * 4 + 1]!;
      const baseZ = this.seeds[i * 4 + 2]!;
      const phase = this.seeds[i * 4 + 3]!;
      const a = phase * Math.PI * 2;

      let x =
        baseX +
        Math.sin(t * 0.31 + a) * POLLEN_BOUNDS.x * 0.06 +
        Math.cos(t * 0.17 + a * 1.7) * POLLEN_BOUNDS.x * 0.03;
      let y = baseY + Math.cos(t * 0.23 + a * 1.3) * POLLEN_BOUNDS.y * 0.07;
      const z = baseZ + Math.sin(t * 0.19 + a * 0.7) * POLLEN_BOUNDS.z * 0.05;

      // Pointer repulsion, the cheap equivalent of the sim pass's force.
      const dx = x - pointerWorldX;
      const dy = y - pointerWorldY;
      const dist = Math.hypot(dx, dy) || 1e-4;
      const falloff = 1 - clamp(dist / (POLLEN_BOUNDS.x * 0.55), 0, 1);
      const push = falloff * falloff * POLLEN_BOUNDS.x * 0.12;
      x += (dx / dist) * push;
      y += (dy / dist) * push;

      // Scroll velocity, and the same buoyancy the sim pass applies.
      y -= this.scrollPush * POLLEN_BOUNDS.y * 0.06 * (0.5 + phase);
      y += this.progress * POLLEN_BOUNDS.y * 0.05 * phase;

      const scale = 0.6 + 0.8 * phase;
      this.scratchPosition.set(x, y, z);
      this.scratchScale.set(scale, scale, scale);
      this.scratch.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
      motes.setMatrixAt(i, this.scratch);
    }

    motes.instanceMatrix.needsUpdate = true;
  }
}

/** Per-mote texel address into the square simulation texture. */
function buildSimUvAttribute(size: number): THREE.BufferAttribute {
  const uv = new Float32Array(size * size * 2);
  for (let iy = 0; iy < size; iy += 1) {
    for (let ix = 0; ix < size; ix += 1) {
      const i = iy * size + ix;
      uv[i * 2] = (ix + 0.5) / size;
      uv[i * 2 + 1] = (iy + 0.5) / size;
    }
  }
  return new THREE.BufferAttribute(uv, 2);
}
