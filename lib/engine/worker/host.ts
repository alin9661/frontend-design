// lib/engine/worker/host.ts
//
// Main-thread RenderHost facade (design doc §4A). `createRenderHost()`
// feature-detects OffscreenCanvas worker support and returns either a
// `WorkerHost` (posts messages to render.worker.ts) or a `MainThreadHost`
// (drives gl/Stage directly on the main thread). Both implement the same
// `RenderHost` interface identically from the caller's point of view —
// MainThreadHost is both the graceful-degradation fallback AND the jsdom
// test path: it never needs a real WebGL context because every gl/ piece it
// touches (`Stage`, `AssetManager`, `RendererLike`) is designed to run
// against a `RendererLike` mock (see types.ts) instead of a live
// `THREE.WebGLRenderer`.
//
// Pointer raycasting: `frame()` calls gl/raycast.ts's shared
// `runViewRaycasts()` — the SAME function render.worker.ts's RAF tick calls
// — so MainThreadHost drives an identical SceneModule.onPointer sequence
// (and HIT emission) to the worker path instead of a hand-maintained copy.

import { AssetManager } from "../gl/assets";
import { ContextLossHandler, type ContextLossTarget } from "../gl/context-loss";
import { runViewRaycasts, ViewRaycaster } from "../gl/raycast";
import { clampDpr, createRenderer, detectQualityTier, setSize } from "../gl/renderer";
import { Stage, type StageFrameInput } from "../gl/stage";
import type {
  AssetManager as AssetManagerContract,
  HostInit,
  PointerState,
  QualityTier,
  RectData,
  RendererLike,
  RenderHost,
  ScrollState,
  SceneId,
  SceneModule,
  WorkerToMain,
} from "../types";
import {
  DEFAULT_POINTER,
  DEFAULT_SCROLL,
  MAX_DT_S,
  StatsReporter,
  collectSceneStats,
  frameStateToScrollPointer,
} from "./frame-shared";
import { unpackFrameState } from "./protocol";
import { loadScene } from "./scene-registry";

// ---------------------------------------------------------------------------
// Feature detection (design doc §4A: "createRenderHost() feature-detect:
// 'transferControlToOffscreen' in HTMLCanvasElement.prototype && typeof
// OffscreenCanvas !== 'undefined' → WorkerHost, else MainThreadHost")
// ---------------------------------------------------------------------------

export function supportsOffscreenWorkerRendering(): boolean {
  return (
    typeof HTMLCanvasElement !== "undefined" &&
    "transferControlToOffscreen" in HTMLCanvasElement.prototype &&
    typeof OffscreenCanvas !== "undefined"
  );
}

/** Silent fallback: WorkerHost when the browser supports it, else MainThreadHost. */
export function createRenderHost(): RenderHost {
  return supportsOffscreenWorkerRendering() ? new WorkerHost() : new MainThreadHost();
}

// ---------------------------------------------------------------------------
// WorkerHost — posts MainToWorker messages to render.worker.ts, relays
// WorkerToMain messages back out via onMessage().
// ---------------------------------------------------------------------------

export class WorkerHost implements RenderHost {
  readonly mode = "worker" as const;

  private worker: Worker | null = null;
  private readonly listeners = new Set<(m: WorkerToMain) => void>();

  private readonly handleMessage = (ev: MessageEvent<WorkerToMain>): void => {
    for (const cb of this.listeners) cb(ev.data);
  };

  async init(canvas: HTMLCanvasElement, opts: HostInit): Promise<void> {
    // Next 15/webpack worker bundling requires a *static* `new URL(...,
    // import.meta.url)` argument — no dynamic string paths — so it can be
    // statically discovered and code-split.
    const worker = new Worker(new URL("./render.worker.ts", import.meta.url));
    this.worker = worker;
    worker.addEventListener("message", this.handleMessage);

    const offscreen = canvas.transferControlToOffscreen();
    // BUG B1 fix: the worker can fail to construct its renderer (real WebGL2
    // context creation throwing — headless/SwiftShader environments) and
    // posts the additive INIT_FAILED message instead of READY in that case
    // (see render.worker.ts's handleInit() and types.ts's InitFailedMessage).
    // Without this branch, `ready` awaited READY forever and this whole
    // init() promise never settled, leaving EngineProvider stuck at status
    // "loading" 0% with the LoadingScreen covering the page permanently.
    const ready = new Promise<void>((resolve, reject) => {
      const unsubscribe = this.onMessage((m) => {
        if (m.type === "READY") {
          unsubscribe();
          resolve();
        } else if (m.type === "INIT_FAILED") {
          unsubscribe();
          reject(new Error(m.error));
        }
      });
    });

    worker.postMessage(
      {
        type: "INIT",
        canvas: offscreen,
        dpr: opts.dpr,
        quality: opts.quality,
        reducedMotion: opts.reducedMotion,
      },
      [offscreen]
    );

    await ready;
  }

  frame(state: Float32Array): void {
    this.worker?.postMessage({ type: "FRAME_STATE", state }, [state.buffer]);
  }

  addView(viewId: number, sceneId: SceneId, rect: RectData): void {
    this.worker?.postMessage({ type: "VIEW_ADD", viewId, sceneId, rect });
  }

  removeView(viewId: number): void {
    this.worker?.postMessage({ type: "VIEW_REMOVE", viewId });
  }

  invoke(viewId: number, method: string, args: unknown[]): void {
    this.worker?.postMessage({ type: "SCENE_INVOKE", viewId, method, args });
  }

  onMessage(cb: (m: WorkerToMain) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  resize(w: number, h: number, dpr: number): void {
    this.worker?.postMessage({ type: "RESIZE", width: w, height: h, dpr });
  }

  destroy(): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: "DISPOSE" });
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.terminate();
    this.worker = null;
    this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// MainThreadHost — drives gl/Stage directly on the main thread.
// ---------------------------------------------------------------------------

export interface MainThreadHostDeps {
  /** Test seam: defaults to gl/renderer.ts's `createRenderer` (real THREE.WebGLRenderer). */
  createRenderer?: (canvas: HTMLCanvasElement) => RendererLike;
  /** Test seam: defaults to a real gl/assets.ts `AssetManager`. */
  createAssets?: () => AssetManagerContract;
  /** Test seam: defaults to a real gl/stage.ts `Stage`. */
  createStage?: (renderer: RendererLike, frame: StageFrameInput) => Stage;
}

export class MainThreadHost implements RenderHost {
  readonly mode = "main" as const;

  private readonly createRendererImpl: (canvas: HTMLCanvasElement) => RendererLike;
  private readonly createAssetsImpl: () => AssetManagerContract;
  private readonly createStageImpl: (renderer: RendererLike, frame: StageFrameInput) => Stage;

  private renderer: RendererLike | null = null;
  private stage: Stage | null = null;
  private assets: AssetManagerContract | null = null;
  private contextLoss: ContextLossHandler | null = null;
  private opts: HostInit | null = null;
  private size = { width: 0, height: 0, dpr: 1 };

  /** Stage exposes no per-view module getter (needed for `invoke()`), so
   * MainThreadHost keeps its own viewId -> SceneModule map alongside it. */
  private readonly moduleByView = new Map<number, SceneModule>();
  /** Per-view raycaster state (hover-transition tracking), fed to
   * gl/raycast.ts's shared `runViewRaycasts()` each `frame()` call — see
   * render.worker.ts's identical `raycasters` module state. */
  private readonly raycasters = new Map<number, ViewRaycaster>();
  /**
   * Per-viewId generation counter — bumped on every `addView`/`removeView`
   * call. `addView`'s `loadScene()` is async; without this, a
   * `removeView(id)` that lands while a scene is still loading left the
   * eventual `.then()` free to resurrect the view (re-adding it to
   * `moduleByView`/`Stage` after the caller already considered it gone), and
   * a fast remove-then-re-add of the SAME viewId could race two in-flight
   * loads into calling `Stage.addView` for the same id twice (design review
   * item B). Captured at the start of `addView`; the `.then()` callback
   * disposes the loaded module instead of registering it if the counter has
   * since moved on.
   */
  private readonly viewGeneration = new Map<number, number>();
  private readonly listeners = new Set<(m: WorkerToMain) => void>();
  private unsubscribeAssetProgress: (() => void) | null = null;

  private lastFrameTime: number | null = null;
  /** Last-known scroll/pointer state, retained across `resize()` calls (F4
   * fix — see this class's `resize()` for why `buildFrameInput()` must NOT
   * fall back to DEFAULT_SCROLL/DEFAULT_POINTER once a real frame has
   * arrived). */
  private lastScroll: ScrollState = DEFAULT_SCROLL;
  private lastPointer: PointerState = DEFAULT_POINTER;
  private readonly stats = new StatsReporter();

  constructor(deps: MainThreadHostDeps = {}) {
    this.createRendererImpl = deps.createRenderer ?? ((canvas) => createRenderer({ canvas }));
    this.createAssetsImpl = deps.createAssets ?? (() => new AssetManager());
    this.createStageImpl = deps.createStage ?? ((renderer, frame) => new Stage(renderer, frame));
  }

  async init(canvas: HTMLCanvasElement, opts: HostInit): Promise<void> {
    this.opts = opts;
    this.renderer = this.createRendererImpl(canvas);
    this.assets = this.createAssetsImpl();
    this.stage = this.createStageImpl(this.renderer, this.buildFrameInput());

    this.unsubscribeAssetProgress = this.assets.onProgress((p, id) => {
      this.emit({ type: "ASSET_PROGRESS", p, id });
      if (p >= 1) this.emit({ type: "ASSETS_DONE" });
    });

    // Canvas-like target (HTMLCanvasElement or a test double) — see
    // gl/context-loss.ts for why this only needs add/removeEventListener.
    this.contextLoss = new ContextLossHandler(canvas as unknown as ContextLossTarget, {
      onLost: () => this.emit({ type: "CONTEXT_LOST" }),
      onRestored: () => {
        this.stage
          ?.reinit()
          .then(() => this.emit({ type: "CONTEXT_RESTORED" }))
          .catch((err: unknown) => console.error("[deep-wave] Stage.reinit() failed on context restore", err));
      },
    });

    this.emit({ type: "READY" });

    // Kick off asset loading now that progress listeners are wired up.
    // Not awaited: READY (canvas/renderer exists) and ASSETS_DONE (assets
    // loaded) are independent signals — views render immediately while
    // assets stream in, per the AssetManager.onProgress subscription above.
    // With zero registered jobs (current M1 checkpoint state — no scene
    // calls ctx.assets.add() yet) this resolves synchronously and the
    // onProgress subscription above immediately emits ASSETS_DONE.
    this.assets.start().catch((err: unknown) => {
      console.error("[deep-wave] AssetManager.start() failed", err);
    });
  }

  addView(viewId: number, sceneId: SceneId, rect: RectData): void {
    const generation = this.bumpGeneration(viewId);
    loadScene(sceneId)
      .then((module) => {
        if (this.viewGeneration.get(viewId) !== generation) {
          // Superseded by a removeView()/addView() that happened while this
          // scene was still loading — dispose the orphaned module instead of
          // resurrecting a view nobody wants anymore, and don't touch
          // Stage/moduleByView (which may already hold a NEWER load's
          // result for this same viewId) — see this class's `viewGeneration`
          // doc comment (design review item B).
          module.dispose();
          return;
        }
        this.moduleByView.set(viewId, module);
        this.stage?.addView(viewId, rect, module);
      })
      .catch((err: unknown) => {
        console.error(`[deep-wave] scene "${sceneId}" (view ${viewId}) failed to load`, err);
      });
  }

  removeView(viewId: number): void {
    this.bumpGeneration(viewId);
    this.stage?.removeView(viewId);
    this.moduleByView.delete(viewId);
  }

  /** Invalidates any in-flight `addView()` load for `viewId` and returns the
   * new generation — see `viewGeneration`'s doc comment. */
  private bumpGeneration(viewId: number): number {
    const next = (this.viewGeneration.get(viewId) ?? 0) + 1;
    this.viewGeneration.set(viewId, next);
    return next;
  }

  invoke(viewId: number, method: string, args: unknown[]): void {
    this.moduleByView.get(viewId)?.invoke?.(method, args);
  }

  onMessage(cb: (m: WorkerToMain) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  frame(state: Float32Array): void {
    if (!this.renderer || !this.stage) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const dt = this.lastFrameTime == null ? 0 : Math.min((now - this.lastFrameTime) / 1000, MAX_DT_S);
    this.lastFrameTime = now;

    const unpacked = unpackFrameState(state);
    const { scroll, pointer } = frameStateToScrollPointer(unpacked);
    this.lastScroll = scroll;
    this.lastPointer = pointer;

    for (const v of unpacked.views) {
      this.stage.updateRect(v.viewId, { top: v.top, left: v.left, width: v.width, height: v.height });
    }

    this.stage.setFrame(this.buildFrameInput());

    const reducedMotion = this.opts?.reducedMotion ?? false;
    // Reduced motion: static frames — advance no scene animation state, but
    // still render so a real scroll/progress change is reflected (§6 a11y).
    if (!reducedMotion) {
      this.stage.update(dt);
    }

    const renderStart = now;
    this.stage.render();
    const renderMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - renderStart;
    this.postStats(now, renderMs);

    // Same shared path render.worker.ts's RAF tick calls (see this file's
    // header comment) — candidates are only the views a scene actually
    // registered interactive objects for (Stage.raycastCandidates()).
    runViewRaycasts({
      candidates: this.stage.raycastCandidates(),
      pointer,
      scrollY: scroll.current,
      size: this.size,
      now,
      raycasters: this.raycasters,
      onHit: (viewId, hit) => this.emit({ type: "HIT", viewId, hit }),
    });
  }

  resize(w: number, h: number, dpr: number): void {
    this.size = { width: w, height: h, dpr };
    if (this.renderer) {
      setSize(this.renderer, w, h, dpr, this.opts?.quality ?? "high");
    }
    // F4 fix: retain the last-known scroll/pointer state (see
    // `lastScroll`/`lastPointer`'s doc comment) — a resize must not snap
    // scroll/pointer back to DEFAULTS before the next real FRAME_STATE tick.
    this.stage?.setFrame(this.buildFrameInput());
  }

  destroy(): void {
    this.contextLoss?.dispose();
    this.contextLoss = null;
    this.unsubscribeAssetProgress?.();
    this.unsubscribeAssetProgress = null;
    this.stage?.dispose();
    this.stage = null;
    this.moduleByView.clear();
    this.raycasters.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.assets = null;
    this.lastFrameTime = null;
    this.lastScroll = DEFAULT_SCROLL;
    this.lastPointer = DEFAULT_POINTER;
    this.listeners.clear();
  }

  private buildFrameInput(): StageFrameInput {
    return {
      scroll: this.lastScroll,
      pointer: this.lastPointer,
      size: this.size,
      quality: this.currentQuality(),
      reducedMotion: this.opts?.reducedMotion ?? false,
      assets: this.assets ?? new AssetManager(),
    };
  }

  private currentQuality(): QualityTier {
    if (this.opts?.quality) return this.opts.quality;
    return detectQualityTier({
      hardwareConcurrency: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4,
      dpr: clampDpr(this.size.dpr),
    });
  }

  private postStats(now: number, renderMs: number): void {
    const ms = this.stats.record(now, renderMs);
    if (ms == null) return;

    // this.renderer.info is real THREE.WebGLRenderer draw-call bookkeeping
    // (optional on RendererLike — absent on plain test mocks). gl/renderer.ts
    // sets `autoReset = false` and gl/stage.ts's render() resets it once per
    // Stage.render(), so by the time we read it here it holds the total
    // calls across every view drawn this frame (previously hardcoded to 0).
    const drawCalls = this.renderer?.info?.render.calls ?? 0;
    const { splats, sortMs } = collectSceneStats(this.moduleByView.values());

    this.emit({ type: "STATS", ms, drawCalls, splats, sortMs });
  }

  private emit(m: WorkerToMain): void {
    for (const cb of this.listeners) cb(m);
  }
}
