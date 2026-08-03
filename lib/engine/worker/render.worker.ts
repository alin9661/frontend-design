// lib/engine/worker/render.worker.ts
//
// OffscreenCanvas rendering worker entry (design doc §4A). Owns the whole GL
// side of the "worker" RenderHost path: on INIT builds gl/'s Renderer,
// Stage and AssetManager from the transferred OffscreenCanvas; runs its own
// RAF loop; applies only the newest FRAME_STATE each tick (older queued
// frames are dropped — "applies newest FRAME_STATE per frame" in the design
// doc); posts STATS ~once/sec; relays WebGL context loss/restore back to the
// main thread; tears down on DISPOSE. Instantiated by host.ts's WorkerHost
// via `new Worker(new URL("./render.worker.ts", import.meta.url))` (static
// specifier, required for Next 15/webpack worker bundling).
//
// This mirrors worker/host.ts's MainThreadHost pipeline as closely as gl/'s
// current public API allows — see the TODO/NOTE comment below for the one
// remaining spot where it can't (Post's composer needs a fixed scene/camera
// at construction; gl/Stage doesn't yet expose a way to swap it to whichever
// view is currently rendering). That's a cross-workstream contract gap for
// whoever extends gl/Post/gl/Stage next, not a bug in this file — see the M1
// "worker" workstream return notes.
//
// Worker-side raycasting: per tick, after rendering, `runViewRaycasts()`
// (gl/raycast.ts) raycasts every registered view's interactive objects
// against the unpacked FRAME_STATE pointer, calls that view's
// `SceneModule.onPointer` locally (scenes live worker-side), and posts HIT
// back to main on every enter/leave/down-edge transition — the SAME
// function worker/host.ts's MainThreadHost calls from `frame()`, so both
// RenderHost implementations drive identical onPointer behavior by
// construction (design doc §4A) instead of two hand-maintained copies.
//
// SCENE_INVOKE routing: Stage also has no per-view SceneModule getter, but
// (like MainThreadHost, see host.ts) this file keeps its own viewId ->
// SceneModule map alongside Stage's so `invoke()` (e.g. the picker scene's
// carousel select RPC) reaches the right view's module instead of being
// silently dropped — matching MainThreadHost's behavior exactly (design doc
// §4A: "Both implement the same RenderHost interface identically").

import { AssetManager } from "../gl/assets";
import { ContextLossHandler, type ContextLossTarget } from "../gl/context-loss";
import { runViewRaycasts, ViewRaycaster } from "../gl/raycast";
import { createRenderer, setSize } from "../gl/renderer";
import { Stage, type StageFrameInput } from "../gl/stage";
import type { MainToWorker, PointerState, QualityTier, RectData, ScrollState, SceneId, SceneModule, WorkerToMain } from "../types";
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

/**
 * Minimal shape of the DedicatedWorkerGlobalScope members this file uses,
 * cast instead of `/// <reference lib="webworker" />`: this project's
 * tsconfig loads the "dom" lib (needed by every other engine/react/gl file
 * that shares the same TS program), and the "dom" + "webworker" libs declare
 * conflicting globals (`self`, `postMessage`, ...) when both are in scope.
 */
interface WorkerScope {
  postMessage(message: WorkerToMain, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<MainToWorker>) => void) | null;
  close(): void;
  requestAnimationFrame(cb: (t: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

const ctx = self as unknown as WorkerScope;

let renderer: ReturnType<typeof createRenderer> | null = null;
let stage: Stage | null = null;
let assets: AssetManager | null = null;
/** Stage exposes no per-view module getter (needed for SCENE_INVOKE
 * routing) — mirrors MainThreadHost's moduleByView map (host.ts). */
const moduleByView = new Map<number, SceneModule>();
/**
 * Per-viewId generation counter — bumped on every VIEW_ADD/VIEW_REMOVE.
 * `handleViewAdd`'s `loadScene()` is async; without this, a VIEW_REMOVE that
 * lands while a scene is still loading left the eventual `.then()` free to
 * resurrect the view, and a fast remove-then-re-add of the same viewId could
 * race two in-flight loads into calling `Stage.addView` for the same id
 * twice (design review item B — mirrors host.ts's identical
 * `MainThreadHost.viewGeneration`).
 */
const viewGeneration = new Map<number, number>();
/** Per-view raycaster state (hover-transition tracking), owned here and fed
 * to gl/raycast.ts's shared `runViewRaycasts()` each tick — see host.ts's
 * identical `MainThreadHost.raycasters` field. */
const raycasters = new Map<number, ViewRaycaster>();
let contextLoss: ContextLossHandler | null = null;
let quality: QualityTier = "high";
let reducedMotion = false;
let size = { width: 0, height: 0, dpr: 1 };
/** Last-known scroll/pointer state, retained across RESIZE (F4 fix — mirrors
 * host.ts's identical `MainThreadHost.lastScroll`/`lastPointer`: a resize
 * must not snap scroll/pointer back to DEFAULTS before the next real
 * FRAME_STATE tick). */
let lastScroll: ScrollState = DEFAULT_SCROLL;
let lastPointer: PointerState = DEFAULT_POINTER;
const stats = new StatsReporter();

let rafHandle: number | null = null;
let lastTickTime = 0;

/** Only the newest FRAME_STATE buffer is kept — dropped once applied. */
let pendingFrameState: Float32Array | null = null;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function currentFrameInput(): StageFrameInput {
  return {
    scroll: lastScroll,
    pointer: lastPointer,
    size,
    quality,
    reducedMotion,
    assets: assets ?? new AssetManager(),
  };
}

/** Invalidates any in-flight VIEW_ADD load for `viewId` and returns the new
 * generation — see `viewGeneration`'s doc comment. */
function bumpGeneration(viewId: number): number {
  const next = (viewGeneration.get(viewId) ?? 0) + 1;
  viewGeneration.set(viewId, next);
  return next;
}

// --- message handling --------------------------------------------------------

ctx.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "INIT":
      handleInit(msg.canvas, msg.dpr, msg.quality, msg.reducedMotion);
      break;
    case "FRAME_STATE":
      pendingFrameState = msg.state;
      break;
    case "RESIZE":
      handleResize(msg.width, msg.height, msg.dpr);
      break;
    case "VIEW_ADD":
      handleViewAdd(msg.viewId, msg.sceneId, msg.rect);
      break;
    case "VIEW_REMOVE":
      bumpGeneration(msg.viewId);
      stage?.removeView(msg.viewId);
      moduleByView.delete(msg.viewId);
      break;
    case "SCENE_INVOKE":
      moduleByView.get(msg.viewId)?.invoke?.(msg.method, msg.args);
      break;
    case "SET_REDUCED_MOTION":
      reducedMotion = msg.on;
      break;
    case "DISPOSE":
      handleDispose();
      break;
  }
};

function handleInit(canvas: OffscreenCanvas, dpr: number, initialQuality: QualityTier, initialReducedMotion: boolean): void {
  quality = initialQuality;
  reducedMotion = initialReducedMotion;
  // F5 fix: `canvas.width`/`canvas.height` on a just-transferred
  // OffscreenCanvas are its actual backing-store (device-pixel) dimensions,
  // but every RESIZE message after this (worker/host.ts's
  // `WorkerHost.resize()`) reports CSS px + a separate `dpr` multiplier —
  // dividing by `dpr` here keeps `size`'s unit convention (CSS px + dpr)
  // consistent from the very first frame instead of briefly holding
  // device-px values in a CSS-px-shaped field until the RESIZE that always
  // follows INIT arrives.
  size = { width: canvas.width / dpr, height: canvas.height / dpr, dpr };

  // BUG B1 fix: renderer construction (real WebGL2 context creation) can
  // throw synchronously — e.g. headless/SwiftShader environments without
  // WebGL2 support. This runs inside a plain `ctx.onmessage` handler, not
  // inside the promise chain WorkerHost.init() awaits, so an uncaught throw
  // here previously vanished into the worker's own error event: no READY,
  // no failure message, nothing — WorkerHost's `ready` promise (awaiting a
  // "READY" message) hung forever, leaving EngineProvider stuck at status
  // "loading" 0% with the LoadingScreen covering the page permanently. Catch
  // it and post the additive INIT_FAILED message instead so WorkerHost.init()
  // rejects and EngineProvider falls back to status "fallback" (see
  // types.ts's InitFailedMessage and host.ts's WorkerHost.init()).
  try {
    renderer = createRenderer({ canvas });
  } catch (err) {
    console.error("[deep-wave worker] renderer construction failed — falling back to GL-less mode", err);
    ctx.postMessage({ type: "INIT_FAILED", error: err instanceof Error ? err.message : String(err) });
    return;
  }

  assets = new AssetManager();
  assets.onProgress((p, id) => {
    ctx.postMessage({ type: "ASSET_PROGRESS", p, id });
    if (p >= 1) ctx.postMessage({ type: "ASSETS_DONE" });
  });
  stage = new Stage(renderer, currentFrameInput(), {
    onError: (err, viewId) => console.error(`[deep-wave worker] view ${viewId} scene init failed`, err),
  });

  // NOTE: gl/post.ts's `Post` composer is constructed with a single fixed
  // (scene, camera) pair, but each Stage view owns its own scene/camera —
  // there's no documented way yet to point one shared composer at whichever
  // view is currently rendering. Skipping post-processing here until gl/Post
  // (or gl/Stage) exposes a scene/camera swap; see the M1 return notes.

  contextLoss = new ContextLossHandler(canvas as unknown as ContextLossTarget, {
    onLost: () => ctx.postMessage({ type: "CONTEXT_LOST" }),
    onRestored: () => {
      stage
        ?.reinit()
        .then(() => ctx.postMessage({ type: "CONTEXT_RESTORED" }))
        .catch((err: unknown) => console.error("[deep-wave worker] Stage.reinit() failed on context restore", err));
    },
  });

  startTicking();
  ctx.postMessage({ type: "READY" });

  // Not awaited: READY and ASSETS_DONE are independent signals (see
  // host.ts's MainThreadHost.init() for the identical rationale). With zero
  // registered jobs (current M1 checkpoint — no scene calls ctx.assets.add()
  // yet) this resolves synchronously and posts ASSETS_DONE immediately.
  assets.start().catch((err: unknown) => {
    console.error("[deep-wave worker] AssetManager.start() failed", err);
  });
}

function handleResize(width: number, height: number, dpr: number): void {
  size = { width, height, dpr };
  if (renderer) setSize(renderer, width, height, dpr, quality);
  stage?.setFrame(currentFrameInput());
}

function handleViewAdd(viewId: number, sceneId: SceneId, rect: RectData): void {
  const generation = bumpGeneration(viewId);
  loadScene(sceneId)
    .then((module) => {
      if (viewGeneration.get(viewId) !== generation) {
        // Superseded by a VIEW_REMOVE/VIEW_ADD that happened while this
        // scene was still loading — dispose the orphaned module instead of
        // resurrecting a view nobody wants anymore, and don't touch
        // Stage/moduleByView (which may already hold a NEWER load's result
        // for this same viewId) — see `viewGeneration`'s doc comment
        // (design review item B).
        module.dispose();
        return;
      }
      moduleByView.set(viewId, module);
      stage?.addView(viewId, rect, module);
    })
    .catch((err: unknown) => {
      console.error(`[deep-wave worker] scene "${sceneId}" (view ${viewId}) failed to load`, err);
    });
}

function handleDispose(): void {
  stopTicking();
  contextLoss?.dispose();
  contextLoss = null;
  stage?.dispose();
  stage = null;
  moduleByView.clear();
  raycasters.clear();
  renderer?.dispose();
  renderer = null;
  assets = null;
  lastScroll = DEFAULT_SCROLL;
  lastPointer = DEFAULT_POINTER;
}

function startTicking(): void {
  if (rafHandle != null) return;
  lastTickTime = now();
  stats.reset(lastTickTime);
  rafHandle = ctx.requestAnimationFrame(tick);
}

function stopTicking(): void {
  if (rafHandle != null) {
    ctx.cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

function tick(time: number): void {
  rafHandle = ctx.requestAnimationFrame(tick);
  if (!stage) return;

  const dt = lastTickTime === 0 ? 0 : Math.min((time - lastTickTime) / 1000, MAX_DT_S);
  lastTickTime = time;

  if (pendingFrameState) {
    applyFrameState(pendingFrameState);
    pendingFrameState = null;
  }

  // Reduced motion: static frames — advance no scene animation state, but
  // still render so a real scroll/progress change is reflected (§6 a11y).
  if (!reducedMotion) {
    stage.update(dt);
  }

  const renderStart = now();
  stage.render();
  const renderMs = now() - renderStart;

  postStats(time, renderMs);

  // Worker-side raycasting (design doc §4A "runs raycasts worker-side,
  // posts HIT"): candidates are only the views a scene actually registered
  // interactive objects for (Stage.raycastCandidates()); onHit forwards
  // every enter/leave/down-edge transition as a HIT message.
  const frameSnapshot = stage.currentFrame;
  runViewRaycasts({
    candidates: stage.raycastCandidates(),
    pointer: frameSnapshot.pointer,
    scrollY: frameSnapshot.scroll.current,
    size: frameSnapshot.size,
    now: time,
    raycasters,
    onHit: (viewId, hit) => ctx.postMessage({ type: "HIT", viewId, hit }),
  });
}

function applyFrameState(buf: Float32Array): void {
  const state = unpackFrameState(buf);
  const { scroll, pointer } = frameStateToScrollPointer(state);
  lastScroll = scroll;
  lastPointer = pointer;

  for (const v of state.views) {
    stage?.updateRect(v.viewId, { top: v.top, left: v.left, width: v.width, height: v.height });
  }
  stage?.setFrame(currentFrameInput());
}

function postStats(time: number, renderMs: number): void {
  const ms = stats.record(time, renderMs);
  if (ms == null) return;

  // renderer.info is real THREE.WebGLRenderer draw-call bookkeeping —
  // gl/renderer.ts's createRenderer() sets `autoReset = false` and
  // gl/stage.ts's render() calls `info.reset()` once per Stage.render(), so
  // by the time we read it here it holds the total calls across every view
  // drawn this frame (previously this posted a hardcoded 0, so the ?debug
  // HUD's "draw calls" row could never show real activity).
  const drawCalls = renderer?.info?.render.calls ?? 0;
  const { splats, sortMs } = collectSceneStats(moduleByView.values());

  ctx.postMessage({ type: "STATS", ms, drawCalls, splats, sortMs });
}
