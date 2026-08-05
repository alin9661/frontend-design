// lib/scenes/particles/scene.ts
//
// M2 "particles" scene (design doc §5 row 3): a curl-noise steam/energy
// field rising out of a can-silhouette region, additively blended, sized by
// DPR, ramping forest (#1D423C) -> lemon (#F2C94C) and speeding up as scroll
// progress advances, plus an MSDF/SDF section title. Default export is a
// FACTORY (`() => SceneModule`), matching lib/scenes/placeholder/scene.ts's
// convention — scene-registry.ts calls it once per view.
//
// --- CONTRACT GAP: gl/gpgpu.ts's ping-pong FBOs need a GpgpuRenderer, which
// ViewContext does not provide -----------------------------------------------
// The spec for this scene calls for driving particle motion through
// gl/gpgpu.ts's ping-pong FBOs. That class's `compute(renderer)` needs a
// `GpgpuRenderer` (setRenderTarget + render — see gl/gpgpu.ts), but
// `SceneModule.update(dt, ctx: ViewContext)` — the only per-frame hook a
// scene gets — carries no renderer or renderer-like seam anywhere in
// ViewContext (checked types.ts, gl/stage.ts's `buildContext`, and both
// render.worker.ts and the main-thread host: Stage owns the `RendererLike`
// privately and never threads it down to individual views). This isn't
// specific to particles — ANY M2/M3 scene that wants to render-to-texture
// (gpgpu-based sims, procedural label textures baked at runtime, etc.) hits
// the same wall. Two ways to close it that I could see, neither of which is
// mine to make (my file list is lib/scenes/particles/** +
// components/deep-wave/SectionParticles.tsx + test/scenes/particles.test.ts):
//   1. Add `renderer: RendererLike` (or a narrower GpgpuRenderer-shaped
//      field) to ViewContext and have Stage.buildContext pass its own
//      renderer through. Cleanest, but touches the frozen types.ts + owned
//      gl/stage.ts.
//   2. Scenes spin up their OWN auxiliary OffscreenCanvas + WebGLRenderer
//      (the "canvases via new OffscreenCanvas when available" note in the
//      M2 task briefing) purely for compute. Works with zero shared-contract
//      changes, but burns a second real WebGL context per view — wasteful
//      for something Stage's existing renderer could already do, and a
//      real budget risk against the "≤2 views rendered mid-scroll" target
//      if more than one scene does this.
//
// Given that, this scene ships two coexisting layers so it's fully
// functional today AND ready to light up the moment (1) lands:
//   - `computeSim(renderer)` is a real, tested, spec-following gpgpu
//     ping-pong pass (see shaders.ts's `simulationFragmentShader`) — public
//     on the class (beyond the SceneModule interface, so nothing calls it
//     yet) and exercised directly in test/scenes/particles.test.ts with a
//     GpgpuRenderer mock, same pattern as test/engine/gl/gpgpu.test.ts.
//     `update()` also opportunistically calls it if `ctx` ever grows a
//     `renderer` field, so wiring (1) up needs no further change here.
//   - The render shader's DEFAULT, always-on path (`renderVertexShader`'s
//     `analyticSample`) computes each particle's position straight from its
//     seed + `uTime` + curl noise, entirely on the GPU, with no texture
//     feedback loop and therefore no renderer dependency at all. This is
//     what actually animates on screen until (1)/(2) is resolved upstream.
//
// --- Text contract friction --------------------------------------------------
// `loadFont`/`GlText` (owner: text workstream) are consumed verbatim from
// "@/lib/engine/gl/text", per the M2 task briefing, exactly like
// lib/scenes/exploded/scene.ts consumes hero-can's `buildCan` — that module
// doesn't exist in this workspace yet (mid-parallel-build), so this import
// is expected to fail `tsc --noEmit` and any real bundling until the text
// workstream lands; test/scenes/particles.test.ts mocks it the same way
// test/scenes/exploded.test.ts mocks can-geometry. One more latent risk
// worth flagging: `loadFont(assets)` takes the *shared* ViewContext
// AssetManager, and gl/assets.ts's `add()` throws if called after
// `start()` — render.worker.ts's `handleInit` already calls
// `assets.start()` (with zero jobs, synchronously) before any VIEW_ADD can
// arrive, so if the text workstream's `loadFont` internally calls
// `assets.add(...)`, it will throw for every M2 scene that reaches this
// point once wired end-to-end, not just this one. Not something I can fix
// from these files, but worth surfacing loudly since it'll otherwise look
// like an intermittent particles-only bug.
// -----------------------------------------------------------------------------

import * as THREE from "three";
import type { QualityTier, SceneModule, ViewContext } from "@/lib/engine/types";
import { clamp, mapRange, smoothstep } from "@/lib/engine/core/math";
import { Gpgpu, type GpgpuRenderer } from "@/lib/engine/gl/gpgpu";
import { simplex3d, curlNoise } from "@/lib/engine/gl/shaders/noise";
import { loadFont, GlText } from "@/lib/engine/gl/text";
import {
  simulationVertexShader,
  simulationFragmentShader,
  renderVertexShader,
  renderFragmentShader,
} from "./shaders";

/** Particle grid side by quality tier — design doc: "counts ... 128²/256²/512²". */
export const PARTICLE_GRID_SIZE: Record<QualityTier, number> = {
  low: 128,
  medium: 256,
  high: 512,
};

export function gridSizeForQuality(tier: QualityTier): number {
  return PARTICLE_GRID_SIZE[tier];
}

export function particleCountForQuality(tier: QualityTier): number {
  const grid = gridSizeForQuality(tier);
  return grid * grid;
}

/** Brand color ramp endpoints (design doc §5: "forest #1D423C → lemon #F2C94C"). */
export const FLOW_COLOR_FOREST = new THREE.Color(0x1d423c);
export const FLOW_COLOR_LEMON = new THREE.Color(0xf2c94c);

/**
 * Pure: scroll progress (0..1, clamped) -> the forest->lemon ramp color.
 *
 * Motion-audit fix P4: `p` used to feed the lerp directly (linear), so the
 * ramp started moving the instant progress ticked off 0 and kept moving
 * right up to 1 — no settled moment at either section edge. Smoothstepping
 * `p` first holds the forest/lemon endpoints for a beat at the edges and
 * concentrates the actual color travel (and, in `flowSpeedForProgress`
 * below, the speed change) through the middle of the span, eased in and
 * out rather than at a constant rate throughout.
 */
export function colorRampForProgress(p: number): THREE.Color {
  const t = smoothstep(clamp(p, 0, 1));
  return new THREE.Color().lerpColors(FLOW_COLOR_FOREST, FLOW_COLOR_LEMON, t);
}

export const BASE_FLOW_SPEED = 30; // local units/s at progress 0
export const MAX_FLOW_SPEED = 110; // local units/s at progress 1

/** Pure: scroll progress (0..1, clamped) -> rise speed, "scroll drives flow
 * speed" — smoothstepped for the same reason as `colorRampForProgress`
 * above (P4): eases the speed change through the middle instead of ramping
 * at a constant rate across the whole span. */
export function flowSpeedForProgress(p: number): number {
  const t = smoothstep(clamp(p, 0, 1));
  return mapRange(t, 0, 1, BASE_FLOW_SPEED, MAX_FLOW_SPEED);
}

const CURL_SCALE = 0.012;
// Was 3 — a confirmed design-review finding: at 1px-scale, the (frozen,
// design-doc-mandated — see PARTICLE_GRID_SIZE below) 128²-512² particle
// counts read as dense speckle/sensor-dust rather than the intended "slow
// drift of forest fog". The render shader already draws a soft
// alpha-falloff circular sprite per particle (shaders.ts's
// renderFragmentShader), not a hard square point, so — since count itself
// is a frozen per-tier contract this scene can't change — size is the
// lever: larger sprites let individual motes actually read as soft fog
// instead of dithering artifacts.
const BASE_POINT_SIZE = 8; // px at dpr 1, before "sized by DPR"
const TITLE_TEXT = "ENERGY, RENDERED";
const TITLE_FONT_SIZE = 42;
const TITLE_OPACITY = 0.55; // caption strength — the DOM <h2> owns the words
const FOREST_HEX = 0x1d423c;
/** Shifts the particle column (not the section title, which stays over the
 * DOM headline it echoes) right of the copy/stats column — confirmed
 * design-review fix: the cloud used to sit centered directly over
 * "JITTERS DETECTED", burying it. */
const EMITTER_X_OFFSET_FACTOR = 0.22; // × ctx.rect.width

/** Reduced motion freezes the clock at a nonzero point in the cycle — a
 * plausible mid-flow moment, not everything sitting frozen at its seed. */
const STATIC_TIME = 1.7;

/**
 * Per-particle seed data (RGBA float, packed as gpgpu.ts expects): xyz is a
 * base position sampled within an elliptical column approximating a can's
 * footprint (no dependency on hero-can/can-geometry.ts — this scene doesn't
 * import it, unlike lib/scenes/exploded/scene.ts, since a rough procedural
 * column reads fine for a steam/energy effect and keeps this file
 * self-contained), w is a random 0..1 respawn phase so particles desync
 * instead of all rising/resetting in lockstep.
 */
export function buildSeedData(gridSize: number, columnRadius: number, baseY: number): Float32Array {
  const data = new Float32Array(gridSize * gridSize * 4);
  for (let iy = 0; iy < gridSize; iy++) {
    for (let ix = 0; ix < gridSize; ix++) {
      const i = (iy * gridSize + ix) * 4;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * columnRadius;
      data[i] = Math.cos(angle) * radius;
      data[i + 1] = baseY + (Math.random() - 0.5) * columnRadius * 0.3;
      data[i + 2] = Math.sin(angle) * radius * 0.6;
      data[i + 3] = Math.random();
    }
  }
  return data;
}

function buildUvAttribute(gridSize: number): THREE.BufferAttribute {
  const count = gridSize * gridSize;
  const uv = new Float32Array(count * 2);
  for (let iy = 0; iy < gridSize; iy++) {
    for (let ix = 0; ix < gridSize; ix++) {
      const i = iy * gridSize + ix;
      uv[i * 2] = (ix + 0.5) / gridSize;
      uv[i * 2 + 1] = (iy + 0.5) / gridSize;
    }
  }
  return new THREE.BufferAttribute(uv, 2);
}

class ParticlesScene implements SceneModule {
  private gridSize = 0;
  private riseHeight = 0;
  private progress = 0;
  private elapsed = 0;

  private seedTexture: THREE.DataTexture | null = null;
  private simMaterial: THREE.ShaderMaterial | null = null;
  private gpgpu: Gpgpu | null = null;

  private geometry: THREE.BufferGeometry | null = null;
  private renderMaterial: THREE.ShaderMaterial | null = null;
  private points: THREE.Points | null = null;

  private text: GlText | null = null;

  async init(ctx: ViewContext): Promise<void> {
    // Re-runnable: tear down any previous instance's resources first
    // (context-loss restore contract, per SceneModule.init's docs).
    this.dispose();

    const gridSize = gridSizeForQuality(ctx.quality);
    this.gridSize = gridSize;

    const columnRadius = Math.max(20, Math.min(ctx.rect.width, ctx.rect.height) * 0.16);
    const riseHeight = Math.max(80, ctx.rect.height * 0.55);
    this.riseHeight = riseHeight;
    const baseY = -riseHeight * 0.5;

    const seedData = buildSeedData(gridSize, columnRadius, baseY);
    this.seedTexture = new THREE.DataTexture(seedData, gridSize, gridSize, THREE.RGBAFormat, THREE.FloatType);
    this.seedTexture.minFilter = THREE.NearestFilter;
    this.seedTexture.magFilter = THREE.NearestFilter;
    this.seedTexture.needsUpdate = true;

    this.simMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null }, // bound by Gpgpu.compute() to the "read" target
        uSeedTexture: { value: this.seedTexture },
        uTime: { value: 0 },
        uDelta: { value: 0 },
        uSpeed: { value: BASE_FLOW_SPEED },
        uCurlScale: { value: CURL_SCALE },
        uRiseHeight: { value: riseHeight },
        uFirstFrame: { value: 1 },
      },
      vertexShader: simulationVertexShader,
      fragmentShader: `${simplex3d}\n${curlNoise}\n${simulationFragmentShader}`,
    });
    this.gpgpu = new Gpgpu({ width: gridSize, height: gridSize, simulationMaterial: this.simMaterial });

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(gridSize * gridSize * 3), 3)
    );
    this.geometry.setAttribute("aUv", buildUvAttribute(gridSize));

    const dpr = ctx.size.dpr || 1;
    this.elapsed = ctx.reducedMotion ? STATIC_TIME : 0;
    const initialProgress = clamp(this.progress, 0, 1);

    this.renderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSeedTexture: { value: this.seedTexture },
        uPositionTexture: { value: null },
        uUseSimTexture: { value: 0 },
        uTime: { value: this.elapsed },
        uCurlScale: { value: CURL_SCALE },
        uSpeed: { value: flowSpeedForProgress(initialProgress) },
        uRiseHeight: { value: riseHeight },
        uPointSize: { value: BASE_POINT_SIZE * dpr },
        uColor: { value: colorRampForProgress(initialProgress) },
      },
      vertexShader: `${simplex3d}\n${curlNoise}\n${renderVertexShader}`,
      fragmentShader: renderFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.renderMaterial);
    this.points.frustumCulled = false;
    this.points.position.x = ctx.rect.width * EMITTER_X_OFFSET_FACTOR;
    ctx.scene.add(this.points);

    // Text is the one async tail: everything above runs synchronously (JS
    // only yields at this `await`), so onProgress()/update() can safely
    // touch sim/render uniforms immediately after init() is *called*, even
    // while this promise is still pending on font loading.
    const font = await loadFont(ctx.assets);
    this.text = new GlText(font, {
      text: TITLE_TEXT,
      fontSize: TITLE_FONT_SIZE,
      color: FOREST_HEX,
      align: "center",
      glow: 0.4,
      opacity: TITLE_OPACITY,
    });
    // Caption the plume, don't duplicate the headline (design-review F-001):
    // this used to sit at x=0 — the view's center — which planted it on top
    // of SectionParticles' DOM <h2> in the left copy column. It now rides
    // the emitter column (same X offset as the points cloud) as a softened
    // caption above the plume crest.
    this.text.object3d.position.set(
      ctx.rect.width * EMITTER_X_OFFSET_FACTOR,
      riseHeight * 0.55 + TITLE_FONT_SIZE,
      0
    );
    ctx.scene.add(this.text.object3d);
  }

  update(dt: number, ctx: ViewContext): void {
    if (!this.simMaterial || !this.renderMaterial) return;
    if (ctx.reducedMotion) return; // static pre-simulated frame — no per-frame work

    this.elapsed += dt;
    const dpr = ctx.size.dpr || 1;

    this.simMaterial.uniforms.uTime!.value = this.elapsed;
    this.simMaterial.uniforms.uDelta!.value = dt;

    this.renderMaterial.uniforms.uTime!.value = this.elapsed;
    this.renderMaterial.uniforms.uPointSize!.value = BASE_POINT_SIZE * dpr;

    // Opportunistic GPGPU enhancement — see the file header's contract-gap
    // note. `renderer` is never present today (ViewContext doesn't carry
    // one), so this is a no-op until that's resolved upstream.
    const renderer = (ctx as ViewContext & { renderer?: GpgpuRenderer }).renderer;
    if (renderer) this.computeSim(renderer);
  }

  onProgress(p: number): void {
    this.progress = clamp(p, 0, 1);
    const speed = flowSpeedForProgress(this.progress);
    const color = colorRampForProgress(this.progress);

    if (this.simMaterial) this.simMaterial.uniforms.uSpeed!.value = speed;
    if (this.renderMaterial) {
      this.renderMaterial.uniforms.uSpeed!.value = speed;
      this.renderMaterial.uniforms.uColor!.value = color;
    }
  }

  /**
   * Runs one real gpgpu ping-pong step (design doc: "using gl/gpgpu.ts
   * ping-pong FBOs") and, once it's run at least once, switches the render
   * shader over from the analytic fallback to the simulated position
   * texture. Public beyond the SceneModule interface on purpose — see the
   * file header's contract-gap note for who's meant to call this and why
   * `update()` can't yet.
   */
  computeSim(renderer: GpgpuRenderer): void {
    if (!this.gpgpu || !this.simMaterial || !this.renderMaterial) return;
    this.gpgpu.compute(renderer);
    this.simMaterial.uniforms.uFirstFrame!.value = 0;
    this.renderMaterial.uniforms.uPositionTexture!.value = this.gpgpu.read.texture;
    this.renderMaterial.uniforms.uUseSimTexture!.value = 1;
  }

  dispose(): void {
    if (this.points) this.points.parent?.remove(this.points);
    this.geometry?.dispose();
    this.renderMaterial?.dispose();
    this.simMaterial?.dispose();
    this.gpgpu?.dispose();
    this.seedTexture?.dispose();

    if (this.text) {
      this.text.object3d.parent?.remove(this.text.object3d);
      this.text.dispose();
    }

    this.points = null;
    this.geometry = null;
    this.renderMaterial = null;
    this.simMaterial = null;
    this.gpgpu = null;
    this.seedTexture = null;
    this.text = null;

    this.gridSize = 0;
    this.riseHeight = 0;
    this.elapsed = 0;
    // NOTE: `progress` deliberately survives dispose() — a re-init after
    // context-loss restore should resume ramped-up at the current scroll
    // position, not snap back to the forest end of the color ramp.
  }
}

export function createParticlesScene(): SceneModule {
  return new ParticlesScene();
}

export default createParticlesScene;
