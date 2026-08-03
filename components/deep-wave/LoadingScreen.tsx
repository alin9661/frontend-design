// components/deep-wave/LoadingScreen.tsx
//
// The boot overlay (design doc §5): consumes real status/progress from
// EngineProvider via useEngine() — visible while status is "boot" or
// "loading", gone once the engine reaches "ready" (WorkerToMain's
// ASSETS_DONE) OR "fallback" (RenderHost.init() failed outright — the page
// must stay fully usable GL-less per §6, so the overlay must not get stuck
// covering it). Locks body scroll for as long as it's visible so users
// can't scroll a not-yet-ready page out from under the loader; framer-motion
// handles the exit fade (reduced-motion gets an instant, non-animated one).

"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEngine } from "@/lib/engine/react/useEngine";

export default function LoadingScreen() {
  const { status, progress } = useEngine();
  const reduceMotion = useReducedMotion();
  const visible = status === "boot" || status === "loading";
  const clamped = Math.min(100, Math.max(0, progress));

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [visible]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-forest-deep text-cream"
          exit={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, transition: { duration: 0.5, ease: "easeOut" } }
          }
        >
          <p className="font-body text-xs uppercase tracking-[0.35em] text-cream/70">
            Deep Wave
          </p>
          <p className="font-display uppercase text-3xl">Brewing your lift…</p>
          <div
            className="h-1 w-48 overflow-hidden rounded-full bg-cream/20"
            aria-hidden="true"
          >
            <div className="h-full bg-cream" style={{ width: `${clamped}%` }} />
          </div>
          <p className="font-body text-sm text-cream/60">{Math.round(clamped)}%</p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
