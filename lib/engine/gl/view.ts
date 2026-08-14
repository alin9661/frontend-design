// lib/engine/gl/view.ts
//
// One `View` = one scissored region of the single shared canvas: its own
// THREE.Scene + THREE.PerspectiveCamera + SceneModule instance, plus the
// document-space RectData Stage uses to cull it and to compute its scissor
// rectangle. Per-view camera convention: 1 world unit = 1 CSS px at z=0
// (design doc §4 gl/stage.ts,view.ts).

import * as THREE from "three";
import type { RectData, SceneModule } from "../types";

/** Fixed per design doc: `camera.position.z = viewportH/2 / tan(fov/2)`, fov 45. */
export const VIEW_FOV = 45;

/** Pure: the z-distance that makes 1 world unit == 1 CSS px at z=0. */
export function cameraDistanceForHeight(viewportH: number, fovDeg: number = VIEW_FOV): number {
  const fovRad = (fovDeg * Math.PI) / 180;
  const h = Math.max(viewportH, 1e-6);
  return h / 2 / Math.tan(fovRad / 2);
}

/**
 * Pure: is a document-space rect visible in a viewport currently scrolled to
 * `scrollY`? `margin` (px) grows the test window so views can be spun up
 * slightly before they're on-screen. Mirrors core/rect-tracker.ts's
 * `TrackedRect.inView` semantics but takes a plain RectData (no DOM
 * measurement) so it's usable from worker/host.ts's FRAME_STATE-derived
 * rects too.
 */
export function computeInView(
  rect: RectData,
  scrollY: number,
  viewportH: number,
  margin = 0
): boolean {
  const top = rect.top - scrollY;
  return top < viewportH + margin && top + rect.height > -margin;
}

/** Pure: 0 at rect's bottom entering the viewport, 1 at rect's top leaving it. */
export function computeProgress(rect: RectData, scrollY: number, viewportH: number): number {
  const span = viewportH + rect.height;
  if (span <= 0) return 0;
  const top = rect.top - scrollY;
  const raw = (viewportH - top) / span;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Sub-pixel slack (CSS px) for `coversViewport`. A sticky stage measured out
 * of the DOM lands on fractional rects all the time; demanding an exact match
 * would mean the post chain silently never engages.
 */
export const VIEWPORT_COVER_TOLERANCE = 1;

/**
 * Pure: does this view's document-space rect currently cover the ENTIRE
 * viewport (and therefore the entire shared canvas, which is viewport-sized)?
 *
 * This is the precondition for running a view through gl/post.ts's composer:
 * a composer renders its (scene, camera) across the whole drawing buffer and
 * clears the whole drawing buffer, so pointing it at a view that only owns a
 * scissored sub-rectangle would both stretch that view's content over the
 * canvas and wipe every other view's pixels. See gl/stage.ts's
 * `resolvePostView()`.
 *
 * Deliberately expressed in CSS/document space rather than device pixels: it
 * is then independent of DPR clamping, which the scissor math and
 * `renderer.setSize` resolve differently.
 */
export function coversViewport(
  rect: RectData,
  scrollY: number,
  viewportW: number,
  viewportH: number,
  tolerance: number = VIEWPORT_COVER_TOLERANCE
): boolean {
  const top = rect.top - scrollY;
  return (
    rect.left <= tolerance &&
    rect.left + rect.width >= viewportW - tolerance &&
    top <= tolerance &&
    top + rect.height >= viewportH - tolerance
  );
}

export interface ScissorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pure: document-space rect + current scroll -> device-pixel scissor/viewport
 * rectangle for the shared canvas. WebGL scissor/viewport origin is
 * bottom-left; document/CSS rects are top-down, hence the flip against
 * `canvasHeightCss`.
 */
export function computeScissorRect(
  rect: RectData,
  scrollY: number,
  canvasHeightCss: number,
  dpr: number
): ScissorRect {
  const viewTopCss = rect.top - scrollY;
  const x = Math.round(rect.left * dpr);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  const yFromTopPx = Math.round(viewTopCss * dpr);
  const canvasHeightPx = Math.round(canvasHeightCss * dpr);
  const y = canvasHeightPx - yFromTopPx - height;
  return { x, y, width, height };
}

export interface ViewOptions {
  post?: boolean;
}

/** One scissored view: owns its scene/camera and the SceneModule instance rendering into them. */
export class View {
  readonly id: number;
  readonly module: SceneModule;
  readonly post: boolean;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  rect: RectData;
  /**
   * Per-frame progress supplied by the main thread (FRAME_STATE slot 5),
   * overriding this view's own `computeProgress(rect, …)`.
   *
   * For an ordinary view the two agree exactly (core/rect-tracker.ts's
   * `TrackedRect.progress` is the same formula as `computeProgress`), so
   * this changes nothing. It exists for views whose *scroll range* is not
   * the same box as their *scissor rect* — a `position: sticky` stage,
   * where the rect being drawn into is one viewport tall and pinned, while
   * the scroll range that should drive the film is the tall parent section.
   * Deriving progress from the pinned rect alone yields a constant 0.5; only
   * the main thread knows the range, so it sends the answer.
   *
   * `null` = no override, fall back to the rect-derived value.
   */
  progressOverride: number | null = null;
  /** Set via `ViewContext.registerInteractive()` — see gl/raycast.ts's
   * `Stage.raycastCandidates()` for how this feeds the shared raycast path.
   * Empty until (and unless) the scene ever registers anything. */
  interactiveObjects: THREE.Object3D[] = [];

  constructor(id: number, rect: RectData, module: SceneModule, opts: ViewOptions = {}) {
    this.id = id;
    this.rect = rect;
    this.module = module;
    this.post = opts.post ?? false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(VIEW_FOV, aspectOf(rect), 0.1, 10000);
    this.applyCamera();
  }

  updateRect(rect: RectData): void {
    this.rect = rect;
    this.applyCamera();
  }

  /** `ViewContext.registerInteractive()`'s target — replaces the full set. */
  setInteractive(objects: THREE.Object3D[]): void {
    this.interactiveObjects = objects;
  }

  inView(scrollY: number, viewportH: number, margin = 0): boolean {
    return computeInView(this.rect, scrollY, viewportH, margin);
  }

  progress(scrollY: number, viewportH: number): number {
    if (this.progressOverride !== null) return this.progressOverride;
    return computeProgress(this.rect, scrollY, viewportH);
  }

  /** `null` clears the override and restores rect-derived progress. */
  setProgress(p: number | null): void {
    this.progressOverride = p === null ? null : Math.min(1, Math.max(0, p));
  }

  private applyCamera(): void {
    this.camera.aspect = aspectOf(this.rect);
    this.camera.position.z = cameraDistanceForHeight(this.rect.height);
    this.camera.updateProjectionMatrix();
  }
}

function aspectOf(rect: RectData): number {
  return rect.width / Math.max(rect.height, 1e-6);
}
