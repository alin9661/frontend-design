"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  m,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import Can from "@/components/svg/Can";
import Leaf from "@/components/svg/Leaf";
import ChapterScrubber, {
  originChapterId,
} from "@/components/origin/ChapterScrubber";
import { EngineContext } from "@/lib/engine/react/engine-context";
import { useView } from "@/lib/engine/react/useView";
import { flavors, flavorById } from "@/lib/flavors";
import { CTA_SPRING, SWAP } from "@/lib/motion";
import { AutoSectionInkContext, pickInk } from "@/lib/section-ink";
import {
  DRAG_INSPECT_TOUCH_ACTION,
  DRAG_INSPECT_TOUCH_ACTION_IDLE,
  createDragInspector,
  type DragInspector,
} from "@/lib/visuals/drag-inspect";
import {
  createShelfHandoff,
  handoffCanPaintOrder,
  handoffCanTransform,
  handoffLayerOpacities,
  handoffLayerScale,
  handoffProgress,
  type ShelfHandoffModel,
} from "@/lib/visuals/shelf-to-showcase";
import {
  bandOutputs,
  bandStops,
  isActive,
  originBackgroundTrack,
  originChapters,
  originCopyYTrack,
  originFoliageYTrack,
  originInkTrack,
  originIntroOpacityTrack,
  originIntroYTrack,
  originLineLengthTrack,
  originLineOpacityTrack,
} from "@/lib/visuals/origin-timeline";

export { originChapters } from "@/lib/visuals/origin-timeline";

const mint = flavorById("mint");

type Chapter = (typeof originChapters)[number];

/**
 * Chapter 04 "CAN" — the only beat with a single hero can on stage, and so the
 * only beat drag-to-inspect is allowed to arbitrate. Named off the timeline
 * rather than hardcoded as a magic 3 at each use site.
 */
const CAN_CHAPTER_INDEX = originChapters.findIndex(
  (chapter) => chapter.number === "04",
);

/** The film's terminal beat, whose band ramp brings the shelf row on stage. */
const FINAL_CHAPTER_INDEX = originChapters.length - 1;

/**
 * The DOM half of drag-to-inspect (`lib/visuals/drag-inspect.ts`).
 *
 * The origin-film SceneModule owns the *rotation*: it runs its own inspector
 * off `ViewContext.pointer` and adds the yaw/pitch to the scripted can pose.
 * What a SceneModule cannot do is call `preventDefault()` — it never sees a
 * PointerEvent, only a normalised {x, y, down}. So this hook runs a second
 * inspector purely as the gesture ARBITER: same pure module, same 8px axis
 * threshold, fed the same physical pointer, therefore the same verdict. It
 * never reads `state.yaw`, and it deliberately never calls `update()` — the
 * axis lock is pure geometry, so the arbiter costs zero frames.
 *
 * The rules that matter, because getting them wrong turns a 650/800svh page into
 * a scroll trap — or an un-zoomable one — on touch:
 *
 *  1. The hit element carries `touch-action: pan-y pinch-zoom`
 *     (DRAG_INSPECT_TOUCH_ACTION), never `none` — the browser keeps vertical
 *     panning AND pinch-to-zoom natively, including on the frames before our
 *     JS has run.
 *  2. `preventDefault()` fires if and only if `onPointerMove` returns true,
 *     i.e. the gesture locked horizontal. A vertical lock, and every gesture
 *     still under the threshold, is handed straight back to the scroller.
 *  3. That `touch-action` is applied ONLY while chapter 04 is on screen, and
 *     only over the film surface — never over the chapter scrubber. The UA
 *     intersects `touch-action` down the ancestor chain, so a value parked on
 *     the full-viewport sticky stage silently revokes horizontal panning for
 *     every descendant: the scrubber's own horizontally-scrolling chip strip
 *     (the film's only in-page navigation on a phone) simply stops moving,
 *     with no way to opt back in. `touchAction` below is therefore a live
 *     value, and the caller must put it on a wrapper that excludes the
 *     scrubber.
 *
 * `pointermove` MUST be registered `{ passive: false }` or preventDefault is a
 * silent no-op, and it lives on `window` so a drag that leaves the stage still
 * tracks.
 */
function useDragToInspectGestures(progress: MotionValue<number>) {
  const inspectorRef = useRef<DragInspector | null>(null);
  if (inspectorRef.current === null) {
    // No `reducedMotion` flag: the arbiter animates nothing, and inspection is
    // something the visitor does with their hand rather than ambient motion.
    inspectorRef.current = createDragInspector();
  }
  // Rule 3. Exactly the predicate the move handler arbitrates on, so the
  // element never advertises a gesture the arbiter would refuse — and never
  // refuses one it would take.
  const [live, setLive] = useState(() =>
    isActive(CAN_CHAPTER_INDEX, progress.get()),
  );
  useMotionValueEvent(progress, "change", (value) => {
    const next = isActive(CAN_CHAPTER_INDEX, value);
    setLive((current) => (current === next ? current : next));
  });

  useEffect(() => {
    const inspector = inspectorRef.current!;

    const onMove = (event: PointerEvent) => {
      if (!isActive(CAN_CHAPTER_INDEX, progress.get())) {
        // Scrolling out of the can beat mid-gesture cancels rather than ends
        // it: an inspection must not fling the can on its way off-script.
        inspector.onPointerCancel();
        return;
      }
      if (inspector.onPointerMove(event.clientX, event.clientY))
        event.preventDefault();
    };
    const onUp = () => inspector.onPointerUp();
    const onCancel = () => inspector.onPointerCancel();

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      inspector.reset();
    };
  }, [progress]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!isActive(CAN_CHAPTER_INDEX, progress.get())) return;
      inspectorRef.current!.onPointerDown(event.clientX, event.clientY);
    },
    [progress],
  );

  return {
    onPointerDown,
    touchAction: live
      ? DRAG_INSPECT_TOUCH_ACTION
      : DRAG_INSPECT_TOUCH_ACTION_IDLE,
  } as const;
}

/**
 * Viewport width, tracked for `handoffLayerScale`. Every offset in
 * `shelf-to-showcase` is an absolute CSS pixel from the stage's centre — that
 * is what lets two sections share one coordinate space without measuring each
 * other — so the arrangement has a fixed width and needs scaling to survive a
 * narrow screen. SSR and the first client render return 0, which the module
 * reads as "hold the authored size", so the markup matches on hydration.
 */
function useViewportWidth(): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return width;
}

/** One can of the shelf row, so each transform gets a stable hook call. */
function HandoffCan({
  handoff,
  index,
  model,
}: {
  handoff: MotionValue<number>;
  index: number;
  model: ShelfHandoffModel;
}) {
  const flavor = model.cans[index];
  const x = useTransform(
    handoff,
    (h) => handoffCanTransform(model, h, index).x,
  );
  const y = useTransform(
    handoff,
    (h) => handoffCanTransform(model, h, index).y,
  );
  const scale = useTransform(
    handoff,
    (h) => handoffCanTransform(model, h, index).scale,
  );
  const opacity = useTransform(
    handoff,
    (h) => handoffCanTransform(model, h, index).opacity,
  );
  // The transform's `z` cannot be applied — this layer is flat CSS with no
  // `perspective`, so a translateZ would do nothing — but the DEPTH ORDER it
  // encodes still has to be honoured, or the cans on the far side of the ring
  // paint over the ones in front of them purely because their flavor index is
  // higher, and the carousel reads as five cutouts sliding through each other.
  const zIndex = useTransform(handoff, (h) =>
    handoffCanPaintOrder(model, h, index),
  );

  return (
    <div className="absolute left-1/2 top-1/2">
      <m.div
        data-handoff-can={flavor.id}
        style={{ x, y, scale, opacity, zIndex }}
      >
        {/* The centring translate lives on a plain child: framer owns the
            transform on the element above it, and two writers of one
            `transform` property is a silent fight. */}
        <div className="-translate-x-1/2 -translate-y-1/2">
          <Can
            body={flavor.can}
            accent={flavor.accent}
            label={flavor.name}
            className="h-40"
          />
        </div>
      </m.div>
    </div>
  );
}

/**
 * The film's half of the shelf-to-showcase handoff.
 *
 * Every number here comes from `lib/visuals/shelf-to-showcase`, which in turn
 * derives its entry point from the origin timeline — this component holds no
 * stop arrays of its own. It knows exactly one thing the module does not: the
 * film's scroll position. FlavorShowcase does the mirror image with the
 * showcase's, and the two legs sum to one continuous 0..1 gesture.
 */
function ShelfHandoffLayer({
  model,
  progress,
}: {
  model: ShelfHandoffModel;
  progress: MotionValue<number>;
}) {
  const handoff = useTransform(progress, (p) =>
    handoffProgress(model, { filmProgress: p, showcaseProgress: 0 }),
  );
  // Chapter 07 is the film's terminal beat and `model.filmTailStart` defaults
  // to its peak, so this band ramp brings the row on stage exactly as the
  // handoff opens — and a chapter-weight retune moves both together.
  const enter = useTransform(
    progress,
    bandStops(FINAL_CHAPTER_INDEX),
    bandOutputs(FINAL_CHAPTER_INDEX),
  );
  // FlavorShowcase reads `.showcase` from this same function, so the pair sums
  // to 1 at every point of the boundary — which is the whole property that
  // makes the two sections read as one move rather than a dissolve with a hole
  // in it. The window itself sits entirely on the showcase's leg, so the value
  // here is a flat 1 for the whole film and this row's terminal frame is a
  // fully opaque shelf rather than a half-faded, half-morphed row.
  const fade = useTransform(
    handoff,
    (h) => handoffLayerOpacities(model, h).film,
  );
  const opacity = useTransform(
    [enter, fade],
    ([entered, faded]: number[]) => entered * faded,
  );
  const scale = handoffLayerScale(model, useViewportWidth());

  return (
    <m.div
      // Decorative: the same five cans are named, and pickable, in the
      // showcase this row is handing over to.
      aria-hidden="true"
      data-shelf-handoff
      style={{ opacity }}
      // `isolate`: the per-can z-indexes below order the cans against each
      // other and must not compete with the film's own layer stack.
      className="pointer-events-none absolute inset-0 z-10 isolate overflow-hidden"
    >
      <div
        data-shelf-handoff-fit
        // Shrinks the whole arrangement to fit a narrow viewport instead of
        // letting `overflow-hidden` crop the outermost cans off a phone —
        // "five cans on a shelf" showing three is not the payoff shot.
        style={{ transform: `scale(${scale})` }}
        className="absolute inset-0"
      >
        {model.cans.map((flavor, index) => (
          <HandoffCan
            key={flavor.id}
            handoff={handoff}
            index={index}
            model={model}
          />
        ))}
      </div>
    </m.div>
  );
}

function ChapterCopy({
  active,
  chapter,
  final = false,
  opacity,
  y,
}: {
  active: boolean;
  chapter: Chapter;
  final?: boolean;
  opacity: MotionValue<number>;
  y: MotionValue<number>;
}) {
  return (
    <m.div
      aria-hidden={!active}
      inert={!active}
      id={originChapterId(chapter.number)}
      style={{
        opacity,
        y,
        visibility: active ? "visible" : "hidden",
      }}
      className="absolute inset-x-6 bottom-16 z-30 mx-auto max-w-xl text-center md:inset-x-auto md:bottom-auto md:left-[8vw] md:top-1/2 md:w-[32rem] md:-translate-y-1/2 md:text-left"
    >
      <p className="font-body text-xs tracking-[0.3em] text-current/65">
        {chapter.number} / 07
      </p>
      <h2 className="mt-3 font-display text-[clamp(2.5rem,6vw,5.5rem)] uppercase leading-[0.88]">
        {chapter.title}
      </h2>
      <p className="mt-5 max-w-md font-body text-base leading-relaxed text-current/75 md:text-lg">
        {chapter.body}
      </p>
      {final ? (
        <div className="mt-7 flex flex-col items-center gap-4 sm:flex-row md:items-start">
          <m.a
            href="#flavors"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            transition={CTA_SPRING}
            className="inline-flex items-center justify-center rounded-full bg-forest px-8 py-3.5 font-display text-base uppercase tracking-wide text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2"
          >
            SHOP THE FLAVORS
          </m.a>
          <a
            href="#benefits"
            className="py-3 font-body text-xs uppercase tracking-[0.15em] underline decoration-current/40 underline-offset-4 transition-colors hover:text-forest"
          >
            WHY YERBA MATE? ↓
          </a>
        </div>
      ) : null}
    </m.div>
  );
}

/** A child gives each transform a stable hook call rather than calling hooks in a map. */
function ChapterLayer({
  chapter,
  copyY,
  index,
  progress,
}: {
  chapter: Chapter;
  copyY: MotionValue<number>;
  index: number;
  progress: MotionValue<number>;
}) {
  const opacity = useTransform(progress, bandStops(index), bandOutputs(index));
  const [active, setActive] = useState(() => isActive(index, progress.get()));

  useMotionValueEvent(progress, "change", (value) => {
    const nextActive = isActive(index, value);
    setActive((current) => (current === nextActive ? current : nextActive));
  });

  return (
    <ChapterCopy
      active={active}
      chapter={chapter}
      opacity={opacity}
      y={copyY}
      final={index === originChapters.length - 1}
    />
  );
}

function ChapterWatermark({
  chapter,
  index,
  progress,
}: {
  chapter: Chapter;
  index: number;
  progress: MotionValue<number>;
}) {
  const opacity = useTransform(progress, bandStops(index), bandOutputs(index));

  return (
    <m.span
      style={{ opacity }}
      className="absolute left-1/2 top-[29%] -translate-x-1/2 -translate-y-1/2 select-none font-display text-[clamp(5rem,19vw,24rem)] uppercase leading-none text-current/10 md:left-[70%] md:top-1/2"
    >
      {chapter.word}
    </m.span>
  );
}

function LivingScene({
  progress,
  showBeatArt,
}: {
  progress: MotionValue<number>;
  showBeatArt: boolean;
}) {
  const root = useTransform(progress, bandStops(0), bandOutputs(0));
  const leaves = useTransform(progress, bandStops(1), bandOutputs(1));
  const machine = useTransform(progress, bandStops(2), bandOutputs(2));
  const pack = useTransform(progress, bandStops(4), bandOutputs(4));
  const shelfStops = bandStops(5);
  const shelf = useTransform(progress, shelfStops.slice(0, 2), [0, 1]);
  const canFill = useTransform(progress, bandStops(3).slice(0, 2), [0, 1]);
  const lineLength = useTransform(
    progress,
    originLineLengthTrack.input,
    originLineLengthTrack.output,
  );
  const lineOpacity = useTransform(
    progress,
    originLineOpacityTrack.input,
    originLineOpacityTrack.output,
  );
  const foliageY = useTransform(
    progress,
    originFoliageYTrack.input,
    originFoliageYTrack.output,
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <m.div
        data-origin-beat-art
        aria-hidden="true"
        initial={false}
        animate={{ opacity: showBeatArt ? 1 : 0 }}
        transition={SWAP}
        className="absolute inset-0"
      >
        <m.div style={{ y: foliageY }} className="absolute inset-0 opacity-25">
          <Leaf
            color="#F9F9EE"
            className="absolute left-[7%] top-[18%] w-24 -rotate-12"
          />
          <Leaf
            color="#74A56F"
            className="absolute right-[8%] top-[48%] w-36 rotate-[28deg]"
          />
        </m.div>
        <m.div style={{ opacity: root }} className="absolute inset-0">
          <svg
            viewBox="0 0 800 900"
            className="absolute bottom-0 left-1/2 h-[88%] w-auto max-w-none -translate-x-1/2"
          >
            <path
              d="M400 900C370 780 430 690 400 570C365 430 420 260 395 65"
              fill="none"
              stroke="#F9F9EE"
              strokeOpacity=".2"
              strokeWidth="34"
              strokeLinecap="round"
            />
            <path
              d="M400 900C310 825 285 825 220 870M400 900C485 820 525 830 590 865"
              fill="none"
              stroke="#C5673C"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <g fill="#74A56F">
              <ellipse
                cx="330"
                cy="650"
                rx="105"
                ry="44"
                transform="rotate(-25 330 650)"
              />
              <ellipse
                cx="474"
                cy="545"
                rx="112"
                ry="48"
                transform="rotate(28 474 545)"
              />
              <ellipse
                cx="315"
                cy="425"
                rx="118"
                ry="50"
                transform="rotate(-30 315 425)"
              />
            </g>
          </svg>
        </m.div>
        <m.div
          style={{ opacity: leaves }}
          className="absolute left-1/2 top-1/2 w-[min(58vw,28rem)] -translate-x-1/2 -translate-y-1/2"
        >
          <Leaf color="#74A56F" className="w-full drop-shadow-2xl" />
        </m.div>
        <m.div
          style={{ opacity: machine }}
          className="absolute left-1/2 top-1/2 h-64 w-[min(82vw,38rem)] -translate-x-1/2 -translate-y-1/2 rounded-[3rem] border-[14px] border-[#F3B45E]/70 bg-[#D58A3D]/25 shadow-2xl"
        >
          <span className="absolute left-[10%] top-1/2 h-14 w-14 -translate-y-1/2 rounded-full border-8 border-cream/60" />
          <span className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-[18px] border-cream/60" />
          <span className="absolute right-[10%] top-1/2 h-14 w-14 -translate-y-1/2 rounded-full border-8 border-cream/60" />
        </m.div>
        <m.div
          style={{ opacity: pack }}
          className="absolute left-1/2 top-1/2 h-52 w-72 -translate-x-1/2 -translate-y-1/2 border-[10px] border-[#F3B45E] bg-[#C5673C]/50"
        >
          <span className="absolute inset-y-0 left-1/2 w-10 -translate-x-1/2 bg-[#F3B45E]/80" />
        </m.div>
        <m.div
          style={{ opacity: shelf }}
          className="absolute bottom-[16%] left-1/2 h-4 w-[min(80vw,42rem)] -translate-x-1/2 bg-current/40 shadow-[0_1rem_2rem_rgba(0,0,0,.18)]"
        />
      </m.div>
      <svg
        data-origin-living-line
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <m.path
          d="M500 1000C410 870 590 790 490 675C400 570 340 470 500 390C650 315 640 230 535 185C470 155 465 95 500 8"
          fill="none"
          stroke="#F3B45E"
          strokeWidth="8"
          strokeLinecap="round"
          style={{ pathLength: lineLength, opacity: lineOpacity }}
        />
      </svg>
      {/*
        The living line's top terminus resolves into an EMPTY can silhouette: a
        promise the film pays off at chapter 04, when `canFill` floods it. It
        gets its own SVG because the line above is drawn with
        preserveAspectRatio="none" — that stretch is invisible on an abstract
        squiggle but would visibly squash a can. Sharing the 0..1000 coordinate
        space (x centred on 500, y 0..115 over the same 11.5% of the height)
        keeps it welded to the line's endpoint at (500, 8).
      */}
      {/*
        Desktop only. Below md the first viewport already stacks the fixed
        SiteHeader, the chapter scrubber strip, and the copy block; at 375px the
        can lands in the ~30px gap between header and scrubber, where it reads
        as clutter rather than as the promise chapter 04 pays off. The line
        still runs the full height on mobile — only its terminus ornament is
        dropped.
      */}
      <svg
        data-can-terminus
        viewBox="470 0 60 115"
        preserveAspectRatio="xMidYMid meet"
        className="absolute left-1/2 top-0 hidden h-[11.5%] w-auto -translate-x-1/2 md:block"
      >
        <path
          d="M478 8H522L526 23V99C526 105 522 109 516 109H484C478 109 474 105 474 99V23L478 8Z"
          fill="none"
          stroke="#F3B45E"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <m.path
          d="M480 58H520V99C520 101 518 103 516 103H484C482 103 480 101 480 99V58Z"
          fill="#F3B45E"
          style={{ opacity: canFill }}
        />
        <path
          d="M480 23H520"
          fill="none"
          stroke="#F3B45E"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function StaticArt({ index }: { index: number }) {
  if (index === 0 || index === 1) {
    return <Leaf color="#74A56F" className="mb-8 w-36" />;
  }

  if (index === 2) {
    return (
      <div
        aria-hidden="true"
        className="mb-8 flex h-36 w-72 items-center justify-around rounded-[2rem] border-8 border-cream/60"
      >
        <i className="h-12 w-12 rounded-full border-8 border-[#F3B45E]" />
        <i className="h-20 w-20 rounded-full border-8 border-[#F3B45E]" />
        <i className="h-12 w-12 rounded-full border-8 border-[#F3B45E]" />
      </div>
    );
  }

  if (index === 3 || index === 6) {
    return (
      <Can
        body={mint.can}
        accent={mint.accent}
        label={mint.name}
        className="mb-8 h-64"
      />
    );
  }

  if (index === 4) {
    return (
      <div
        aria-hidden="true"
        className="mb-8 h-32 w-52 border-8 border-[#F3B45E] bg-[#C5673C]/40"
      />
    );
  }

  return (
    <div
      aria-label="All five Mateína flavors"
      className="mb-8 flex items-end gap-2"
    >
      {flavors.map((flavor) => (
        <Can
          key={flavor.id}
          body={flavor.can}
          accent={flavor.accent}
          label={flavor.name}
          className="h-32"
        />
      ))}
    </div>
  );
}

function StaticStory() {
  return (
    // `data-origin-film` marks the origin story for chrome that lives outside
    // this subtree (SiteHeader reads its rect to give the ambient soundscape a
    // chapter position). The stacked layout scrolls through the same seven
    // chapters in the same order, so the same 0..1 mapping still holds.
    <section
      data-layout="static"
      data-origin-film
      className="relative text-cream"
    >
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-forest" />
      <header className="flex min-h-svh flex-col items-center justify-center px-6 text-center">
        <p className="font-body text-xs uppercase tracking-[0.3em] text-cream/70">
          yerba mate energy
        </p>
        <p className="mt-5 font-display text-xl uppercase tracking-[0.22em]">
          MATEÍNA
        </p>
        <h1
          aria-label="Energy has roots."
          className="mt-5 font-display text-[clamp(4rem,14vw,10rem)] uppercase leading-[0.82]"
        >
          ENERGY
          <br />
          HAS ROOTS.
        </h1>
        <div className="mt-8 flex flex-col items-center gap-3 text-[0.65rem] uppercase tracking-[0.22em] sm:flex-row">
          <a
            href="#flavors"
            className="font-body underline decoration-current/50 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          >
            Meet the drink
          </a>
          <p className="text-cream/60">Browse the story below ↓</p>
        </div>
      </header>
      <ChapterScrubber />
      {originChapters.map((chapter, index) => (
        <article
          key={chapter.number}
          id={originChapterId(chapter.number)}
          className={`grid min-h-[80svh] scroll-mt-32 place-items-center px-6 py-20 md:scroll-mt-40 ${
            index === 6 ? "bg-cream text-forest" : "border-t border-cream/15"
          }`}
        >
          <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
            <StaticArt index={index} />
            <p className="text-xs tracking-[0.3em] opacity-60">
              {chapter.number} / 07
            </p>
            <h2 className="mt-3 font-display text-[clamp(3rem,10vw,6rem)] uppercase leading-[0.9]">
              {chapter.title}
            </h2>
            <p className="mt-5 max-w-lg text-lg opacity-75">{chapter.body}</p>
            {index === 6 ? (
              <div className="mt-8 flex flex-col items-center gap-5 sm:flex-row">
                <a
                  href="#flavors"
                  className="rounded-full bg-forest px-8 py-4 font-display uppercase text-cream"
                >
                  SHOP THE FLAVORS
                </a>
                <a
                  href="#benefits"
                  className="text-sm uppercase tracking-widest underline underline-offset-4"
                >
                  WHY YERBA MATE? ↓
                </a>
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}

type StageGesture = ReturnType<typeof useDragToInspectGestures>;

/**
 * The film's visual layers, wrapped in the one element that carries
 * `touch-action`.
 *
 * The wrapper exists purely to BOUND that property. `touch-action` is
 * intersected down the ancestor chain and cannot be widened by a descendant,
 * so putting it on the full-viewport sticky stage revokes horizontal panning
 * for everything inside it — including ChapterScrubber's overflow-x strip,
 * which on a phone is the film's only in-page navigation. The scrubber is
 * therefore rendered as this element's SIBLING, not its child.
 */
function DragInspectSurface({
  children,
  touchAction,
}: {
  children: ReactNode;
  touchAction: string;
}) {
  return (
    <div
      data-drag-inspect-surface
      style={{ touchAction }}
      className="absolute inset-0"
    >
      {children}
    </div>
  );
}

function RegisteredOriginFilmStage({
  children,
  gesture,
  onViewId,
}: {
  children: ReactNode;
  gesture: StageGesture;
  onViewId: (viewId: number | null) => void;
}) {
  // `sticky` is load-bearing, not decorative: this div is one viewport tall
  // and pinned inside a 650/800svh section, so the engine's static rect
  // measurement would cull the GL after a single viewport and hand the scene
  // a progress that starts at 0.5. It makes the engine drive progress off the
  // parent section — the same range the DOM film's useScroll() uses.
  // `post: true` is what actually reaches gl/post.ts. This stage is the only
  // GL view on `/` and it is `sticky top-0 h-svh`, i.e. exactly the
  // "one view, covering the viewport" arrangement gl/stage.ts's
  // `resolvePostView()` will honour — and the only arrangement a composer
  // (which owns the whole drawing buffer) can serve. Without it the entire
  // chain — bloom, SMAA and the riso grain pass — is never constructed on any
  // frame, and C6 renders on no pixel of the page.
  const viewRef = useView("origin-film", {
    sticky: true,
    post: true,
    onReady: onViewId,
  });

  return (
    // `onPointerDown` stays on this root so a press anywhere on the film can
    // start an inspection (it bubbles from every layer); only `touch-action`
    // is scoped, on the surface inside — see DragInspectSurface.
    <div
      ref={viewRef}
      data-origin-film-view
      data-drag-inspect
      onPointerDown={gesture.onPointerDown}
      className="sticky top-0 h-svh overflow-hidden"
    >
      {children}
    </div>
  );
}

function AnimatedOriginStory() {
  const sectionRef = useRef<HTMLElement>(null);
  const [originFilmViewId, setOriginFilmViewId] = useState<number | null>(null);
  const engine = useContext(EngineContext);
  const publishAutoInk = useContext(AutoSectionInkContext);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  // This raw MotionValue is the film's single clock. The timeline tracks own
  // the authored easing; adding a second spring here would make the DOM lag
  // the engine's directly sampled sticky progress during fast/reverse scroll.
  const progress = scrollYProgress;
  const backgroundColor = useTransform(
    progress,
    originBackgroundTrack.input,
    originBackgroundTrack.output,
  );
  const inkColor = useTransform(
    progress,
    originInkTrack.input,
    originInkTrack.output,
  );
  const introOpacity = useTransform(
    progress,
    originIntroOpacityTrack.input,
    originIntroOpacityTrack.output,
  );
  const introY = useTransform(
    progress,
    originIntroYTrack.input,
    originIntroYTrack.output,
  );
  const copyY = useTransform(
    progress,
    originCopyYTrack.input,
    originCopyYTrack.output,
  );
  // Only the animated layout reaches here, so the model is always the moving
  // one; StaticStory is the reduced-motion branch and hands nothing over.
  const handoffModel = useMemo(
    () => createShelfHandoff({ reducedMotion: false }),
    [],
  );
  const gesture = useDragToInspectGestures(progress);
  // The header floats over this film's BACKGROUND, not over its copy, so it
  // must publish ink chosen for the background — not `inkColor`, which is the
  // copy's own cream→forest blend. Publishing the blend directly would be
  // wrong twice over: mid-film it is a muddy mid-tone over the amber stop
  // (~1.7:1 against #9A5A2D, unreadable), and because every frame mints a new
  // interpolated color it would push a fresh state update through
  // SectionInkProvider on every frame of an 800svh scroll. pickInk collapses
  // to exactly two values, so this settles to a no-op except at the crossings.
  useMotionValueEvent(backgroundColor, "change", (value) => {
    const next = pickInk(value);
    if (next) publishAutoInk(next);
  });
  // Deliberately NOT `status === "ready"` alone. The engine's global status
  // flips on ASSETS_DONE, which the worker posts in the same tick as READY —
  // before VIEW_ADD has even gone out, let alone before the origin-film chunk
  // has been fetched and its SceneModule.init() has run. Handing the beat art
  // over there fades the 2D film to nothing over an empty background for
  // however long the chunk takes (300ms to 2s cold). VIEW_READY, tracked
  // per-view by EngineProvider, is the first moment GL can actually draw
  // this section.
  //
  // Both other conjuncts are load-bearing: "fallback" (host.init rejected)
  // and the no-engine case must keep the 2D film forever, and `isViewReady`
  // is optional on the context so a narrow test/legacy double degrades to
  // showing art rather than hiding it.
  const originFilmReady =
    engine?.status === "ready" &&
    originFilmViewId !== null &&
    engine.isViewReady?.(originFilmViewId) === true;
  const stage = (
    <>
      <DragInspectSurface touchAction={gesture.touchAction}>
        <LivingScene progress={progress} showBeatArt={!originFilmReady} />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
        >
          {originChapters.map((chapter, index) => (
            <ChapterWatermark
              key={chapter.word}
              chapter={chapter}
              index={index}
              progress={progress}
            />
          ))}
        </div>
        <m.header
          style={{ opacity: introOpacity, y: introY }}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center"
        >
          <p className="font-body text-xs uppercase tracking-[0.3em] text-current/70">
            yerba mate energy
          </p>
          <p className="mt-5 font-display text-xl uppercase tracking-[0.22em]">
            MATEÍNA
          </p>
          <h1
            aria-label="Energy has roots."
            className="mt-4 font-display text-[clamp(4rem,14vw,11rem)] uppercase leading-[0.82]"
          >
            ENERGY
            <br />
            HAS ROOTS.
          </h1>
          <div className="absolute bottom-7 flex flex-col items-center gap-3 text-[0.65rem] uppercase tracking-[0.22em] sm:flex-row">
            <a
              href="#flavors"
              className="font-body text-current underline decoration-current/50 underline-offset-4 transition-colors hover:text-[#F3B45E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              Meet the drink
            </a>
            <p className="text-current/60">Scroll to follow the line ↓</p>
          </div>
        </m.header>
        {/* Gated exactly like LivingScene's beat art, and for the same reason:
          the GL film renders its OWN shelf row, at the identical model
          coordinates but through a perspective camera — so once WebGL is live
          these five SVG cans land at completely different screen pixels and
          the payoff shot is a double image, one row ghosted at 50%. This is
          the 2D stand-in; it hands over the moment GL can draw. */}
        {originFilmReady ? null : (
          <ShelfHandoffLayer model={handoffModel} progress={progress} />
        )}
        {originChapters.map((chapter, index) => (
          <ChapterLayer
            key={chapter.number}
            chapter={chapter}
            copyY={copyY}
            index={index}
            progress={progress}
          />
        ))}
      </DragInspectSurface>
      {/* Outside the surface on purpose: its chip strip pans horizontally on a
          phone, which any `touch-action: pan-y` ancestor would forbid. */}
      <ChapterScrubber progress={progress} sectionRef={sectionRef} />
    </>
  );

  return (
    <m.section
      ref={sectionRef}
      data-layout="sticky"
      data-origin-film
      style={{ color: inkColor }}
      className="relative h-[650svh] md:h-[800svh]"
    >
      <m.div
        aria-hidden="true"
        style={{ backgroundColor }}
        className="absolute inset-0 -z-10"
      />
      {engine ? (
        <RegisteredOriginFilmStage
          gesture={gesture}
          onViewId={setOriginFilmViewId}
        >
          {stage}
        </RegisteredOriginFilmStage>
      ) : (
        <div
          data-origin-film-fallback
          data-drag-inspect
          onPointerDown={gesture.onPointerDown}
          className="sticky top-0 h-svh overflow-hidden"
        >
          {stage}
        </div>
      )}
    </m.section>
  );
}

export default function OriginStory() {
  const prefersReducedMotion = useReducedMotion();

  return prefersReducedMotion ? <StaticStory /> : <AnimatedOriginStory />;
}
