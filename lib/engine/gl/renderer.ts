// lib/engine/gl/renderer.ts
//
// Thin wrapper around THREE.WebGLRenderer: accepts either an
// HTMLCanvasElement or an OffscreenCanvas (worker-safe), clamps DPR, and
// exposes an explicit setSize(renderer, w, h, dpr) instead of relying on a
// ResizeObserver — sizes/DPR always arrive as data from the caller (react/
// on main thread, worker/host.ts's RESIZE message off it). Quality-tier
// detection is a pure function so it's usable without a DOM/canvas at all
// (worker/host.ts can call it before INIT).

import * as THREE from "three";
import type { QualityTier, RendererLike } from "../types";

/** DPR is clamped to 2 on "high"/"medium" tiers, 1.5 on "low" (design doc §4). */
export const MAX_DPR_DEFAULT = 2;
export const MAX_DPR_LOW = 1.5;
export const MIN_DPR = 1;

export function clampDpr(dpr: number, tier: QualityTier = "high"): number {
  const max = tier === "low" ? MAX_DPR_LOW : MAX_DPR_DEFAULT;
  if (!Number.isFinite(dpr)) return MIN_DPR;
  return Math.min(Math.max(dpr, MIN_DPR), max);
}

/**
 * Explicit size setter — the design doc's `setSize(w,h,dpr)`. `RendererLike`
 * has no `setPixelRatio` (it's the minimal seam over what Stage actually
 * calls), so DPR is baked directly into the device-pixel width/height passed
 * to `renderer.setSize`; `updateStyle` is always false because CSS sizing of
 * the canvas is owned by the DOM/react layer, never by gl/.
 */
export function setSize(
  renderer: RendererLike,
  width: number,
  height: number,
  dpr: number,
  tier: QualityTier = "high"
): void {
  const clamped = clampDpr(dpr, tier);
  renderer.setSize(Math.max(1, Math.round(width * clamped)), Math.max(1, Math.round(height * clamped)), false);
}

/** Pure inputs for tier detection — every field is plain data (worker-safe). */
export interface QualityProbe {
  hardwareConcurrency: number;
  dpr: number;
  /** Optional measured ms of a first probe frame; omit if not yet measured. */
  firstFrameMs?: number;
}

/**
 * Pure quality-tier heuristic — no DOM/navigator reads inside; the caller
 * (react/ on main thread, worker/host.ts off it) gathers the probe values
 * and passes them in. Usable in unit tests and in a Web Worker alike.
 */
export function detectQualityTier(probe: QualityProbe): QualityTier {
  const { hardwareConcurrency, dpr, firstFrameMs } = probe;

  if (hardwareConcurrency <= 2 || dpr > 2.5 || (firstFrameMs !== undefined && firstFrameMs > 32)) {
    return "low";
  }
  if (hardwareConcurrency <= 4 || (firstFrameMs !== undefined && firstFrameMs > 18)) {
    return "medium";
  }
  return "high";
}

export interface RendererOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  antialias?: boolean;
  alpha?: boolean;
  powerPreference?: WebGLPowerPreference;
}

/**
 * Pure config resolution, split out from `createRenderer` so the defaulting
 * logic is unit-testable without ever touching a real WebGL context (jsdom
 * has no WebGL2, so `new THREE.WebGLRenderer` itself can't run in tests —
 * this is the part of renderer construction that can and does get covered).
 */
export function resolveRendererParams(opts: RendererOptions): THREE.WebGLRendererParameters {
  return {
    canvas: opts.canvas as HTMLCanvasElement,
    antialias: opts.antialias ?? false,
    alpha: opts.alpha ?? true,
    powerPreference: opts.powerPreference ?? "high-performance",
    stencil: false,
  };
}

/** Real THREE.WebGLRenderer construction — needs an actual GL-capable canvas. */
export function createRenderer(opts: RendererOptions): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer(resolveRendererParams(opts));
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  // Stage renders multiple views (one THREE.WebGLRenderer.render() call per
  // in-view scissored view) per Stage.render() invocation. WebGLRenderer's
  // default `info.autoReset` resets the draw-call counter at the START of
  // EVERY render() call, so reading `info.render.calls` afterward would only
  // ever reflect the LAST view's calls. Disabling autoReset lets gl/stage.ts
  // reset once per Stage.render() and accumulate the true per-frame total —
  // what the `?debug` HUD's "draw calls" row (worker/host.ts's STATS
  // message) actually reports.
  renderer.info.autoReset = false;
  return renderer;
}
