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
//
// Two additive seams live here on top of that (both post-M0-freeze, both
// optional so every existing scene and test fixture still compiles):
//
//  1. ViewContext gains the narrow `GpgpuRenderer` + `FloatSupport` pair, so
//     a scene can run a ping-pong compute pass. `RendererLike` deliberately
//     does not expose `setRenderTarget`, and Stage owns the only reference to
//     a real renderer, so this is the only place that seam can come from.
//  2. The gl/post.ts chain. It is gated hard — see `resolvePostView()` — for
//     a structural reason: one composer cannot serve N scissored views, so
//     post runs only when a single opted-in view covers the whole canvas.

import type * as THREE from "three";
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
import { View, type ViewOptions, computeScissorRect, coversViewport } from "./view";
import { detectFloatSupport, type FloatSupport } from "./float-support";
import type { GpgpuRenderer } from "./gpgpu";
import { Post, type PostLike } from "./post";
import { clampDpr } from "./renderer";

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
  /**
   * Fired on every `false -> true` transition of a view's `ready` flag: once
   * when its initial `SceneModule.init()` resolves, and again after each
   * successful `reinit()` (WebGL context restore). Never fired for an init
   * that rejects, nor for a view removed while its init was still in flight —
   * consumers use this to decide it is safe to drop 2D fallback art, so a
   * view that will not draw must stay silent. Re-firing for the same viewId
   * must therefore be idempotent on the consumer's side.
   */
  onViewReady?: (viewId: number) => void;
  /**
   * Additive (post-M0-freeze): the page route, forwarded to gl/post.ts so
   * gl/shaders/riso.ts's route gate can decide whether the riso grain pass
   * belongs here. Left UNSET by default, which means "unknown route" and
   * yields no grain — note `""` is not the same thing, riso.ts reads it as
   * `"/"`. Stage deliberately does not sniff a global instead:
   * `globalThis.location` is the page URL on the main thread but the WORKER
   * SCRIPT's URL inside render.worker.ts, so guessing would silently give the
   * two RenderHost implementations different art. Hosts should thread the
   * real `location.pathname` through.
   */
  route?: string;
  /**
   * Additive: overrides the float-render-target verdict Stage would probe off
   * the renderer's GL context. Pass this when the host already probed (or is
   * driving a renderer whose context Stage cannot reach); leave it unset to
   * let Stage probe once via `RendererLike.getContext()`.
   */
  floatSupport?: FloatSupport;
  /**
   * Additive: factory for the post chain, called at most once, lazily, on the
   * first frame a view is actually eligible for post. Defaults to building a
   * real gl/post.ts `Post` when the injected renderer is a real
   * WebGLRenderer, and to `null` (no post, ever) when it is a `RendererLike`
   * mock. Returning `null` is remembered — the factory is not retried every
   * frame.
   */
  createPost?: PostFactory | null;
}

export interface PostFactoryInput {
  renderer: RendererLike;
  /** The eligible view's scene/camera at the moment the chain is built. */
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  quality: QualityTier;
  reducedMotion: boolean;
  /** `undefined` == "the host did not say"; see `StageOptions.route`. */
  route: string | undefined;
}

export type PostFactory = (input: PostFactoryInput) => PostLike | null;

interface ManagedView {
  view: View;
  ready: boolean;
}

/** Everything `postprocessing`'s EffectComposer reads off a renderer before it ever touches GL. */
interface PostCapableRenderer extends RendererLike {
  getSize(target: THREE.Vector2): THREE.Vector2;
  getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2;
  getContext(): WebGLRenderingContext | WebGL2RenderingContext;
}

function isPostCapableRenderer(renderer: RendererLike): renderer is PostCapableRenderer {
  const candidate = renderer as Partial<PostCapableRenderer> & { setRenderTarget?: unknown };
  return (
    typeof candidate.getSize === "function" &&
    typeof candidate.getDrawingBufferSize === "function" &&
    typeof candidate.getContext === "function" &&
    typeof candidate.setRenderTarget === "function"
  );
}

/**
 * The default post chain: a real `Post` when the renderer is real, otherwise
 * nothing at all. A `RendererLike` mock cannot back an EffectComposer, and
 * pretending otherwise would throw on the first eligible frame.
 */
const defaultPostFactory: PostFactory = (input) => {
  if (!isPostCapableRenderer(input.renderer)) return null;
  return new Post(input.renderer as unknown as THREE.WebGLRenderer, input.scene, input.camera, {
    quality: input.quality,
    reducedMotion: input.reducedMotion,
    route: input.route,
  });
};

/** `undefined` unless the renderer exposes the render-to-texture calls `Gpgpu.compute()` needs. */
function asGpgpuRenderer(renderer: RendererLike): GpgpuRenderer | undefined {
  const candidate = renderer as Partial<GpgpuRenderer>;
  return typeof candidate.setRenderTarget === "function" && typeof candidate.render === "function"
    ? (renderer as unknown as GpgpuRenderer)
    : undefined;
}

export class Stage {
  private renderer: RendererLike;
  private frame: StageFrameInput;
  private views = new Map<number, ManagedView>();
  private cullMargin: number;
  private onError: (err: unknown, viewId: number) => void;
  private onViewReady: (viewId: number) => void;

  /** The narrow GPGPU seam handed to scenes, or undefined for a mock renderer. */
  private readonly gpgpuRenderer: GpgpuRenderer | undefined;
  private readonly floatSupportOverride: FloatSupport | undefined;
  /** Memoized `detectFloatSupport()` verdict; cleared on context restore. */
  private probedFloatSupport: FloatSupport | undefined;

  private readonly route: string | undefined;
  private readonly postFactory: PostFactory | null;
  private post: PostLike | null = null;
  /** `"idle"` = not built yet; `"unavailable"` = the factory declined or threw, never retry. */
  private postState: "idle" | "ready" | "unavailable" = "idle";
  private postSize: { width: number; height: number } | null = null;
  /** Last dt handed to `update()`, so the no-arg `render()` hosts call can still drive the grain clock. */
  private lastDt = 0;

  constructor(renderer: RendererLike, frame: StageFrameInput, opts: StageOptions = {}) {
    this.renderer = renderer;
    this.frame = frame;
    this.cullMargin = opts.cullMargin ?? 0;
    this.onError = opts.onError ?? (() => {});
    this.onViewReady = opts.onViewReady ?? (() => {});
    this.gpgpuRenderer = asGpgpuRenderer(renderer);
    this.floatSupportOverride = opts.floatSupport;
    this.route = opts.route;
    this.postFactory = opts.createPost === undefined ? defaultPostFactory : opts.createPost;
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
        // A view may be removed while its async init is in flight. Only the
        // still-registered instance can become ready or notify its host.
        if (this.views.get(viewId) !== managed) return;
        managed.ready = true;
        this.onViewReady(viewId);
      })
      .catch((err) => this.onError(err, viewId));
  }

  removeView(viewId: number): void {
    const managed = this.views.get(viewId);
    if (!managed) return;
    managed.view.module.dispose();
    this.views.delete(viewId);
  }

  /**
   * `progress` is the main thread's per-frame answer (FRAME_STATE slot 5).
   * Pass it whenever it's available: for an ordinary view it equals the
   * rect-derived value, and for a sticky view — whose scissor rect is a
   * pinned viewport-tall box but whose scroll range is a tall parent — it is
   * the ONLY correct value (see View.progressOverride). Omit / pass
   * `undefined` to leave progress rect-derived.
   */
  updateRect(viewId: number, rect: RectData, progress?: number): void {
    const managed = this.views.get(viewId);
    if (!managed) return;
    managed.view.updateRect(rect);
    managed.view.setProgress(progress === undefined ? null : progress);
  }

  /** Advances every currently in-view, ready SceneModule by `dt` seconds. */
  update(dt: number): void {
    this.lastDt = dt;
    const viewportH = this.frame.size.height;
    const scrollY = this.frame.scroll.current;

    for (const managed of this.views.values()) {
      const { view } = managed;
      if (!managed.ready) continue;
      if (!view.inView(scrollY, viewportH, this.cullMargin)) continue;

      const ctx = this.buildContext(view);
      view.module.onProgress?.(view.progress(scrollY, viewportH));
      view.module.update(dt, ctx);
    }
  }

  /**
   * Renders every in-view view into its scissored region, in insertion order.
   * Skips off-screen views entirely.
   *
   * `dt` (seconds) only matters on the post path, where it drives time-based
   * effects (the riso grain clock). Both RenderHost implementations call this
   * with no argument, so it falls back to the last `update(dt)`. Reduced-motion
   * hosts still update scroll poses but pass `dt = 0`, keeping that clock
   * frozen; the whole post chain is disabled in that mode anyway.
   */
  render(dt: number = this.lastDt): void {
    const scrollY = this.frame.scroll.current;

    // Real THREE.WebGLRenderer draw-call bookkeeping (gl/renderer.ts disables
    // `info.autoReset` for exactly this reason — see its header comment):
    // reset once here, before any view renders, so the accumulated count
    // after the loop below reflects every view drawn this frame, not just
    // the last one. `info` is optional on RendererLike (absent on plain test
    // mocks), so this is a no-op there.
    this.renderer.info?.reset();

    const visible: View[] = [];
    for (const managed of this.views.values()) {
      if (!managed.ready) continue; // not yet initialized — nothing to draw
      if (!managed.view.inView(scrollY, this.frame.size.height, this.cullMargin)) continue;
      visible.push(managed.view);
    }

    const postView = this.resolvePostView(visible);
    if (postView !== null) {
      const post = this.ensurePost(postView);
      if (post !== null) {
        post.setPolicy(this.frame.quality, this.frame.reducedMotion);
        if (post.isEnabled) {
          const device = this.deviceSize();
          if (this.postSize === null || this.postSize.width !== device.width || this.postSize.height !== device.height) {
            post.setSize(device.width, device.height);
            this.postSize = device;
          }
          post.setSceneCamera(postView.scene, postView.camera);
          // The composer owns the whole drawing buffer: a live scissor test
          // would clip its fullscreen quads and its clears, and a leftover
          // per-view viewport would squeeze its output into that rectangle.
          this.renderer.setScissorTest(false);
          this.renderer.setViewport(0, 0, device.width, device.height);
          post.render(dt, () => {
            this.renderer.setScissorTest(true);
            this.renderScissored(visible, scrollY);
          });
          return;
        }
      }
    }

    this.renderer.setScissorTest(true);
    this.renderScissored(visible, scrollY);
  }

  /**
   * Which view — if any — may render through the shared composer this frame.
   *
   * A composer is bound to ONE (scene, camera) pair and paints/clears the
   * whole drawing buffer, so it cannot serve Stage's N-scissored-views model.
   * The narrow case that IS correct is the only one allowed here: exactly one
   * view drawing this frame, it opted in via `ViewOptions.post`, and its rect
   * covers the entire viewport (and therefore the whole canvas). Any other
   * arrangement takes the ordinary scissored path — a half-correct composer
   * would stretch one view over the canvas and erase the rest.
   */
  private resolvePostView(visible: View[]): View | null {
    if (visible.length !== 1) return null;
    const view = visible[0]!;
    if (!view.post) return null;
    const { width, height } = this.frame.size;
    if (!coversViewport(view.rect, this.frame.scroll.current, width, height)) return null;
    return view;
  }

  /** Builds the post chain at most once, on the first frame it is actually needed. */
  private ensurePost(view: View): PostLike | null {
    if (this.postState === "ready") return this.post;
    if (this.postState === "unavailable") return null;
    if (this.postFactory === null) {
      this.postState = "unavailable";
      return null;
    }

    let built: PostLike | null = null;
    try {
      built = this.postFactory({
        renderer: this.renderer,
        scene: view.scene,
        camera: view.camera,
        quality: this.frame.quality,
        reducedMotion: this.frame.reducedMotion,
        route: this.route,
      });
    } catch (err) {
      this.postState = "unavailable";
      this.onError(err, view.id);
      return null;
    }

    if (built === null) {
      this.postState = "unavailable";
      return null;
    }
    this.post = built;
    this.postState = "ready";
    return built;
  }

  /** Device-pixel canvas size, resolved exactly the way gl/renderer.ts's `setSize` resolves it. */
  private deviceSize(): { width: number; height: number } {
    const { width, height, dpr } = this.frame.size;
    const clamped = clampDpr(dpr, this.frame.quality);
    return {
      width: Math.max(1, Math.round(width * clamped)),
      height: Math.max(1, Math.round(height * clamped)),
    };
  }

  private renderScissored(visible: View[], scrollY: number): void {
    const { height, dpr } = this.frame.size;
    const deviceDpr = clampDpr(dpr, this.frame.quality);
    for (const view of visible) {
      // Single source of truth for the document-rect -> device-pixel
      // scissor/viewport math (design review item E3) — see gl/view.ts's
      // `computeScissorRect` for the bottom-left-GL-origin flip derivation.
      const scissor = computeScissorRect(view.rect, scrollY, height, deviceDpr);

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
    // A restored context is a NEW GL context: the previous float-support
    // verdict described hardware state that no longer exists (a downgraded /
    // software context can lose renderable float targets entirely), so the
    // probe is invalidated and re-run against the fresh context on the next
    // `buildContext`. The renderer object itself is the same instance, so the
    // `GpgpuRenderer` seam stays valid.
    this.probedFloatSupport = undefined;
    await Promise.all(
      Array.from(this.views.values()).map(async (managed) => {
        managed.ready = false;
        try {
          await managed.view.module.init(this.buildContext(managed.view));
          managed.ready = true;
          // A context restore is a real false->true readiness transition, so
          // it re-announces. Without this the signal would only ever describe
          // the very first init, and any consumer that (correctly) drops a
          // view from its ready set on CONTEXT_LOST could never learn the
          // scene came back.
          this.onViewReady(managed.view.id);
        } catch (err) {
          this.onError(err, managed.view.id);
        }
      })
    );
  }

  /** Disposes every remaining view's SceneModule, the post chain, and clears the view map. */
  dispose(): void {
    for (const managed of this.views.values()) {
      managed.view.module.dispose();
    }
    this.views.clear();
    this.post?.dispose();
    this.post = null;
    this.postSize = null;
    // Not "idle": a disposed Stage must not rebuild a composer if something
    // calls render() again.
    this.postState = "unavailable";
  }

  /** The post chain currently in use, or `null` when nothing is (or can be) built. */
  get postChain(): PostLike | null {
    return this.post;
  }

  /**
   * The float-render-target verdict every view sees (`ViewContext.floatSupport`).
   * Probed once off `RendererLike.getContext()` and memoized; `"none"` when
   * the renderer cannot hand over a context at all, which is the safe answer —
   * see gl/gpgpu.ts, where guessing `"float"` is what produces a silently
   * black simulation.
   */
  get floatSupport(): FloatSupport {
    if (this.floatSupportOverride !== undefined) return this.floatSupportOverride;
    if (this.probedFloatSupport !== undefined) return this.probedFloatSupport;

    const gl = this.renderer.getContext?.();
    // `Gpgpu` pins NearestFilter on both its targets, so linear-filter
    // capability is deliberately NOT required here (see float-support.ts's
    // `FloatSupportRequirements.linearFilter`).
    this.probedFloatSupport = gl ? detectFloatSupport(gl) : "none";
    return this.probedFloatSupport;
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
      // Additive GPGPU seam (types.ts `ViewContext.renderer`). Narrow on
      // purpose: a scene gets render-to-texture, not the ability to resize
      // the canvas or clobber the scissor rect Stage owns. `undefined`
      // whenever the injected renderer is a mock without `setRenderTarget`,
      // which is exactly when a scene must hold its pose instead of
      // simulating.
      renderer: this.gpgpuRenderer,
      floatSupport: this.floatSupport,
    };
  }
}
