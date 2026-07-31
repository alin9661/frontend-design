// lib/engine/types.ts
//
// Deep Wave engine — ALL cross-module contracts. FROZEN after M0 (see
// docs/deep-wave-engine-design.md §3, §4). Every later module (core/, gl/,
// worker/, react/) imports its shapes from here instead of redeclaring them,
// so this file is the single source of truth the whole engine compiles
// against.
//
// `three` is imported type-only: this file must stay usable from worker
// context (no DOM, no runtime three) and from pure unit tests.

import type * as THREE from "three";

// ---------------------------------------------------------------------------
// core/ticker.ts
// ---------------------------------------------------------------------------

export type TickFn = (dt: number, elapsed: number) => void;

export const TickOrder = {
  INPUT: 0,
  SCROLL: 10,
  SCENE: 20,
  RENDER: 30,
} as const;

export type TickOrderValue = (typeof TickOrder)[keyof typeof TickOrder];

// ---------------------------------------------------------------------------
// core/scroll.ts + core/normalize-wheel.ts
// ---------------------------------------------------------------------------

export interface ScrollState {
  target: number;
  current: number;
  velocity: number; // px/s
  progress: number;
  limit: number;
}

export interface ScrollOptions {
  lambda?: number; // default 8
  wheelMultiplier?: number;
  el?: Window; // injectable for tests
  reducedMotion?: boolean; // injectable; defaults to matchMedia
}

// ---------------------------------------------------------------------------
// core/rect-tracker.ts
// ---------------------------------------------------------------------------

/** Plain, Float32Array-friendly, structured-clone-safe rect record. */
export interface RectData {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TrackedRect extends RectData {
  inView(scrollY: number, viewportH: number, margin?: number): boolean;
  viewportY(scrollY: number): number;
  progress(scrollY: number, viewportH: number): number; // 0 enter-bottom → 1 leave-top
}

// ---------------------------------------------------------------------------
// core/pointer.ts
// ---------------------------------------------------------------------------

/** Normalized viewport pointer state; velocity is damp-smoothed. */
export interface PointerState {
  x: number; // normalized viewport, -1..1
  y: number; // normalized viewport, -1..1
  vx: number;
  vy: number;
  down: boolean;
  inside: boolean;
}

/** A raycast hit result — structured-clone-safe (crosses postMessage). */
export interface PointerHit {
  x: number; // NDC within the view, -1..1
  y: number; // NDC within the view, -1..1
  point: { x: number; y: number; z: number };
  distance: number;
  faceIndex?: number;
  instanceId?: number;
}

// ---------------------------------------------------------------------------
// gl/renderer.ts
// ---------------------------------------------------------------------------

export type QualityTier = "high" | "medium" | "low";

/**
 * Minimal mock seam for THREE.WebGLRenderer — everything Stage/renderer.ts
 * actually calls. Lets tests substitute a fake renderer instead of spinning
 * up a real WebGL context.
 */
export interface RendererLike {
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setScissor(x: number, y: number, width: number, height: number): void;
  setScissorTest(enabled: boolean): void;
  setViewport(x: number, y: number, width: number, height: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
  domElement?: HTMLCanvasElement | OffscreenCanvas;
}

// ---------------------------------------------------------------------------
// gl/assets.ts
// ---------------------------------------------------------------------------

export interface AssetManager {
  add<T>(id: string, weight: number, job: () => Promise<T>): void;
  get<T>(id: string): T;
  start(): Promise<void>;
  onProgress(cb: (p: number, id: string) => void): () => void;
}

// ---------------------------------------------------------------------------
// gl/ SceneModule + ViewContext (§4, Stage)
// ---------------------------------------------------------------------------

export type SceneId =
  | "hero-can"
  | "exploded"
  | "particles"
  | "pointer-field"
  | "splat-lounge"
  | "picker"
  | "placeholder";

export interface ViewContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rect: RectData;
  scroll: Readonly<ScrollState>;
  pointer: PointerState;
  assets: AssetManager;
  size: { width: number; height: number; dpr: number };
  quality: QualityTier;
  reducedMotion: boolean;
}

export interface SceneModule {
  init(ctx: ViewContext): void | Promise<void>; // MUST be re-runnable (context restore)
  update(dt: number, ctx: ViewContext): void; // only called while inView
  onProgress?(p: number): void; // drives Timeline.sample
  onPointer?(hit: PointerHit | null): void;
  invoke?(method: string, args: unknown[]): void; // cross-thread scene RPC (picker select etc.)
  resize?(w: number, h: number): void;
  dispose(): void; // MUST free geometries/materials/targets
}

// ---------------------------------------------------------------------------
// gl/timeline.ts
// ---------------------------------------------------------------------------

export type Ease = (t: number) => number;

export interface TrackKeyframe {
  t: number; // 0..1
  v: number;
  ease?: Ease;
}

// ---------------------------------------------------------------------------
// gl/splats/formats.ts
// ---------------------------------------------------------------------------

export interface SplatData {
  count: number;
  positions: Float32Array; // 3n
  scales: Float32Array; // 3n
  colors: Uint8Array; // 4n (rgba)
  quats: Uint8Array; // 4n
}

// ---------------------------------------------------------------------------
// worker/protocol.ts — main<->worker message union types
// ---------------------------------------------------------------------------

export interface InitMessage {
  type: "INIT";
  canvas: OffscreenCanvas;
  dpr: number;
  quality: QualityTier;
  reducedMotion: boolean;
}

export interface FrameStateMessage {
  type: "FRAME_STATE";
  state: Float32Array; // transferable — see protocol.ts pack/unpack
}

export interface ResizeMessage {
  type: "RESIZE";
  width: number;
  height: number;
  dpr: number;
}

export interface ViewAddMessage {
  type: "VIEW_ADD";
  viewId: number;
  sceneId: SceneId;
  rect: RectData;
}

export interface ViewRemoveMessage {
  type: "VIEW_REMOVE";
  viewId: number;
}

export interface SceneInvokeMessage {
  type: "SCENE_INVOKE";
  viewId: number;
  method: string;
  args: unknown[];
}

export interface SetReducedMotionMessage {
  type: "SET_REDUCED_MOTION";
  on: boolean;
}

export interface DisposeMessage {
  type: "DISPOSE";
}

export type MainToWorker =
  | InitMessage
  | FrameStateMessage
  | ResizeMessage
  | ViewAddMessage
  | ViewRemoveMessage
  | SceneInvokeMessage
  | SetReducedMotionMessage
  | DisposeMessage;

export interface ReadyMessage {
  type: "READY";
}

export interface AssetProgressMessage {
  type: "ASSET_PROGRESS";
  p: number;
  id: string;
}

export interface AssetsDoneMessage {
  type: "ASSETS_DONE";
}

export interface HitMessage {
  type: "HIT";
  viewId: number;
  hit: PointerHit | null;
}

export interface StatsMessage {
  type: "STATS";
  ms: number;
  drawCalls: number;
  splats: number;
  sortMs: number;
}

export interface ContextLostMessage {
  type: "CONTEXT_LOST";
}

export interface ContextRestoredMessage {
  type: "CONTEXT_RESTORED";
}

export type WorkerToMain =
  | ReadyMessage
  | AssetProgressMessage
  | AssetsDoneMessage
  | HitMessage
  | StatsMessage
  | ContextLostMessage
  | ContextRestoredMessage;

// ---------------------------------------------------------------------------
// worker/host.ts — main-thread facade (RenderHost)
// ---------------------------------------------------------------------------

export interface HostInit {
  dpr: number;
  quality: QualityTier;
  reducedMotion: boolean;
}

export interface RenderHost {
  readonly mode: "worker" | "main";
  init(canvas: HTMLCanvasElement, opts: HostInit): Promise<void>;
  frame(state: Float32Array): void;
  addView(viewId: number, sceneId: SceneId, rect: RectData): void;
  removeView(viewId: number): void;
  invoke(viewId: number, method: string, args: unknown[]): void;
  onMessage(cb: (m: WorkerToMain) => void): () => void;
  resize(w: number, h: number, dpr: number): void;
  destroy(): void;
}
