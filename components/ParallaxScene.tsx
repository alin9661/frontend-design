"use client";

// DECISION POINT: motion feel — depth multiplier (40) and spring (stiffness 60, damping 18) define floaty vs snappy.

import { createContext, useContext, useEffect } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";

type ParallaxContextValue = {
  mx: MotionValue<number>;
  my: MotionValue<number>;
};

const ParallaxContext = createContext<ParallaxContextValue | null>(null);

export default function ParallaxScene({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const prefersReducedMotion = useReducedMotion();

  // Raw normalized cursor position (-0.5..0.5), fed through a floaty spring.
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const mx = useSpring(rawX, { stiffness: 60, damping: 18 });
  const my = useSpring(rawY, { stiffness: 60, damping: 18 });

  // Static fallback values used whenever reduced motion is requested.
  const staticX = useMotionValue(0);
  const staticY = useMotionValue(0);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (typeof window === "undefined") return;

    const handlePointerMove = (e: PointerEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const nx = e.clientX / w - 0.5;
      const ny = e.clientY / h - 0.5;
      rawX.set(nx);
      rawY.set(ny);
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
    // rawX/rawY are stable MotionValue refs from useMotionValue; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefersReducedMotion]);

  const value: ParallaxContextValue = prefersReducedMotion
    ? { mx: staticX, my: staticY }
    : { mx, my };

  return (
    <ParallaxContext.Provider value={value}>
      <motion.div className={className} style={{ position: "relative" }}>
        {children}
      </motion.div>
    </ParallaxContext.Provider>
  );
}

export function useParallax(): { mx: MotionValue<number>; my: MotionValue<number> } {
  const ctx = useContext(ParallaxContext);
  // Safe default: static MotionValue(0) when used outside a provider.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fallbackMx = useMotionValue(0);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fallbackMy = useMotionValue(0);
  if (!ctx) {
    return { mx: fallbackMx, my: fallbackMy };
  }
  return ctx;
}
