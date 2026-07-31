// lib/engine/gl/stage.ts
//
// Orchestrates every View sharing the ONE scissored canvas: builds each
// view's ViewContext, culls off-screen views out of the render loop
// entirely, and drives the RendererLike seam (real THREE.WebGLRenderer on
// the happy path, a recording mock in tests — see types.ts `RendererLike`
// and design doc §4 gl/stage.ts,view.ts).
//
// Stage.addView/removeView/updateRect/render match the design doc's
// signatures exactly; `setFrame`/`update`/`dispose`/`reinit` are the
// additional surface required to actually drive ViewContext (scroll,
// pointer, assets, size, quality, reducedMotion) since those can't fit
// through the four documented methods alone.

import type {
  AssetManager,
  PointerState,
  QualityTier,
  RectData,
  ScrollState,
  SceneModule,
  ViewContext,
  RendererLike,
} from "../types";
import type { RaycastCandidate } from "./raycast";
import { View, type ViewOptions, computeScissorRect } from "./view";

export interface StageFrameInput {
  scroll: ScrollState;
  pointer: PointerState;
  size: { width: number; height: number; dpr: number };
  quality: QualityTier;
  reducedMotion: boolean;
  assets: AssetManager;
}

export interface StageOptions {
  /** Extra px margin added to the inView cull test (default 0). */
  cullMargin?: number;
  /** Called when a SceneModule.init() promise rejects (default: swallow). */
  onError?: (err: unknown, viewId: number) => void;
}

interface ManagedView {
  view: View;
  ready: boolean;
}

export class Stage {
  private renderer: RendererLike;
  private frame: StageFrameInput;
  private views = new Map<number, ManagedView>();
  private cullMargin: number;
  private onError: (err: unknown, viewId: number) => void;

  constructor(renderer: RendererLike, frame: StageFrameInput, opts: StageOptions = {}) {
    this.renderer = renderer;
    this.frame = frame;
    this.cullMargin = opts.cullMargin ?? 0;
    this.onError = opts.onError ?? (() => {});
  }

  setFrame(frame: StageFrameInput): void {
    this.frame = frame;
  }

  addView(viewId: number, rect: RectData, module: SceneModule, opts?: ViewOptions): void {
    if (this.views.has(viewId)) {
      // Accurate as of the design review item B fix: both RenderHost
      // implementations now invalidate a superseded `loadScene()` via a
      // per-viewId generation counter before ever calling this (see
      // host.ts's `MainThreadHost.viewGeneration` / render.worker.ts's
      // `viewGeneration`), so this can only fire for a genuine caller bug —
      // an `addView` for a viewId that was never `removeView`'d — not as a
      // side effect of the VIEW_REMOVE-vs-async-load race that used to
      // trigger it spuriously.
      throw new Error(`Stage.addView: view ${viewId} already exists — call removeView(${viewId}) first`);
    }
    const view = new View(viewId, rect, module, opts);
    const managed: ManagedView = { view, ready: false };
    this.views.set(viewId, managed);

    Promise.resolve(module.init(this.buildContext(view)))
      .then(() => {
        managed.ready = true;
      })
      .catch((err) => this.onError(err, viewId));
  }

  removeView(viewId: number): void {
    const managed = this.views.get(viewId);
    if (!managed) return;
    managed.view.module.dispose();
    this.views.delete(viewId);
  }

  updateRect(viewId: number, rect: RectData): void {
    const managed = this.views.get(viewId);
    if (!managed) return;
    managed.view.updateRect(rect);
  }

  /** Advances every currently in-view, ready SceneModule by `dt` seconds. */
  update(dt: number): void {
    const viewportH = this.frame.size.height;
    const scrollY = this.frame.scroll.current;

    for (const managed of this.views.values()) {
      const { view } = managed;
      if (!managed.ready) continue;
      if (!view.inView(scrollY, viewportH, this.cullMargin)) continue;

      const ctx = this.buildContext(view);
      view.module.update(dt, ctx);
      view.module.onProgress?.(view.progress(scrollY, viewportH));
    }
  }

  /** Renders every in-view view into its scissored region, in insertion order. Skips off-screen views entirely. */
  render(): void {
    const { height, dpr } = this.frame.size;
    const viewportH = height;
    const scrollY = this.frame.scroll.current;

    this.renderer.setScissorTest(true);

    // Real THREE.WebGLRenderer draw-call bookkeeping (gl/renderer.ts disables
    // `info.autoReset` for exactly this reason — see its header comment):
    // reset once here, before any view renders, so the accumulated count
    // after the loop below reflects every view drawn this frame, not just
    // the last one. `info` is optional on RendererLike (absent on plain test
    // mocks), so this is a no-op there.
    this.renderer.info?.reset();

    for (const managed of this.views.values()) {
      const { view } = managed;
      if (!managed.ready) continue; // not yet initialized — nothing to draw
      if (!view.inView(scrollY, viewportH, this.cullMargin)) continue;

      // Single source of truth for the document-rect -> device-pixel
      // scissor/viewport math (design review item E3) — see gl/view.ts's
      // `computeScissorRect` for the bottom-left-GL-origin flip derivation.
      const scissor = computeScissorRect(view.rect, scrollY, height, dpr);

      this.renderer.setScissor(scissor.x, scissor.y, scissor.width, scissor.height);
      this.renderer.setViewport(scissor.x, scissor.y, scissor.width, scissor.height);
      this.renderer.render(view.scene, view.camera);
    }
  }

  /**
   * Re-runs every view's `init` (context-loss restore contract — see
   * context-loss.ts). Deliberately does NOT reach into either RenderHost's
   * per-view `ViewRaycaster` map to reset hover state (design review item
   * F3/E10): while `managed.ready` is `false` here, `raycastCandidates()`
   * excludes the view, so both hosts' shared `runViewRaycasts()` (see
   * gl/raycast.ts) treats it exactly like any other view that temporarily
   * stops being a candidate — its `ViewRaycaster` gets pruned (firing one
   * final leave if it was mid-hover, same as a real `removeView()`) and,
   * once the view becomes a candidate again post-restore (this method
   * resolves and re-registers whatever `registerInteractive()` the re-run
   * `init()` calls), a fresh `ViewRaycaster` is created with no stale hover
   * state. No special-casing needed here — see `runViewRaycasts`' pruning
   * logic for where this actually happens.
   */
  async reinit(): Promise<void> {
    await Promise.all(
      Array.from(this.views.values()).map(async (managed) => {
        managed.ready = false;
        try {
          await managed.view.module.init(this.buildContext(managed.view));
          managed.ready = true;
        } catch (err) {
          this.onError(err, managed.view.id);
        }
      })
    );
  }

  /** Disposes every remaining view's SceneModule and clears the view map. */
  dispose(): void {
    for (const managed of this.views.values()) {
      managed.view.module.dispose();
    }
    this.views.clear();
  }

  get size(): number {
    return this.views.size;
  }

  /** Read-only snapshot of the most recently applied frame input
   * (scroll/pointer/size/etc) — lets both RenderHost implementations drive
   * gl/raycast.ts's shared `runViewRaycasts()` from the same state Stage
   * itself just rendered with, instead of duplicating pointer/scroll
   * bookkeeping in worker/render.worker.ts and worker/host.ts. */
  get currentFrame(): Readonly<StageFrameInput> {
    return this.frame;
  }

  /**
   * Ready + in-view + interactive-target-registered views, as raycast
   * candidates for gl/raycast.ts's `runViewRaycasts()`. Views nobody ever
   * calls `ViewContext.registerInteractive()` for are skipped entirely — no
   * wasted per-frame raycast against an empty target list, and no HIT
   * message a scene could never have produced a hit for anyway.
   */
  raycastCandidates(): RaycastCandidate[] {
    const viewportH = this.frame.size.height;
    const scrollY = this.frame.scroll.current;
    const out: RaycastCandidate[] = [];

    for (const managed of this.views.values()) {
      if (!managed.ready) continue;
      const { view } = managed;
      if (view.interactiveObjects.length === 0) continue;
      if (!view.inView(scrollY, viewportH, this.cullMargin)) continue;

      out.push({
        viewId: view.id,
        rect: view.rect,
        camera: view.camera,
        targets: view.interactiveObjects,
        module: view.module,
      });
    }

    return out;
  }

  private buildContext(view: View): ViewContext {
    return {
      scene: view.scene,
      camera: view.camera,
      rect: view.rect,
      scroll: this.frame.scroll,
      pointer: this.frame.pointer,
      assets: this.frame.assets,
      size: this.frame.size,
      quality: this.frame.quality,
      reducedMotion: this.frame.reducedMotion,
      registerInteractive: (objects) => view.setInteractive(objects),
    };
  }
}
