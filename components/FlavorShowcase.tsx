"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  m,
  useInView,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import Can from "@/components/svg/Can";
import { flavors } from "@/lib/flavors";
import { CAN_SPRING, EASE_OUT_CSS, REVEAL, SWAP, SWAP_FAST } from "@/lib/motion";
import {
  activeCanIndex,
  createShelfHandoff,
  handoffLayerOpacities,
  handoffProgress,
} from "@/lib/visuals/shelf-to-showcase";

const AUTO_ADVANCE_MS = 4000;

/** Picker hover/press feedback. Raw CSS (not framer) because it is a pure
 * compositor transform on a plain button — but still on the shared curve. */
const PICKER_DURATION_MS = 200;
const PICKER_TRANSITION_CSS = `transform ${PICKER_DURATION_MS}ms ${EASE_OUT_CSS}`;

export interface FlavorShowcaseProps {
  /**
   * 0..1 across this section's entrance. Injected only by tests — in the app
   * it comes from this section's own `useScroll`, and the prop is omitted.
   */
  showcaseProgress?: MotionValue<number>;
}

export default function FlavorShowcase({ showcaseProgress }: FlavorShowcaseProps = {}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [autoAdvanceStopped, setAutoAdvanceStopped] = useState(false);
  // True only while the shelf-to-showcase handoff is mid-flight, i.e. while
  // the visitor's scroll is the thing choosing the flavor. Starts false so a
  // section that is simply sitting on screen auto-advances as it always did.
  const [handoffLive, setHandoffLive] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // `initial: true` assumes the section is visible until the (real, in
  // production) IntersectionObserver says otherwise, rather than waiting for
  // the first callback tick before the carousel can ever move.
  const isInView = useInView(sectionRef, { amount: 0.3, initial: true });
  // The showcase's own leg of the shelf-to-showcase handoff: 0 when this
  // section's top is still at the bottom of the viewport, 1 once it has
  // reached the top. The origin film owns the other leg.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "start start"],
  });
  const entrance = showcaseProgress ?? scrollYProgress;
  const handoffModel = useMemo(
    () => createShelfHandoff({ reducedMotion: prefersReducedMotion === true }),
    [prefersReducedMotion],
  );
  // `filmProgress: 1` is not a guess — by the time this section's top has
  // entered the viewport the film below it has necessarily finished, and the
  // module's weighted fold is built so both sides reach the seam from their
  // own end. Neither component recomputes the other's scroll math.
  const handoff = useTransform(entrance, (value) =>
    handoffProgress(handoffModel, { filmProgress: 1, showcaseProgress: value }),
  );
  // The origin film reads `.film` from this same function, so the pair sums
  // to 1 at every point of the boundary — which is the property that makes
  // the two sections read as one move rather than a dissolve with a hole in
  // it. Note the whole fade window now lives on THIS section's leg (see
  // HANDOFF_CROSSFADE): the film's terminal frame is a full-opacity shelf,
  // and this layer fades up from nothing as the section actually enters.
  const stageOpacity = useTransform(
    handoff,
    (value) => handoffLayerOpacities(handoffModel, value).showcase,
  );

  const active = flavors[activeIndex];

  // The carousel's front can IS the showcase's active flavor: the ring sweeps
  // through every flavor across THIS section's entrance (the film's leg is a
  // static shelf — see `carouselPhase`) and settles flavor 0 back at the front
  // at handoff 1, which is exactly where this component starts. Reading the
  // raw handoff here instead used to hand this component index 3 the instant
  // the section entered the viewport, firing two full flavor swaps — can,
  // background, backdrop name, tagline and picker state — before the visitor
  // had scrolled a pixel into the section. A manual pick outranks it
  // permanently (WCAG 2.2.2), and under reduced motion the model pins the
  // front can, so this never moves.
  useMotionValueEvent(handoff, "change", (value) => {
    if (autoAdvanceStopped) return;
    setActiveIndex(activeCanIndex(handoffModel, value));
    setHandoffLive(value < 1);
  });

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
    // `handoffLive` is the fifth suspension: while the shelf-to-showcase
    // handoff is still travelling, the scroll owns the active flavor and a
    // 4s tick landing on top of it would read as the carousel skipping.
    if (prefersReducedMotion || autoAdvanceStopped || isHovering || !isInView || handoffLive) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    startAutoAdvance();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isHovering, prefersReducedMotion, autoAdvanceStopped, isInView, handoffLive]);

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
    <section
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
      className="relative flex min-h-svh w-full flex-col items-center overflow-hidden px-6 py-20 md:py-28"
    >
      <m.div
        aria-hidden="true"
        animate={{ backgroundColor: active.bg }}
        transition={{ ...SWAP, duration: prefersReducedMotion ? 0 : SWAP.duration }}
        className="absolute inset-0 -z-10"
      />
      <m.h2
        initial={{ y: 40, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={REVEAL}
        animate={{ color: active.ink }}
        className="font-display text-[clamp(2rem,6vw,4.5rem)] uppercase leading-[0.9] tracking-tight text-center"
      >
        FIVE FLAVORS. ONE LIFT.
      </m.h2>
      {/* Announces manual picks only — auto-advance ticks stay silent so
          screen reader users aren't interrupted every 4 seconds by a
          rotation they didn't ask for. */}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      {/* The showcase's side of the handoff crossfade. The origin film's shelf
          row fades out on exactly the complementary track, so the two layers
          sum to one across the section boundary instead of cutting. */}
      <m.div
        data-showcase-handoff
        style={{ opacity: stageOpacity }}
        className="relative flex flex-1 w-full items-center justify-center"
      >
        {/* Giant backdrop flavor name, behind the can. Sync mode (default)
            lets the outgoing and incoming names crossfade instead of
            leaving an empty stage while the background is still lerping. */}
        <AnimatePresence>
          <m.span
            key={`backdrop-${active.id}`}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.2 }}
            exit={{ opacity: 0 }}
            transition={prefersReducedMotion ? SWAP_FAST : SWAP}
            style={{ color: active.ink }}
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none text-center font-display text-[clamp(3rem,10vw,9rem)] uppercase leading-[0.9]"
          >
            {active.name}
          </m.span>
        </AnimatePresence>

        {/* Can, crossfaded via AnimatePresence. The stage has a fixed size and
            each can layer is absolutely positioned so the incoming can enters
            while the outgoing one leaves, instead of the product vanishing
            entirely mid-transition. */}
        <div className="relative z-10 flex h-[26rem] w-full items-center justify-center md:h-[30rem]">
          <AnimatePresence>
            <m.div
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
                      transition: CAN_SPRING,
                    }
              }
              exit={
                prefersReducedMotion
                  ? { opacity: 0, transition: SWAP_FAST }
                  : {
                      y: -40,
                      opacity: 0,
                      rotate: 6,
                      transition: SWAP_FAST,
                    }
              }
              className="absolute inset-0 flex items-center justify-center drop-shadow-2xl"
            >
              <Can
                body={active.can}
                accent={active.accent}
                label={active.name}
                className="h-[26rem] md:h-[30rem]"
              />
            </m.div>
          </AnimatePresence>
        </div>
      </m.div>

      <div className="relative mx-auto min-h-[3.5rem] w-full max-w-xl md:min-h-[2.5rem]">
        <AnimatePresence>
          <m.p
            key={`tagline-${active.id}`}
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -12 }}
            transition={SWAP}
            style={{ color: active.ink }}
            className="absolute inset-x-0 top-0 text-center font-body text-lg md:text-xl"
          >
            {active.tagline}
          </m.p>
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
              // The curve is `lib/motion.ts`'s, not Tailwind's. The `ease-out`
              // utility resolves to a different bezier from every other motion
              // on this page, and the source guards in test/motion.test.ts
              // that catch a hand-rolled framer curve cannot see a className —
              // so the drift used to ship silently. EASE_OUT_CSS exists for
              // exactly this case (a raw CSS transition on a plain element).
              style={{ transition: PICKER_TRANSITION_CSS }}
              className="group relative flex h-11 w-11 items-center justify-center rounded-full hover:scale-110"
            >
              <span
                className="block h-7 w-7 rounded-full"
                style={{
                  transition: `box-shadow ${PICKER_DURATION_MS}ms ${EASE_OUT_CSS}`,
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
    </section>
  );
}
