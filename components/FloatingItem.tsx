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
  // each instance its own duration (5-9s) and a small positive start delay
  // (0 to 3s) so no two items — even at the same depth — move in sync. A
  // negative delay would make the animation start mid-keyframe on mount,
  // which is exactly the jump this component needs to avoid.
  const hash = hashString(`${x}${y}`);
  const duration = BOB_BASE_S + (hash % 400) / 100;
  const delay = (hash % 300) / 100;

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
