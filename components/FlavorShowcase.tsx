"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Can from "@/components/svg/Can";
import { flavors } from "@/lib/flavors";

const AUTO_ADVANCE_MS = 4000;

export default function FlavorShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = flavors[activeIndex];

  useEffect(() => {
    if (isHovering || prefersReducedMotion) return;

    timerRef.current = setInterval(() => {
      setActiveIndex((i) => (i + 1) % flavors.length);
    }, AUTO_ADVANCE_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isHovering, prefersReducedMotion]);

  function selectFlavor(index: number) {
    setActiveIndex(index);
    // manual pick resets/pauses auto-advance briefly via the hover-independent
    // effect re-running (activeIndex change doesn't retrigger effect, so we
    // explicitly restart the interval here). Reduced-motion users never get
    // the interval restarted, so a manual pick stays put.
    if (timerRef.current) clearInterval(timerRef.current);
    if (!isHovering && !prefersReducedMotion) {
      timerRef.current = setInterval(() => {
        setActiveIndex((i) => (i + 1) % flavors.length);
      }, AUTO_ADVANCE_MS);
    }
  }

  return (
    <motion.section
      id="flavors"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setIsHovering(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setIsHovering(false);
      }}
      onFocus={() => setIsHovering(true)}
      onBlur={() => setIsHovering(false)}
      animate={{ backgroundColor: active.bg }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.6, ease: "easeInOut" }}
      className="relative flex min-h-screen w-full flex-col items-center overflow-hidden px-6 py-20 md:py-28"
    >
      <motion.h2
        initial={prefersReducedMotion ? undefined : { y: 40, opacity: 0 }}
        whileInView={prefersReducedMotion ? undefined : { y: 0, opacity: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
        animate={{ color: active.ink }}
        className="font-display text-[clamp(2rem,6vw,4.5rem)] uppercase leading-[0.9] tracking-tight text-center"
      >
        FIVE FLAVORS. ONE LIFT.
      </motion.h2>
      <span className="sr-only" aria-live="polite">
        {active.name} selected
      </span>

      <div className="relative flex flex-1 w-full items-center justify-center">
        {/* Giant backdrop flavor name, behind the can. Sync mode (default)
            lets the outgoing and incoming names crossfade instead of
            leaving an empty stage while the background is still lerping. */}
        <AnimatePresence>
          <motion.span
            key={`backdrop-${active.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0.3 : 0.6, ease: "easeInOut" }}
            style={{ color: active.ink }}
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none text-center font-display text-[clamp(3rem,10vw,9rem)] uppercase leading-[0.9] opacity-20"
          >
            {active.name}
          </motion.span>
        </AnimatePresence>

        {/* Can, crossfaded via AnimatePresence. The stage has a fixed size and
            each can layer is absolutely positioned so the incoming can enters
            while the outgoing one leaves, instead of the product vanishing
            entirely mid-transition. */}
        <div className="relative z-10 flex h-[26rem] w-full items-center justify-center md:h-[30rem]">
          <AnimatePresence>
            <motion.div
              key={active.id}
              initial={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { y: 60, opacity: 0, rotate: -6 }
              }
              animate={
                prefersReducedMotion
                  ? { opacity: 1 }
                  : {
                      y: 0,
                      opacity: 1,
                      rotate: 0,
                      transition: { type: "spring", stiffness: 220, damping: 18 },
                    }
              }
              exit={
                prefersReducedMotion
                  ? { opacity: 0, transition: { duration: 0.3 } }
                  : { y: -40, opacity: 0, rotate: 6, transition: { duration: 0.25 } }
              }
              className="absolute inset-0 flex items-center justify-center drop-shadow-2xl"
            >
              <Can
                body={active.can}
                accent={active.accent}
                label={active.name}
                className="h-[26rem] md:h-[30rem]"
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="relative mx-auto min-h-[3.5rem] w-full max-w-xl md:min-h-[2.5rem]">
        <AnimatePresence>
          <motion.p
            key={`tagline-${active.id}`}
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -12 }}
            transition={{ duration: 0.4 }}
            style={{ color: active.ink }}
            className="absolute inset-x-0 top-0 text-center font-body text-lg md:text-xl"
          >
            {active.tagline}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="mt-10 flex items-center justify-center gap-4">
        {flavors.map((flavor, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={flavor.id}
              type="button"
              aria-label={flavor.name}
              aria-current={isActive}
              aria-pressed={isActive}
              onClick={() => selectFlavor(index)}
              className="group relative flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-300 hover:scale-110"
            >
              <span
                className="block h-7 w-7 rounded-full transition-[box-shadow] duration-[600ms] ease-in-out"
                style={{
                  backgroundColor: flavor.can,
                  // Every dot keeps a hairline ring so it never disappears
                  // against a same-colored background (e.g. lemon-on-lemon).
                  boxShadow: isActive
                    ? `0 0 0 3px ${flavor.accent}`
                    : "inset 0 0 0 1.5px rgba(29,66,60,0.35)",
                }}
              />
            </button>
          );
        })}
      </div>
    </motion.section>
  );
}
