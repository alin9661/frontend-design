"use client";

import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { useParallax, PARALLAX_SHIFT_PX, SCROLL_DRIFT, BOB_BASE_S } from "@/components/ParallaxScene";

// Tiny deterministic string hash (no crypto needed — just needs to scatter
// same-depth items apart). Used to desync each instance's idle-bob timing
// from its position props, so items sharing a depth tier don't bob in
// lockstep.
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Pure hash -> idle-bob timing, extracted so the desync math is directly
 * testable (A2/A3 regression coverage — the original P1 fix shipped without
 * a test for this).
 *
 * A2 fix: the keyframes below used to be `y: [-12, 12]` with
 * `repeatType: "mirror"`, so `duration` covered ONE traverse and the mirror
 * made the full there-and-back cycle `2 * duration`. They're now
 * rest-passing (`[0, -12, 0, 12, 0]`) with the default "loop" repeat, which
 * folds the WHOLE round trip into a single `duration` — so the base is
 * doubled here to keep the actual bob pace unchanged from before that
 * keyframe change (full cycle still lands in the original ~10-18s range).
 *
 * A3 fix: `delay` used to range 0-3s, which could land squarely on the
 * hero's entrance choreography and leave an item dead-still for up to 3s on
 * first paint. Shrunk to ~0-1.2s. Delay must stay >= 0 — a negative delay
 * starts the animation mid-keyframe on mount, which is the jump the
 * rest-passing keyframes exist to avoid.
 */
export function bobTimingFor(x: string, y: string): { duration: number; delay: number } {
  const hash = hashString(`${x}${y}`);
  const duration = (BOB_BASE_S + (hash % 400) / 100) * 2;
  const delay = (hash % 120) / 100;
  return { duration, delay };
}

export default function FloatingItem({
  depth = 1,
  x,
  y,
  className,
  children,
}: {
  depth?: number;
  x: string;
  y: string;
  className?: string;
  children: React.ReactNode;
}) {
  const prefersReducedMotion = useReducedMotion();
  const { mx, my } = useParallax();

  const { scrollY } = useScroll();

  const translateX = useTransform(mx, (v) => v * depth * PARALLAX_SHIFT_PX);
  // Mouse offset (unbounded, spring-settled) + scroll drift. The drift is
  // bounded to the first 900px of scroll so deep items stop racing apart
  // forever once the user has scrolled well past the hero.
  const scrollDrift = useTransform(scrollY, [0, 900], [0, 900 * depth * SCROLL_DRIFT], {
    clamp: true,
  });
  const translateY = useTransform<number, number>(
    [my, scrollDrift],
    ([m, s]) => m * depth * PARALLAX_SHIFT_PX + s
  );

  // Desync each item's idle bob so the page reads alive, not synchronized:
  // same-depth items previously shared an identical duration (depth-only),
  // so they bobbed in perfect lockstep. Hashing the x/y position props gives
  // each instance its own duration (~10-18s full cycle) and a small
  // positive start delay (0 to ~1.2s) so no two items — even at the same
  // depth — move in sync, without landing dead-still through the hero's
  // entrance choreography. See `bobTimingFor`'s doc comment for the A2/A3
  // regression this restores.
  const { duration, delay } = bobTimingFor(x, y);

  return (
    <motion.div
      className={className}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: x,
        top: y,
        pointerEvents: "none",
        x: prefersReducedMotion ? 0 : translateX,
        y: prefersReducedMotion ? 0 : translateY,
      }}
    >
      <motion.div
        animate={
          prefersReducedMotion
            ? undefined
            : {
                y: [0, -12, 0, 12, 0],
                rotate: [0, -5, 0, 5, 0],
              }
        }
        transition={
          prefersReducedMotion
            ? undefined
            : {
                duration,
                delay,
                ease: "easeInOut",
                repeat: Infinity,
              }
        }
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
