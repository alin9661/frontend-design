// lib/engine/gl/post.ts
//
// One shared EffectComposer per canvas: RenderPass -> EffectPass(Bloom
// mipmap half-res, SMAA). Disabled on the "low" quality tier and under
// reduced motion (design doc §4 gl/post.ts, §6 a11y — "bloom off, auto-anims
// off"). `postprocessing`'s EffectComposer hard-requires a real
// THREE.WebGLRenderer (it reads `renderer.getDrawingBufferSize` the moment a
// pass is added), so — unlike renderer.ts/stage.ts — there is no
// jsdom-safe mock seam for the composer itself; `shouldEnablePost` is
// factored out as the pure, fully-tested piece of this module's logic.

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

/** Pure: matches design doc "disabled on low tier + reduced motion". */
export function shouldEnablePost(quality: QualityTier, reducedMotion: boolean): boolean {
  return quality !== "low" && !reducedMotion;
}

export interface PostOptions {
  bloomIntensity?: number;
  bloomThreshold?: number;
  reducedMotion?: boolean;
  quality?: QualityTier;
}

const DEFAULT_BLOOM_INTENSITY = 1;
const DEFAULT_BLOOM_THRESHOLD = 0.8;

/** One composer per canvas, shared across every post-enabled View. */
export class Post {
  readonly composer: EffectComposer;
  private readonly bloom: BloomEffect;
  private readonly renderPass: RenderPass;
  private readonly effectPass: EffectPass;
  private enabled: boolean;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: PostOptions = {}) {
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

    this.enabled = shouldEnablePost(opts.quality ?? "high", opts.reducedMotion ?? false);
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

  /** Renders through the composer when enabled, otherwise calls the caller-supplied plain-render fallback. */
  render(dt: number, fallback: () => void): void {
    if (!this.enabled) {
      fallback();
      return;
    }
    this.composer.render(dt);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
