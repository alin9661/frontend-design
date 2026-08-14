// lib/engine/gl/post.ts
//
// One shared EffectComposer per canvas: RenderPass -> EffectPass(Bloom
// mipmap half-res, SMAA) -> EffectPass(riso grain). Disabled on the "low"
// quality tier and under reduced motion (design doc §4 gl/post.ts, §6 a11y —
// "bloom off, auto-anims off").
//
// WHAT A COMPOSER CAN AND CANNOT DO HERE. A composer is bound to exactly one
// (scene, camera) pair and owns the whole drawing buffer: its passes are
// fullscreen quads and its clears are fullscreen. Stage renders N views into
// N scissor rectangles of one canvas, so a composer can only ever serve ONE
// of them, and only when that view covers the canvas — see gl/stage.ts's
// `resolvePostView()` for the gate that enforces exactly that. What this
// class contributes to making that workable is `setSceneCamera()`: the
// composer is re-pointed at the active view's scene/camera each frame
// instead of being rebuilt.
//
// `postprocessing`'s EffectComposer hard-requires a renderer that answers
// `getSize`/`getDrawingBufferSize`/`getContext` the moment it is constructed
// or a pass is added — it never touches GL itself until `render()`, so the
// `PostLike` seam below is what Stage depends on, and tests drive the real
// class through a recording fake renderer (there is still no way to call
// `render()` for real without a GPU).

import * as THREE from "three";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
} from "postprocessing";
import type { QualityTier } from "../types";
import {
  createRisoGrainEffect,
  shouldAnimateRisoGrain,
  type RisoGrainEffect,
  type RisoGrainOptions,
} from "./shaders/riso";

/** Pure: matches design doc "disabled on low tier + reduced motion". */
export function shouldEnablePost(quality: QualityTier, reducedMotion: boolean): boolean {
  return quality !== "low" && !reducedMotion;
}

export interface PostOptions {
  bloomIntensity?: number;
  bloomThreshold?: number;
  reducedMotion?: boolean;
  quality?: QualityTier;
  /**
   * The page route, for gl/shaders/riso.ts's route gate (`risoGrainMode`).
   * OMITTING it means "I do not know where I am" and yields no grain at all —
   * note this is NOT the same as passing `""`, which riso.ts normalises to
   * `"/"` and therefore DOES get grain. A caller that cannot name its route
   * must leave this unset rather than pass an empty string.
   */
  route?: string;
  /** Tuning forwarded to `RisoGrainEffect`; `animated` is ignored (policy owns it). */
  grain?: RisoGrainOptions;
}

/**
 * The narrow surface gl/stage.ts drives the post chain through. Kept separate
 * from `Post` so Stage's post wiring is testable without a WebGL context, and
 * so an embedder can substitute a different chain entirely.
 */
export interface PostLike {
  /** False => Stage must take its ordinary scissored render path instead. */
  readonly isEnabled: boolean;
  /** Re-points the chain at the view being rendered this frame. */
  setSceneCamera(scene: THREE.Scene, camera: THREE.Camera): void;
  /** Re-applies the enable/animate policy after a live quality or motion change. */
  setPolicy(quality: QualityTier, reducedMotion: boolean): void;
  /** Device pixels. */
  setSize(width: number, height: number): void;
  /** Renders through the chain, or calls `fallback` when disabled. `dt` in seconds. */
  render(dt: number, fallback: () => void): void;
  dispose(): void;
}

const DEFAULT_BLOOM_INTENSITY = 1;
const DEFAULT_BLOOM_THRESHOLD = 0.8;

/** One composer per canvas, shared across every post-enabled View. */
export class Post implements PostLike {
  readonly composer: EffectComposer;
  /**
   * The riso pass's effect, or `null` when the policy said no GPU grain for
   * this route/tier/motion combination. Null is permanent for the lifetime of
   * this instance: a tier upgrade cannot conjure the pass, it needs a rebuild.
   */
  readonly grain: RisoGrainEffect | null;

  /** The bloom effect, exposed so its live uniforms are observable without reaching into the pass list. */
  readonly bloom: BloomEffect;

  private readonly renderPass: RenderPass;
  private readonly effectPass: EffectPass;
  private readonly grainPass: EffectPass | null;
  private readonly route: string | undefined;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private enabled: boolean;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: PostOptions = {}) {
    const quality = opts.quality ?? "high";
    const reducedMotion = opts.reducedMotion ?? false;
    this.route = opts.route;
    this.scene = scene;
    this.camera = camera;

    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });

    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new BloomEffect({
      mipmapBlur: true, // half-res mip-chain blur per design doc
      intensity: opts.bloomIntensity ?? DEFAULT_BLOOM_INTENSITY,
      luminanceThreshold: opts.bloomThreshold ?? DEFAULT_BLOOM_THRESHOLD,
    });
    const smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
    this.effectPass = new EffectPass(camera, this.bloom, smaa);

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.effectPass);

    // Grain goes LAST, in its own pass, for two independent reasons: it has
    // to land after SMAA or antialiasing smooths the ink cells away, and
    // `postprocessing` merges co-passed effects into one global scope, where
    // riso's `simplex3d`/`fbm` would collide with any other effect that also
    // concatenates gl/shaders/noise.ts (see riso.ts's header).
    this.grain =
      this.route === undefined
        ? null
        : createRisoGrainEffect({ quality, reducedMotion, route: this.route }, opts.grain ?? {});
    this.grainPass = this.grain === null ? null : new EffectPass(camera, this.grain);
    if (this.grainPass !== null) this.composer.addPass(this.grainPass);

    this.enabled = shouldEnablePost(quality, reducedMotion);
  }

  setBloom(intensity: number, threshold: number): void {
    this.bloom.intensity = intensity;
    this.bloom.luminanceMaterial.threshold = threshold;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** The scene/camera the composer is currently pointed at. */
  get target(): { scene: THREE.Scene; camera: THREE.Camera } {
    return { scene: this.scene, camera: this.camera };
  }

  /**
   * Re-points every pass at another view's scene/camera. Cheap and idempotent
   * — a no-op when nothing changed — so Stage can call it every frame.
   */
  setSceneCamera(scene: THREE.Scene, camera: THREE.Camera): void {
    if (scene === this.scene && camera === this.camera) return;
    this.scene = scene;
    this.camera = camera;
    this.composer.setMainScene(scene);
    this.composer.setMainCamera(camera);
  }

  /**
   * Applies a live quality/reduced-motion change without a rebuild. Note the
   * two policies are not the same test: `shouldEnablePost` turns the WHOLE
   * chain off under reduced motion, which means riso's "static" mode is
   * unreachable through this class — the DOM fallback descriptor
   * (`RISO_GRAIN_FALLBACK`) is the vehicle for a still print, not the GPU.
   * `setAnimated` is still tracked so a chain that is enabled again later
   * lands on the right clock.
   */
  setPolicy(quality: QualityTier, reducedMotion: boolean): void {
    this.enabled = shouldEnablePost(quality, reducedMotion);
    if (this.grain !== null && this.route !== undefined) {
      this.grain.setAnimated(shouldAnimateRisoGrain({ quality, reducedMotion, route: this.route }));
    }
  }

  /** Renders through the composer when enabled, otherwise calls the caller-supplied plain-render fallback. */
  render(dt: number, fallback: () => void): void {
    if (!this.enabled) {
      fallback();
      return;
    }
    this.composer.render(dt);
  }

  /**
   * Device pixels — the same units gl/renderer.ts's `setSize` puts into the
   * drawing buffer (it bakes DPR in and never calls `setPixelRatio`, so the
   * renderer's pixel ratio stays 1 and drawing-buffer size == the size it was
   * given).
   *
   * `updateStyle: false` is not optional here. `EffectComposer.setSize` will
   * forward to `renderer.setSize(w, h, updateStyle)` whenever its own idea of
   * the size disagrees, and three.js writes `canvas.style.width/height` when
   * `updateStyle` is true — which throws on the OffscreenCanvas the worker
   * renderer owns, and would fight the DOM layer for canvas CSS sizing on the
   * main thread (see gl/renderer.ts's `setSize`, which passes false for the
   * same reason).
   */
  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  /** `EffectComposer.dispose()` disposes every pass (and each pass its effects) plus both buffers. */
  dispose(): void {
    this.composer.dispose();
  }
}
