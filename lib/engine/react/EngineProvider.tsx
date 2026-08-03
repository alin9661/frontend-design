// lib/engine/react/EngineProvider.tsx
//
// Root of the react/ bindings (design doc §4 react/EngineProvider.tsx).
// Renders <GlCanvas/> (fixed, inset-0, aria-hidden, z-0, behind children) +
// children, with IDENTICAL markup on the server and the first client
// render — every stateful/browser-only value below defaults to its "boot"
// value ("boot" status, 0 progress, null hostMode/quality/stats) until the
// mount effect runs, so there is nothing for hydration to disagree about.
//
// Ticker/VirtualScroll/RectTracker/PointerTracker/RenderHost are
// constructed ONLY inside that mount effect (via ./create-engine, kept in
// its own module purely as a test seam — see that file's header), and torn
// down symmetrically in the effect's cleanup: every `new X()` in
// createEngineDeps() is matched by exactly one teardown call below
// (ticker.stop / scroll.destroy / pointer.destroy / host.destroy), so
// React StrictMode's mount→cleanup→mount dev simulation leaves no leak —
// the first (thrown-away) engine instance is fully destroyed before the
// second one is built.
//
// registerView/unregisterView (exposed via context, consumed through
// useView.ts) can be called *before* this effect has run — a child's ref
// callback commits in the same phase as this component's own <GlCanvas>
// ref, which is before any effect fires. Views registered that early are
// recorded with `tracked: null` and "adopted" (measured + queued) at the
// top of the mount effect; views registered after mount are tracked
// immediately. Either way, the actual `host.addView` call is deferred until
// `host.init()` resolves (`hostReadyRef`), queued in `pendingViewIdsRef` in
// the meantime.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RectData, SceneId, TrackedRect, WorkerToMain } from "@/lib/engine/types";
import { detectQualityTier } from "@/lib/engine/gl/renderer";
import { packFrameState } from "@/lib/engine/worker/protocol";
import { TickOrder } from "@/lib/engine/types";
import { createEngineDeps, type EngineDeps } from "./create-engine";
import {
  EngineContext,
  type EngineContextValue,
  type EngineStats,
  type EngineStatus,
} from "./engine-context";
import GlCanvas from "./GlCanvas";

export interface EngineProviderProps {
  children: ReactNode;
}

interface ViewEntry {
  sceneId: SceneId;
  el: HTMLElement;
  tracked: TrackedRect | null;
}

function toRectData(t: TrackedRect): RectData {
  return { top: t.top, left: t.left, width: t.width, height: t.height };
}

function detectReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function detectDpr(): number {
  return typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
}

function scrollLimit(): number {
  if (typeof document === "undefined" || typeof window === "undefined") return 0;
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

export default function EngineProvider({ children }: EngineProviderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const depsRef = useRef<EngineDeps | null>(null);
  const hostReadyRef = useRef(false);
  const viewIdCounterRef = useRef(0);
  const viewsRef = useRef<Map<number, ViewEntry>>(new Map());
  const pendingViewIdsRef = useRef<Set<number>>(new Set());
  const scrollSubsRef = useRef<Set<(p: number) => void>>(new Set());
  const statusRef = useRef<EngineStatus>("boot");

  const [status, setStatus] = useState<EngineStatus>("boot");
  const [progress, setProgress] = useState(0);
  const [hostMode, setHostMode] = useState<"worker" | "main" | null>(null);
  const [quality, setQuality] = useState<ReturnType<typeof detectQualityTier> | null>(null);
  const [stats, setStats] = useState<EngineStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    statusRef.current = "loading";
    setStatus("loading");

    const reducedMotion = detectReducedMotion();
    const deps = createEngineDeps(reducedMotion);
    depsRef.current = deps;
    hostReadyRef.current = false;

    setHostMode(deps.host.mode);
    deps.scroll.resize(scrollLimit());

    // Adopt any views a child registered before this effect ran (first
    // mount, ref callbacks fire before effects) or left orphaned by a prior
    // cleanup (StrictMode's mount→cleanup→mount dev simulation).
    for (const [viewId, entry] of viewsRef.current) {
      if (!entry.tracked) {
        entry.tracked = deps.rectTracker.track(entry.el);
      }
      pendingViewIdsRef.current.add(viewId);
    }

    const unsubMessage = deps.host.onMessage((msg: WorkerToMain) => {
      if (cancelled) return;
      if (msg.type === "ASSET_PROGRESS") {
        setProgress(Math.round(Math.min(1, Math.max(0, msg.p)) * 100));
      } else if (msg.type === "ASSETS_DONE") {
        setProgress(100);
        statusRef.current = "ready";
        setStatus("ready");
      } else if (msg.type === "STATS") {
        setStats({ ms: msg.ms, drawCalls: msg.drawCalls, splats: msg.splats, sortMs: msg.sortMs });
      }
      // READY / HIT / CONTEXT_LOST / CONTEXT_RESTORED aren't consumed here:
      // READY only signals the render context exists (handled internally by
      // RenderHost.init()'s own promise), HIT feeds a scene's onPointer
      // (worker-side), and CONTEXT_LOST/RESTORED recovery is centralized in
      // gl/context-loss.ts + the host, transparent to react/.
    });

    const tier = detectQualityTier({
      hardwareConcurrency: typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4,
      dpr: detectDpr(),
    });
    setQuality(tier);

    const canvas = canvasRef.current;
    const initPromise = canvas
      ? deps.host.init(canvas, { dpr: detectDpr(), quality: tier, reducedMotion })
      : Promise.reject(new Error("EngineProvider: <GlCanvas> ref not attached"));

    initPromise
      .then(() => {
        if (cancelled) return;
        hostReadyRef.current = true;
        for (const viewId of pendingViewIdsRef.current) {
          const entry = viewsRef.current.get(viewId);
          if (entry?.tracked) {
            deps.host.addView(viewId, entry.sceneId, toRectData(entry.tracked));
          }
        }
        pendingViewIdsRef.current.clear();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (process.env.NODE_ENV !== "production") {
          console.error("[deep-wave] RenderHost.init() failed — falling back to GL-less mode", err);
        }
        statusRef.current = "fallback";
        setStatus("fallback");
      });

    const unsubTick = deps.ticker.add((_dt, _elapsed) => {
      const scrollState = deps.scroll.state;
      const pointerState = deps.pointer.state;

      for (const cb of scrollSubsRef.current) cb(scrollState.progress);

      const viewportH = typeof window !== "undefined" ? window.innerHeight : 0;
      const views = Array.from(viewsRef.current.entries())
        .filter((entry): entry is [number, ViewEntry & { tracked: TrackedRect }] => entry[1].tracked !== null)
        .map(([viewId, entry]) => ({
          viewId,
          top: entry.tracked.top,
          left: entry.tracked.left,
          width: entry.tracked.width,
          height: entry.tracked.height,
          progress: entry.tracked.progress(scrollState.current, viewportH),
        }));

      const packed = packFrameState(
        {
          scrollCurrent: scrollState.current,
          scrollVelocity: scrollState.velocity,
          scrollProgress: scrollState.progress,
          pointerX: pointerState.x,
          pointerY: pointerState.y,
          pointerVX: pointerState.vx,
          pointerVY: pointerState.vy,
          // Real PointerTracker state (design review item A) — both
          // RenderHost implementations previously hardcoded
          // `down: false, inside: true` instead of reading this.
          pointerDown: pointerState.down,
          pointerInside: pointerState.inside,
        },
        views
      );
      deps.host.frame(packed);
    }, TickOrder.RENDER);

    deps.ticker.start();

    const handleResize = () => {
      deps.rectTracker.refresh(window.scrollY);
      deps.scroll.resize(scrollLimit());
      deps.host.resize(window.innerWidth, window.innerHeight, detectDpr());
    };
    window.addEventListener("resize", handleResize);
    handleResize();

    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(() => {
        if (!cancelled) {
          deps.rectTracker.refresh(window.scrollY);
          deps.scroll.resize(scrollLimit());
        }
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("resize", handleResize);
      unsubTick();
      unsubMessage();
      deps.ticker.stop();
      deps.scroll.destroy();
      deps.pointer.destroy();
      deps.host.destroy();

      depsRef.current = null;
      hostReadyRef.current = false;
      pendingViewIdsRef.current.clear();
      // Views themselves outlive a single effect run (they're owned by
      // useView()'s mount lifecycle, not this one) — just drop each one's
      // stale rect so the next effect run re-tracks it against the new
      // RectTracker instance.
      for (const entry of viewsRef.current.values()) {
        entry.tracked = null;
      }
    };
  }, []);

  const registerView = useCallback((el: HTMLElement, sceneId: SceneId): number => {
    const viewId = viewIdCounterRef.current++;
    const deps = depsRef.current;
    const tracked = deps ? deps.rectTracker.track(el) : null;
    viewsRef.current.set(viewId, { sceneId, el, tracked });

    if (deps && tracked) {
      if (hostReadyRef.current) {
        deps.host.addView(viewId, sceneId, toRectData(tracked));
      } else {
        pendingViewIdsRef.current.add(viewId);
      }
    }
    return viewId;
  }, []);

  const unregisterView = useCallback((viewId: number) => {
    const entry = viewsRef.current.get(viewId);
    if (!entry) return;
    viewsRef.current.delete(viewId);
    pendingViewIdsRef.current.delete(viewId);

    const deps = depsRef.current;
    if (deps && entry.tracked) {
      deps.rectTracker.untrack(entry.el);
      if (hostReadyRef.current) {
        deps.host.removeView(viewId);
      }
    }
  }, []);

  const invoke = useCallback((viewId: number, method: string, args: unknown[]) => {
    const deps = depsRef.current;
    if (deps && hostReadyRef.current) {
      deps.host.invoke(viewId, method, args);
    }
  }, []);

  const onScrollProgress = useCallback((cb: (progress: number) => void) => {
    scrollSubsRef.current.add(cb);
    return () => {
      scrollSubsRef.current.delete(cb);
    };
  }, []);

  const contextValue = useMemo<EngineContextValue>(
    () => ({
      status,
      progress,
      hostMode,
      quality,
      stats,
      registerView,
      unregisterView,
      invoke,
      onScrollProgress,
    }),
    [status, progress, hostMode, quality, stats, registerView, unregisterView, invoke, onScrollProgress]
  );

  return (
    <EngineContext.Provider value={contextValue}>
      <GlCanvas ref={canvasRef} />
      {children}
    </EngineContext.Provider>
  );
}
