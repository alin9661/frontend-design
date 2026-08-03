// lib/engine/react/useScrollProgress.ts
//
// Two ways to read scroll progress (design doc §4 react/):
//   - useScrollProgress(cb): a raw callback subscription, no React state and
//     no re-render — for anything that mutates DOM/GL state imperatively
//     (framer-motion MotionValue.set, GL uniforms) instead of through React.
//   - useScrollProgressValue(throttleMs): a state variant that DOES
//     re-render the calling component, throttled to at most once per
//     `throttleMs` so high-frequency scroll ticks don't flood the scheduler.

"use client";

import { useEffect, useRef, useState } from "react";
import { useEngine } from "./useEngine";

/** Always calls the *latest* `cb` passed in, without resubscribing on every
 * render — only `onScrollProgress` resubscribes the underlying listener,
 * and (unlike the rest of the engine context) it's individually stable
 * across renders, so depending on it directly instead of the whole `engine`
 * object avoids resubscribing on every unrelated status/progress/stats
 * change. */
export function useScrollProgress(cb: (progress: number) => void): void {
  const { onScrollProgress } = useEngine();
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    return onScrollProgress((p) => cbRef.current(p));
  }, [onScrollProgress]);
}

const DEFAULT_THROTTLE_MS = 100;

export function useScrollProgressValue(throttleMs: number = DEFAULT_THROTTLE_MS): number {
  const { onScrollProgress } = useEngine();
  const [value, setValue] = useState(0);

  useEffect(() => {
    let lastEmitMs = -Infinity;
    return onScrollProgress((p) => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastEmitMs >= throttleMs) {
        lastEmitMs = now;
        setValue(p);
      }
    });
  }, [onScrollProgress, throttleMs]);

  return value;
}
