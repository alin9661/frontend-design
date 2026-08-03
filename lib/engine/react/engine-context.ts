// lib/engine/react/engine-context.ts
//
// The EngineProvider context shape (design doc §4 react/), split into its
// own module — deliberately with NO dependency on core/gl/worker or on
// EngineProvider.tsx itself — so consumer hooks (useEngine/useView/
// useScrollProgress) and their tests can depend on just the context's
// *shape* without pulling in engine construction. Tests fabricate an
// `EngineContextValue` and render `<EngineContext.Provider value={...}>`
// directly instead of mounting a real `<EngineProvider>`.
//
// The design doc's summary of the context (§4 react/EngineProvider.tsx)
// lists `{ status, progress, hostMode, registerView, invoke }`; that's a
// representative sample, not the exhaustive shape — `unregisterView` and a
// scroll-progress subscription are obviously required by useView.ts /
// useScrollProgress.ts, and `quality`/`stats` are required by DebugHud
// (§4A: "?debug HUD shows worker: on|off" + design doc §5's ms/drawCalls/
// tier/splats/sortMs row). All additions are additive to the documented
// shape, never a narrowing of it.

"use client";

import { createContext } from "react";
import type { QualityTier, SceneId } from "@/lib/engine/types";

/** boot: before EngineProvider's effect has run (SSR + first client paint).
 * loading: host constructed, RenderHost.init() in flight / assets loading.
 * ready: WorkerToMain's ASSETS_DONE received.
 * fallback: RenderHost.init() rejected (no usable WebGL at all) — the page
 * still works, GL-less, per §6's a11y requirement. */
export type EngineStatus = "boot" | "loading" | "ready" | "fallback";

/** Mirrors WorkerToMain's STATS message — surfaced for DebugHud. */
export interface EngineStats {
  ms: number;
  drawCalls: number;
  splats: number;
  sortMs: number;
}

export interface EngineContextValue {
  status: EngineStatus;
  /** 0-100, from WorkerToMain's ASSET_PROGRESS. */
  progress: number;
  /** RenderHost.mode, available as soon as createRenderHost() runs — null
   * only before the engine effect has mounted. */
  hostMode: "worker" | "main" | null;
  /** Detected once at boot; null before the engine effect has mounted. */
  quality: QualityTier | null;
  /** Latest STATS message, or null until the first one arrives. */
  stats: EngineStats | null;
  /** Starts tracking `el` as scene `sceneId`'s view. Returns a viewId to
   * pass to `unregisterView`/`invoke`. Safe to call before the engine has
   * finished booting (queued and flushed once the RenderHost is ready). */
  registerView: (el: HTMLElement, sceneId: SceneId) => number;
  unregisterView: (viewId: number) => void;
  invoke: (viewId: number, method: string, args: unknown[]) => void;
  /** Callback subscription to per-tick scroll progress (0..1). Returns an
   * unsubscribe function. No React state/re-render involved. */
  onScrollProgress: (cb: (progress: number) => void) => () => void;
}

export const EngineContext = createContext<EngineContextValue | null>(null);
