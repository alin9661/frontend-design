"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import Can from "@/components/svg/Can";
import { flavors } from "@/lib/flavors";

const AUTO_ADVANCE_MS = 4000;

export default function FlavorShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [autoAdvanceStopped, setAutoAdvanceStopped] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // `initial: true` assumes the section is visible until the (real, in
  // production) IntersectionObserver says otherwise, rather than waiting for
  // the first callback tick before the carousel can ever move.
  const isInView = useInView(sectionRef, { amount: 0.3, initial: true });

  const active = flavors[activeIndex];

  // Single source of truth for (re)starting the auto-advance timer: clears
  // any existing interval first so callers never have to think about it.
  function startAutoAdvance() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveIndex((i) => (i + 1) % flavors.length);
    }, AUTO_ADVANCE_MS);
  }

  useEffect(() => {
    // Auto-advance is suspended (not just paused) once a manual selection
    // has been made — see selectFlavor — and otherwise only runs when the
    // section is scrolled into view, isn't being hovered by a mouse/pen
    // pointer, and the visitor hasn't asked for reduced motion.
    if (prefersReducedMotion || autoAdvanceStopped || isHovering || !isInView) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    startAutoAdvance();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isHovering, prefersReducedMotion, autoAdvanceStopped, isInView]);

  function selectFlavor(index: number) {
    setActiveIndex(index);
    setAnnouncement(`${flavors[index].name} selected`);
    // Manual selection stops auto-advance permanently (WCAG 2.2.2): once a
    // visitor has taken control of the carousel it shouldn't keep moving out
    // from under them. This also sidesteps the "touch can't pause" problem
    // (a tap is itself a selection, so touch users are never stuck watching
    // it auto-advance) and the interval-reset complexity the old
    // restart-on-pick contract required.
    setAutoAdvanceStopped(true);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  return (
    <motion.section
      ref={sectionRef}
      id="flavors"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse" || e.pointerType === "pen") setIsHovering(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse" || e.pointerType === "pen") setIsHovering(false);
      }}
      onFocus={() => setIsHovering(true)}
      onBlur={(e) => {
        // Only treat focus as having left the section when it's actually
        // moved outside it — tabbing between the picker dots fires blur/
        // focus on each button in turn, and without this check every one of
        // those transitional blurs would toggle isHovering off and on,
        // needlessly tearing down and restarting the auto-advance effect.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsHovering(false);
        }
      }}
      animate={{ backgroundColor: active.bg }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.6, ease: "easeInOut" }}
      className="relative flex min-h-svh w-full flex-col items-center overflow-hidden px-6 py-20 md:py-28"
    >
      <motion.h2
        initial={{ y: 40, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
        animate={{ color: active.ink }}
        className="font-display text-[clamp(2rem,6vw,4.5rem)] uppercase leading-[0.9] tracking-tight text-center"
      >
        FIVE FLAVORS. ONE LIFT.
      </motion.h2>
      {/* Announces manual picks only — auto-advance ticks stay silent so
          screen reader users aren't interrupted every 4 seconds by a
          rotation they didn't ask for. */}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      <div className="relative flex flex-1 w-full items-center justify-center">
        {/* Giant backdrop flavor name, behind the can. Sync mode (default)
            lets the outgoing and incoming names crossfade instead of
            leaving an empty stage while the background is still lerping. */}
        <AnimatePresence>
          <motion.span
            key={`backdrop-${active.id}`}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.2 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0.3 : 0.6, ease: "easeInOut" }}
            style={{ color: active.ink }}
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none text-center font-display text-[clamp(3rem,10vw,9rem)] uppercase leading-[0.9]"
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
              aria-pressed={isActive}
              onClick={() => selectFlavor(index)}
              className="group relative flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-300 hover:scale-110"
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
