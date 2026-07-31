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
// at construction; Stage doesn't yet expose a per-view scene/camera/targets
// getter for raycasting). That's a cross-workstream contract gap for
// whoever extends gl/Stage next, not a bug in this file — see the M1
// "worker" workstream return notes.
//
// SCENE_INVOKE routing: Stage also has no per-view SceneModule getter, but
// (like MainThreadHost, see host.ts) this file keeps its own viewId ->
// SceneModule map alongside Stage's so `invoke()` (e.g. the picker scene's
// carousel select RPC) reaches the right view's module instead of being
// silently dropped — matching MainThreadHost's behavior exactly (design doc
// §4A: "Both implement the same RenderHost interface identically").

import { AssetManager } from "../gl/assets";
import { ContextLossHandler, type ContextLossTarget } from "../gl/context-loss";
import { createRenderer, setSize } from "../gl/renderer";
import { Stage, type StageFrameInput } from "../gl/stage";
import type { MainToWorker, QualityTier, RectData, SceneId, SceneModule, WorkerToMain } from "../types";
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

const STATS_INTERVAL_MS = 1000;
const DEFAULT_SCROLL = { target: 0, current: 0, velocity: 0, progress: 0, limit: 0 };
const DEFAULT_POINTER = { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false };

let renderer: ReturnType<typeof createRenderer> | null = null;
let stage: Stage | null = null;
let assets: AssetManager | null = null;
/** Stage exposes no per-view module getter (needed for SCENE_INVOKE
 * routing) — mirrors MainThreadHost's moduleByView map (host.ts). */
const moduleByView = new Map<number, SceneModule>();
let contextLoss: ContextLossHandler | null = null;
let quality: QualityTier = "high";
let reducedMotion = false;
let size = { width: 0, height: 0, dpr: 1 };

let rafHandle: number | null = null;
let lastTickTime = 0;
let statsAccumMs = 0;
let statsAccumFrames = 0;
let lastStatsPostTime = 0;

/** Only the newest FRAME_STATE buffer is kept — dropped once applied. */
let pendingFrameState: Float32Array | null = null;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function currentFrameInput(scroll = DEFAULT_SCROLL, pointer = DEFAULT_POINTER): StageFrameInput {
  return {
    scroll,
    pointer,
    size,
    quality,
    reducedMotion,
    assets: assets ?? new AssetManager(),
  };
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
  size = { width: canvas.width, height: canvas.height, dpr };

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
  loadScene(sceneId)
    .then((module) => {
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
  renderer?.dispose();
  renderer = null;
  assets = null;
}

function startTicking(): void {
  if (rafHandle != null) return;
  lastTickTime = now();
  lastStatsPostTime = lastTickTime;
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

  const dt = lastTickTime === 0 ? 0 : Math.min((time - lastTickTime) / 1000, 0.064);
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
  // posts HIT") needs each view's camera + candidate objects, which Stage
  // doesn't expose per-view yet (same gap noted in host.ts's
  // MainThreadHost) — no HIT messages are posted until that lands.
}

function applyFrameState(buf: Float32Array): void {
  const state = unpackFrameState(buf);
  const scroll = {
    target: state.scrollCurrent,
    current: state.scrollCurrent,
    velocity: state.scrollVelocity,
    progress: state.scrollProgress,
    limit: 0,
  };
  const pointer = {
    x: state.pointerX,
    y: state.pointerY,
    vx: state.pointerVX,
    vy: state.pointerVY,
    down: false,
    inside: true,
  };

  for (const v of state.views) {
    stage?.updateRect(v.viewId, { top: v.top, left: v.left, width: v.width, height: v.height });
  }
  stage?.setFrame(currentFrameInput(scroll, pointer));
}

/**
 * Sums every registered view's SceneModule.getStats() (optional, additive —
 * see types.ts). Only splat-lounge implements it today, surfacing its
 * SplatMesh's real splat count/sortMs instead of the hardcoded 0/0 this
 * function replaces (see the gap documented in
 * components/deep-wave/SectionSplats.tsx).
 */
function collectSceneStats(): { splats: number; sortMs: number } {
  let splats = 0;
  let sortMs = 0;
  for (const module of moduleByView.values()) {
    const s = module.getStats?.();
    if (!s) continue;
    splats += s.splats ?? 0;
    sortMs = Math.max(sortMs, s.sortMs ?? 0);
  }
  return { splats, sortMs };
}

function postStats(time: number, renderMs: number): void {
  statsAccumMs += renderMs;
  statsAccumFrames += 1;
  if (time - lastStatsPostTime < STATS_INTERVAL_MS) return;

  // renderer.info is real THREE.WebGLRenderer draw-call bookkeeping —
  // gl/renderer.ts's createRenderer() sets `autoReset = false` and
  // gl/stage.ts's render() calls `info.reset()` once per Stage.render(), so
  // by the time we read it here it holds the total calls across every view
  // drawn this frame (previously this posted a hardcoded 0, so the ?debug
  // HUD's "draw calls" row could never show real activity).
  const drawCalls = renderer?.info?.render.calls ?? 0;
  const { splats, sortMs } = collectSceneStats();

  ctx.postMessage({
    type: "STATS",
    ms: statsAccumFrames > 0 ? statsAccumMs / statsAccumFrames : 0,
    drawCalls,
    splats,
    sortMs,
  });
  statsAccumMs = 0;
  statsAccumFrames = 0;
  lastStatsPostTime = time;
}
