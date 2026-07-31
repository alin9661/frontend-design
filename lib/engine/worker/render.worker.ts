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
// current public API allows — see the two TODO/NOTE comments below for the
// two spots where it can't (Post's composer needs a fixed scene/camera at
// construction, and Stage exposes no per-view scene/camera/targets getter
// for raycasting). Both are cross-workstream contract gaps for whoever
// extends gl/Stage next, not bugs in this file — see the M1 "worker"
// workstream return notes.

import { AssetManager } from "../gl/assets";
import { ContextLossHandler, type ContextLossTarget } from "../gl/context-loss";
import { createRenderer, setSize } from "../gl/renderer";
import { Stage, type StageFrameInput } from "../gl/stage";
import type { MainToWorker, QualityTier, RectData, SceneId, WorkerToMain } from "../types";
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
      break;
    case "SCENE_INVOKE":
      // Stage has no per-view SceneModule getter yet (see the block comment
      // above) — SCENE_INVOKE can't be routed until gl/Stage exposes one.
      console.warn(
        `[deep-wave worker] SCENE_INVOKE for view ${msg.viewId} dropped: ` +
          "Stage doesn't expose a per-view SceneModule getter yet"
      );
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

  renderer = createRenderer({ canvas });
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

function postStats(time: number, renderMs: number): void {
  statsAccumMs += renderMs;
  statsAccumFrames += 1;
  if (time - lastStatsPostTime < STATS_INTERVAL_MS) return;

  ctx.postMessage({
    type: "STATS",
    ms: statsAccumFrames > 0 ? statsAccumMs / statsAccumFrames : 0,
    drawCalls: 0,
    splats: 0,
    sortMs: 0,
  });
  statsAccumMs = 0;
  statsAccumFrames = 0;
  lastStatsPostTime = time;
}
