// lib/engine/gl/shaders/riso.ts
//
// Risograph-print grain as a `postprocessing` Effect, plus the pure policy
// that decides whether it may run at all.
//
// What it simulates (and what it deliberately isn't): a riso drum lays ink
// down through a coarse screen onto uncoated paper, one drum per colour, and
// the paper shifts a hair between drums. So this is *coverage* noise —
// quantised ink cells, a slow blotchy unevenness underneath them, a fixed
// paper-fibre tooth, and a per-channel misregistration offset — modulating
// the incoming colour multiplicatively. It is NOT an additive white-noise
// film-grain overlay; nothing here samples per-pixel hash noise.
//
// THE NON-OBVIOUS DECISION: the grain clock is *quantised*, not continuous.
// The shader uses `floor(uTime * uSpeed)` as the noise's third axis, so the
// grain re-rolls in discrete steps (default 8/s, the "boil" rate of hand-drawn
// animation) instead of sliding smoothly every frame. Two things fall out of
// that, both of them the point: continuous drift reads as a shimmering video
// artefact while stepped re-rolls read as successive impressions of a print,
// and "static" mode is then not a second code path — it is the same shader
// with a frozen clock (`floor(0 * uSpeed) == 0`), which is why reduced motion
// keeps the texture instead of losing it. See `risoGrainMode` for the policy.
//
// Testability: `postprocessing`'s EffectComposer hard-requires a real
// WebGLRenderer (see gl/post.ts's header), so — exactly as `shouldEnablePost`
// is factored out there — the policy, the fragment-shader source, the uniform
// defaults, and the low-tier fallback descriptor are all plain data/pure
// functions exported independently of the class.
//
// Namespacing caveat for whoever wires this up: `postprocessing` only renames
// an effect's `mainImage`/`mainUv`/`mainSupport` when it merges effect sources
// into one pass. Helper functions (`simplex3d`, `fbm`, `risoInk`) land in the
// merged global scope, so this effect must not share an `EffectPass` with
// another effect that also concatenates gl/shaders/noise.ts.

import { Uniform, Vector2 } from "three";
import type { WebGLRenderer, WebGLRenderTarget } from "three";
import { BlendFunction, Effect } from "postprocessing";
import type { QualityTier } from "../../types";
import { fbm, simplex3d } from "./noise";
import {
  shouldAnimateRisoGrain,
  shouldEnableRisoGrain,
  type RisoGrainPolicyInput,
} from "./riso-policy";

// The pure policy + the DOM fallback descriptor live in ./riso-policy so a
// component can import them without dragging three/postprocessing (and so the
// whole GL graph) into a route's first-load JS. Re-exported here so every
// existing importer of this module keeps working unchanged.
export {
  RISO_GRAIN_ROUTE,
  RISO_GRAIN_FALLBACK,
  buildRisoGrainFallback,
  isRisoGrainRoute,
  risoGrainMode,
  shouldAnimateRisoGrain,
  shouldEnableRisoGrain,
  type RisoGrainFallback,
  type RisoGrainFallbackOptions,
  type RisoGrainMode,
  type RisoGrainPolicyInput,
} from "./riso-policy";

/* -------------------------------------------------------------------------- */
/* Uniform defaults                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Tuned for a coarse print look at 1x–2x DPR. `scale` is the ink-cell edge in
 * device pixels — anything below ~1.5 stops reading as a screen and starts
 * reading as video noise, which is the exact failure mode this effect exists
 * to avoid.
 */
export const RISO_GRAIN_DEFAULTS = {
  /** Overall coverage deviation, 0..1. */
  intensity: 0.28,
  /** Ink-cell edge length in device px (coarse; >= 1.5). */
  scale: 2.4,
  /** Per-channel paper shift in device px. Subtle: fractions of a pixel to a couple. */
  misregistration: 0.9,
  /** Fixed paper-fibre contribution, 0..1. Never animated. */
  paperTooth: 0.35,
  /** Grain re-rolls per second (the stepped "boil"). */
  speed: 8,
} as const;

export type RisoGrainDefaults = typeof RISO_GRAIN_DEFAULTS;

/**
 * Every uniform `RisoGrainEffect` owns and writes, in declaration order.
 * `test/engine/gl/riso.test.ts` parses the shader source and asserts this list
 * matches it exactly, so a uniform can never be set-but-undeclared.
 */
export const RISO_GRAIN_UNIFORM_NAMES = [
  "uTime",
  "uIntensity",
  "uScale",
  "uMisregistration",
  "uPaperTooth",
  "uSpeed",
  "uResolution",
] as const;

export type RisoGrainUniformName = (typeof RISO_GRAIN_UNIFORM_NAMES)[number];

/* -------------------------------------------------------------------------- */
/* Fragment shader source                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `void mainImage(const in vec4, const in vec2, out vec4)` plus the shared
 * simplex/fbm chunks from `./noise`. Exported as a string so it is assertable
 * without a GL context.
 */
export const RISO_GRAIN_FRAGMENT_SHADER = /* glsl */ `
${simplex3d}
${fbm}

uniform float uTime;
uniform float uIntensity;
uniform float uScale;
uniform float uMisregistration;
uniform float uPaperTooth;
uniform float uSpeed;
uniform vec2 uResolution;

// Ink coverage for one drum pass, sampled at a misregistered offset.
// "cell" quantises the sample point to the drum's screen, which is what makes
// the grain coarse and clumpy rather than per-pixel; "blotch" is the slow
// unevenness of the drum itself, at 12x the cell size.
float risoInk(vec2 px, vec2 offsetPx, float t) {
  float cellSize = max(uScale, 1.5);
  vec2 p = px + offsetPx;
  vec2 cell = floor(p / cellSize) + 0.5;
  float speckle = simplex3d(vec3(cell * 0.41, t));
  float blotch = simplex3d(vec3(p / (cellSize * 12.0), t * 0.25));
  return speckle * 0.7 + blotch * 0.3;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 px = uv * uResolution;

  // Stepped clock: the grain re-rolls uSpeed times a second and holds in
  // between. uTime is frozen at 0 in static mode, which pins t at 0.
  float t = floor(uTime * max(uSpeed, 0.0));

  // Paper tooth is a property of the sheet, so its noise axis is a constant:
  // the fibres never move, no matter what the clock does.
  float tooth = fbm(vec3(px * 0.035, 17.0)) * uPaperTooth;

  // Three drums, three slightly different paper positions, 120 degrees apart.
  vec2 dR = vec2(0.8660, 0.5000) * uMisregistration;
  vec2 dG = vec2(-0.8660, 0.5000) * uMisregistration;
  vec2 dB = vec2(0.0, -1.0) * uMisregistration;

  vec3 ink = vec3(
    risoInk(px, dR, t),
    risoInk(px, dG, t + 5.0),
    risoInk(px, dB, t + 11.0)
  );

  // Coverage multiplier around 1.0: above it the drum over-inked, below it the
  // paper shows through. Tooth biases the whole sheet toward showing through.
  vec3 coverage = 1.0 + (ink - tooth) * uIntensity;

  // Real riso grain is invisible in paper-white and in solid ink, and loudest
  // through the mid-tones where coverage is partial.
  float lum = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float midtone = 1.0 - abs(lum * 2.0 - 1.0);
  coverage = mix(vec3(1.0), coverage, clamp(midtone + 0.25, 0.0, 1.0));

  outputColor = vec4(clamp(inputColor.rgb * coverage, 0.0, 1.0), inputColor.a);
}
`;

/* -------------------------------------------------------------------------- */
/* The effect                                                                 */
/* -------------------------------------------------------------------------- */

export interface RisoGrainOptions {
  intensity?: number;
  scale?: number;
  misregistration?: number;
  paperTooth?: number;
  speed?: number;
  /** `false` freezes the clock at 0 (reduced-motion / `"static"` mode). Default `true`. */
  animated?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Riso ink grain as a single `postprocessing` Effect. Owns no GPU resources of
 * its own beyond its uniforms, so `Effect.dispose()` is sufficient.
 */
export class RisoGrainEffect extends Effect {
  private elapsed = 0;
  private animate: boolean;

  constructor(opts: RisoGrainOptions = {}) {
    super("RisoGrainEffect", RISO_GRAIN_FRAGMENT_SHADER, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ["uTime", new Uniform(0)],
        ["uIntensity", new Uniform(clamp(opts.intensity ?? RISO_GRAIN_DEFAULTS.intensity, 0, 1))],
        ["uScale", new Uniform(clamp(opts.scale ?? RISO_GRAIN_DEFAULTS.scale, 1.5, 64))],
        [
          "uMisregistration",
          new Uniform(clamp(opts.misregistration ?? RISO_GRAIN_DEFAULTS.misregistration, 0, 8)),
        ],
        ["uPaperTooth", new Uniform(clamp(opts.paperTooth ?? RISO_GRAIN_DEFAULTS.paperTooth, 0, 1))],
        ["uSpeed", new Uniform(clamp(opts.speed ?? RISO_GRAIN_DEFAULTS.speed, 0, 60))],
        ["uResolution", new Uniform(new Vector2(1, 1))],
      ]),
    });
    this.animate = opts.animated ?? true;
  }

  private num(name: RisoGrainUniformName): Uniform<number> {
    return this.uniforms.get(name) as Uniform<number>;
  }

  /** Seconds of grain clock accumulated so far. Frozen at 0 while not animated. */
  get time(): number {
    return this.elapsed;
  }

  /** Is the clock advancing? `false` == the reduced-motion static print. */
  get animated(): boolean {
    return this.animate;
  }

  /**
   * Turning animation off rewinds the clock to 0 rather than holding the
   * current phase, so a mid-session `prefers-reduced-motion` change lands on
   * the same deterministic still frame every time.
   */
  setAnimated(animated: boolean): void {
    this.animate = animated;
    if (!animated) {
      this.elapsed = 0;
      this.num("uTime").value = 0;
    }
  }

  setIntensity(value: number): void {
    this.num("uIntensity").value = clamp(value, 0, 1);
  }

  setScale(value: number): void {
    this.num("uScale").value = clamp(value, 1.5, 64);
  }

  setMisregistration(value: number): void {
    this.num("uMisregistration").value = clamp(value, 0, 8);
  }

  setPaperTooth(value: number): void {
    this.num("uPaperTooth").value = clamp(value, 0, 1);
  }

  setSpeed(value: number): void {
    this.num("uSpeed").value = clamp(value, 0, 60);
  }

  /** Device-pixel backbuffer size; the composer calls this on every resize. */
  override setSize(width: number, height: number): void {
    (this.uniforms.get("uResolution") as Uniform<Vector2>).value.set(width, height);
  }

  override update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime = 0): void {
    if (!this.animate) return;
    this.elapsed += Number.isFinite(deltaTime) ? Math.max(deltaTime, 0) : 0;
    this.num("uTime").value = this.elapsed;
  }
}

/**
 * Dependency-injected constructor: hands back a configured effect for the two
 * GPU modes and `null` for `"fallback"`/`"off"`, so a caller never has to
 * re-derive the policy. `opts.animated` is ignored — the policy owns that.
 */
export function createRisoGrainEffect(
  input: RisoGrainPolicyInput,
  opts: RisoGrainOptions = {}
): RisoGrainEffect | null {
  if (!shouldEnableRisoGrain(input)) return null;
  return new RisoGrainEffect({ ...opts, animated: shouldAnimateRisoGrain(input) });
}

/* -------------------------------------------------------------------------- */
/* Low-tier CSS/SVG fallback descriptor                                       */
/* -------------------------------------------------------------------------- */
