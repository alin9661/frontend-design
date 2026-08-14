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

export interface RegisterViewOptions {
  /**
   * The registered element is `position: sticky; top: 0` inside a taller
   * scroll range (its parent, unless `rangeEl` says otherwise).
   *
   * RectTracker measures a STATIC document-space rect, only on track/resize —
   * never on scroll. For a sticky element that measurement is its *unstuck*
   * position, so without this flag the view is culled the moment the page
   * scrolls one viewport past the section top, and its progress reads 0.5 at
   * the section's start instead of 0. With it, EngineProvider recomputes the
   * pinned rect and the range-relative progress every frame — from the two
   * static rects plus scrollY, so still with zero per-frame layout reads.
   *
   * Progress matches framer-motion's `useScroll({ offset: ["start start",
   * "end end"] })` over the same range element, so a DOM film and a GL film
   * driven off the same section stay in lockstep.
   */
  sticky?: boolean;
  /** Scroll range for `sticky`. Defaults to the registered element's parent. */
  rangeEl?: HTMLElement | null;
  /**
   * Ask for the shared post-processing chain (bloom + SMAA + riso grain) on
   * this view. Forwarded to `RenderHost.addView` and on to `Stage.addView`.
   *
   * A request, not a guarantee: a composer owns the whole drawing buffer, so
   * gl/stage.ts only honours it on a frame where this is the ONLY view drawing
   * and its rect covers the viewport. Every other arrangement silently takes
   * the ordinary scissored path.
   */
  post?: boolean;
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
  registerView: (el: HTMLElement, sceneId: SceneId, opts?: RegisterViewOptions) => number;
  unregisterView: (viewId: number) => void;
  invoke: (viewId: number, method: string, args: unknown[]) => void;
  /** Whether this view's SceneModule.init() has completed. Optional so
   * narrow test/legacy context doubles fail safe by keeping fallback art. */
  isViewReady?: (viewId: number) => boolean;
  /** Callback subscription to per-tick scroll progress (0..1). Returns an
   * unsubscribe function. No React state/re-render involved. */
  onScrollProgress: (cb: (progress: number) => void) => () => void;
}

export const EngineContext = createContext<EngineContextValue | null>(null);
