"use client";

import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { useParallax } from "@/components/ParallaxScene";

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

  const translateX = useTransform(mx, (v) => v * depth * 40);
  // Mouse offset + scroll drift: deeper items drift apart faster on scroll.
  const translateY = useTransform<number, number>([my, scrollY], ([m, s]) => m * depth * 40 + s * depth * -0.12);

  // Desync each item's idle bob so the page reads alive, not synchronized.
  const duration = 5 + ((depth * 2.7) % 4);

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
                y: [-12, 12],
                rotate: [-5, 5],
              }
        }
        transition={
          prefersReducedMotion
            ? undefined
            : {
                duration,
                ease: "easeInOut",
                repeat: Infinity,
                repeatType: "mirror",
              }
        }
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
