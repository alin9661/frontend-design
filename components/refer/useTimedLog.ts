"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Reveals log lines one at a time on a timer — the shared engine behind both
 * fake terminals on /refer (CLEARANCE and PIPELINE BUILD).
 *
 * This is deliberately a hook rather than copy-pasted state in each step. The
 * reduced-motion branch is the part that's easy to get subtly wrong, and
 * having exactly one implementation means there's exactly one thing to test
 * and no chance of the two terminals drifting apart.
 *
 * On why this needs `useReducedMotion()` at all: the global
 * `<MotionConfig reducedMotion="user">` in app/providers.tsx already covers
 * *declarative* framer-motion props. It can't see an imperative `setTimeout`,
 * so timer-driven reveals have to gate themselves — same reason
 * components/FlavorShowcase.tsx:16,40 gates its auto-advance interval.
 *
 * @param total     how many lines exist
 * @param delayMs   gap between lines
 * @returns how many lines should currently be rendered
 */
export function useTimedLog(total: number, delayMs: number): number {
  const prefersReducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    // Reduced motion: skip straight to the fully-resolved terminal. The joke
    // is in the text, not the typing, so nothing is lost by showing it at once.
    if (prefersReducedMotion) {
      setVisible(total);
      return;
    }
    if (visible >= total) return;

    const timer = setTimeout(() => setVisible((n) => n + 1), delayMs);
    return () => clearTimeout(timer);
  }, [prefersReducedMotion, visible, total, delayMs]);

  return visible;
}
