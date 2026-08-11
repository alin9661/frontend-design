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
import { detectQualityTier } from "@/lib/engine/core/quality";
import { packFrameState } from "@/lib/engine/worker/protocol";
import { sceneRegistry } from "@/lib/engine/worker/scene-registry";
import { TickOrder } from "@/lib/engine/types";
import { createEngineDeps, type EngineDeps } from "./create-engine";
import {
  EngineContext,
  type EngineContextValue,
  type EngineStats,
  type EngineStatus,
  type RegisterViewOptions,
} from "./engine-context";
import GlCanvas, { type GlCanvasHandle } from "./GlCanvas";
import RisoGrainOverlay from "./RisoGrainOverlay";

export interface EngineProviderProps {
  children: ReactNode;
}

interface ViewEntry {
  sceneId: SceneId;
  el: HTMLElement;
  tracked: TrackedRect | null;
  /** Non-null only for `sticky` views: the taller scroll-range element and
   * its own tracked rect. See stickyFrame() below. */
  rangeEl: HTMLElement | null;
  range: TrackedRect | null;
  /** This view asked for the shared post chain — see RegisterViewOptions.post.
   * Kept on the entry (not just passed through) so a view registered before
   * `host.init()` resolved still opts in when the queue is flushed. */
  post: boolean;
}

function toRectData(t: TrackedRect): RectData {
  return { top: t.top, left: t.left, width: t.width, height: t.height };
}

/**
 * Per-frame rect + progress for a `position: sticky; top: 0` view.
 *
 * `sticky` is the element's STATIC (unstuck) measurement — correct width and
 * height, useless top. `range` is the tall parent it is pinned within. While
 * the page is scrolled inside the range the element's real document top is
 * exactly `scrollY`; before and after it is clamped to the ends of its travel.
 * Progress runs 0 at "range top hits viewport top" to 1 at "range bottom hits
 * viewport bottom" — identical to framer-motion's
 * `useScroll({ offset: ["start start", "end end"] })` on the same element, so
 * a DOM film and a GL film sharing a section stay frame-locked.
 *
 * Pure arithmetic over two already-measured rects: no layout read per frame.
 */
export function stickyFrame(
  sticky: RectData,
  range: RectData,
  scrollY: number
): { rect: RectData; progress: number } {
  const travel = Math.max(0, range.height - sticky.height);
  const top = Math.min(Math.max(scrollY, range.top), range.top + travel);
  const progress = travel > 0 ? Math.min(1, Math.max(0, (scrollY - range.top) / travel)) : 0;
  return {
    rect: { top, left: sticky.left, width: sticky.width, height: sticky.height },
    progress,
  };
}

function detectReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The route this canvas is being created for, for gl/post.ts's route gate.
 *
 * `location.pathname` rather than next/navigation's `usePathname()`: the
 * engine is constructed exactly once, in a mount effect, and the route it was
 * mounted on is the one its Stage (and therefore its post chain) belongs to —
 * a client-side navigation tears this provider down and builds a new one, so
 * subscribing to route changes would only add a dependency and a re-render for
 * a value that cannot change under it.
 *
 * `undefined` off-DOM is deliberate and is NOT the same as `""`: gl/post.ts
 * treats an unset route as "caller does not know where it is" (no grain),
 * while `""` normalises to `"/"` and would claim the landing page.
 */
function detectRoute(): string | undefined {
  return typeof location === "undefined" ? undefined : location.pathname;
}

function detectDpr(): number {
  return typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
}

function scrollLimit(): number {
  if (typeof document === "undefined" || typeof window === "undefined") return 0;
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

/** The rect a view is first added with. Sticky views get their pinned rect
 * for the current scroll position rather than their unstuck measurement, so
 * `SceneModule.init()` sees the same box the first rendered frame will use. */
function initialRect(entry: { tracked: TrackedRect; range: TrackedRect | null }): RectData {
  const sticky = toRectData(entry.tracked);
  if (!entry.range) return sticky;
  const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
  return stickyFrame(sticky, toRectData(entry.range), scrollY).rect;
}

export default function EngineProvider({ children }: EngineProviderProps) {
  const canvasRef = useRef<GlCanvasHandle | null>(null);
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
  const [readyViewIds, setReadyViewIds] = useState<ReadonlySet<number>>(() => new Set());
  // Mirrors the effect's own `detectReducedMotion()` into render, for the
  // riso fallback overlay. Starts `false` so the server pass and the first
  // client render agree; the effect corrects it in the same commit that
  // detects the quality tier, and the overlay needs both anyway.
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    statusRef.current = "loading";
    setStatus("loading");

    const reducedMotion = detectReducedMotion();
    setReducedMotion(reducedMotion);
    // Cache warm only: start a scene-chunk import while the engine core
    // modules and worker host are being fetched. The worker's matching import
    // then reuses the browser's warm HTTP cache. Failures are contained because
    // this speculative request is not an initialization dependency.
    void sceneRegistry["hero-can"]()
      .then((scene) => scene.dispose())
      .catch(() => {});

    const deps = createEngineDeps(reducedMotion);
    depsRef.current = deps;
    hostReadyRef.current = false;
    setReadyViewIds(new Set());

    setHostMode(deps.host.mode);
    deps.scroll.resize(scrollLimit());

    // Adopt any views a child registered before this effect ran (first
    // mount, ref callbacks fire before effects) or left orphaned by a prior
    // cleanup (StrictMode's mount→cleanup→mount dev simulation).
    for (const [viewId, entry] of viewsRef.current) {
      if (!entry.tracked) {
        entry.tracked = deps.rectTracker.track(entry.el);
        if (entry.rangeEl) entry.range = deps.rectTracker.track(entry.rangeEl);
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
      } else if (msg.type === "VIEW_READY") {
        setReadyViewIds((current) => {
          if (current.has(msg.viewId)) return current;
          const next = new Set(current);
          next.add(msg.viewId);
          return next;
        });
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

    // A DOM canvas is a single-use resource once transferred off-thread.
    // Every host.init attempt must mint first — including any future retry
    // from WorkerHost to MainThreadHost — because neither host can reuse a
    // canvas previously handed to a terminated worker.
    const canvas = canvasRef.current?.mint();
    const initPromise = canvas
      ? deps.host.init(canvas, {
          dpr: detectDpr(),
          quality: tier,
          reducedMotion,
          route: detectRoute(),
        })
      : Promise.reject(new Error("EngineProvider: <GlCanvas> surface slot not attached"));

    initPromise
      .then(() => {
        if (cancelled) return;
        hostReadyRef.current = true;
        for (const viewId of pendingViewIdsRef.current) {
          const entry = viewsRef.current.get(viewId);
          if (entry?.tracked) {
            deps.host.addView(
              viewId,
              entry.sceneId,
              initialRect(entry as { tracked: TrackedRect; range: TrackedRect | null }),
              { post: entry.post },
            );
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
        .map(([viewId, entry]) => {
          // A sticky view's tracked rect is its unstuck position, which would
          // cull it one viewport into a multi-viewport section and pin its
          // progress at 0.5 — recompute both against the scroll range.
          if (entry.range) {
            const { rect, progress } = stickyFrame(
              toRectData(entry.tracked),
              toRectData(entry.range),
              scrollState.current
            );
            return { viewId, ...rect, progress };
          }
          return {
            viewId,
            top: entry.tracked.top,
            left: entry.tracked.left,
            width: entry.tracked.width,
            height: entry.tracked.height,
            progress: entry.tracked.progress(scrollState.current, viewportH),
          };
        });

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
        entry.range = null;
      }
    };
  }, []);

  const registerView = useCallback(
    (el: HTMLElement, sceneId: SceneId, opts?: RegisterViewOptions): number => {
      const viewId = viewIdCounterRef.current++;
      const deps = depsRef.current;
      const rangeEl = opts?.sticky ? (opts.rangeEl ?? el.parentElement) : null;
      const tracked = deps ? deps.rectTracker.track(el) : null;
      const range = deps && rangeEl ? deps.rectTracker.track(rangeEl) : null;
      const post = opts?.post === true;
      viewsRef.current.set(viewId, { sceneId, el, tracked, rangeEl, range, post });

      if (deps && tracked) {
        if (hostReadyRef.current) {
          deps.host.addView(viewId, sceneId, initialRect({ tracked, range }), { post });
        } else {
          pendingViewIdsRef.current.add(viewId);
        }
      }
      return viewId;
    },
    []
  );

  const unregisterView = useCallback((viewId: number) => {
    const entry = viewsRef.current.get(viewId);
    if (!entry) return;
    viewsRef.current.delete(viewId);
    pendingViewIdsRef.current.delete(viewId);
    setReadyViewIds((current) => {
      if (!current.has(viewId)) return current;
      const next = new Set(current);
      next.delete(viewId);
      return next;
    });

    const deps = depsRef.current;
    if (deps && entry.tracked) {
      deps.rectTracker.untrack(entry.el);
      if (entry.rangeEl) deps.rectTracker.untrack(entry.rangeEl);
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

  const isViewReady = useCallback((viewId: number) => readyViewIds.has(viewId), [readyViewIds]);

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
      isViewReady,
      onScrollProgress,
    }),
    [status, progress, hostMode, quality, stats, registerView, unregisterView, invoke, isViewReady, onScrollProgress]
  );

  return (
    <EngineContext.Provider value={contextValue}>
      <GlCanvas ref={canvasRef} />
      {/* The non-GL half of the riso treatment. Renders only on the tier
          where gl/post.ts declines the GPU pass, so the print texture
          degrades instead of disappearing — see RisoGrainOverlay. */}
      <RisoGrainOverlay
        quality={quality}
        reducedMotion={reducedMotion}
        route={detectRoute()}
      />
      {children}
    </EngineContext.Provider>
  );
}
