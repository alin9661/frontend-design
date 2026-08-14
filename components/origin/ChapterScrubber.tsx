"use client";

import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useReducedMotion, type MotionValue } from "framer-motion";
import { PROGRESS_TRANSITION_CSS } from "@/lib/motion";
import { isActive, originChapters } from "@/lib/visuals/origin-timeline";

const SESSION_KEY = "mateina-origin-film-seen";

export function originChapterId(number: string): string {
  return `origin-chapter-${number}`;
}

interface ChapterScrubberProps {
  /** Present for the sticky film, absent when the story is a static document. */
  progress?: MotionValue<number>;
  sectionRef?: RefObject<HTMLElement | null>;
}

/**
 * Semantic chapter navigation for the origin story. Links remain useful before
 * hydration; JavaScript only upgrades sticky-film links into smooth scrolls.
 *
 * Two layouts, one contract. The sticky film docks the control below the fixed
 * site header on mobile and parks it on the right rail from `md` up. The static
 * document instead sticks the same strip under the header, because a stacked
 * seven-chapter page needs the jump list the whole way down, not floating at the
 * midpoint of an eight-screen section.
 */
export default function ChapterScrubber({ progress, sectionRef }: ChapterScrubberProps) {
  const prefersReducedMotion = useReducedMotion();
  const isFilm = Boolean(progress);
  const listRef = useRef<HTMLOListElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isReturningVisitor, setIsReturningVisitor] = useState(false);

  useEffect(() => {
    if (!progress) return;

    const updateActiveChapter = (value: number) => {
      const nextIndex = originChapters.findIndex((_, index) => isActive(index, value));
      if (nextIndex >= 0) setActiveIndex(nextIndex);
    };

    updateActiveChapter(progress.get());
    return progress.on("change", updateActiveChapter);
  }, [progress]);

  useEffect(() => {
    if (progress || typeof IntersectionObserver === "undefined") return;

    const targets = originChapters
      .map((chapter) => document.getElementById(originChapterId(chapter.number)))
      .filter((target): target is HTMLElement => target !== null);
    const ratios = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
        }

        let nextIndex = -1;
        let bestRatio = 0;
        targets.forEach((target, index) => {
          const ratio = ratios.get(target) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            nextIndex = index;
          }
        });
        if (nextIndex >= 0) setActiveIndex(nextIndex);
      },
      {
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [progress]);

  // Read after mount only: sessionStorage is unavailable during SSR and would
  // otherwise desynchronise the hydrated markup.
  useEffect(() => {
    try {
      setIsReturningVisitor(window.sessionStorage.getItem(SESSION_KEY) === "true");
      window.sessionStorage.setItem(SESSION_KEY, "true");
    } catch {
      // Private browsing modes can reject storage access; navigation still works.
    }
  }, []);

  // Keep the active chip inside the horizontal strip without ever scrolling the
  // page: only the list itself moves, so this cannot fight the user's scroll.
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !active || typeof list.scrollTo !== "function") return;

    list.scrollTo({
      left: Math.max(0, active.offsetLeft - (list.clientWidth - active.clientWidth) / 2),
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [activeIndex, prefersReducedMotion]);

  function scrollToChapter(event: MouseEvent<HTMLAnchorElement>, index: number) {
    setActiveIndex(index);

    if (!sectionRef?.current) return;

    event.preventDefault();
    const section = sectionRef.current;
    const sectionTop = section.getBoundingClientRect().top + window.scrollY;
    const scrollableDistance = Math.max(0, section.scrollHeight - window.innerHeight);
    // A peak usually maps to a fractional document pixel. Browsers quantize
    // the final scroll position, and rounding just below that exact boundary
    // leaves the previous chapter aria-current. Land one CSS pixel inside the
    // requested chapter instead (clamped for a zero/terminal range).
    const targetOffset = Math.min(
      scrollableDistance,
      scrollableDistance * originChapters[index].band.peak + Math.min(1, scrollableDistance),
    );
    const targetTop = sectionTop + targetOffset;

    window.scrollTo({
      top: targetTop,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }

  return (
    <nav
      aria-label="Origin film chapters"
      data-layout={isFilm ? "film" : "document"}
      data-returning={isReturningVisitor || undefined}
      className={`z-40 overflow-hidden rounded-2xl border border-cream/20 bg-forest/90 p-2 pb-3 text-cream shadow-lg backdrop-blur-sm ${
        isFilm
          ? "absolute inset-x-3 top-24 md:inset-x-auto md:right-6 md:top-1/2 md:w-56 md:-translate-y-1/2"
          : "sticky top-16 mx-3 md:top-20 md:mx-6"
      }`}
    >
      <div className={`flex items-center gap-1 ${isFilm ? "md:flex-col md:items-stretch" : ""}`}>
        <ol
          ref={listRef}
          className={`flex min-w-0 flex-1 gap-1 overflow-x-auto ${
            isFilm ? "md:w-full md:flex-col md:overflow-visible" : ""
          }`}
        >
          {originChapters.map((chapter, index) => (
            <li key={chapter.number} className={`shrink-0 ${isFilm ? "md:w-full" : ""}`}>
              <a
                href={`#${originChapterId(chapter.number)}`}
                aria-current={activeIndex === index ? "step" : undefined}
                onClick={(event) => scrollToChapter(event, index)}
                className={`flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-left font-body text-xs leading-tight tracking-[0.08em] transition-colors hover:bg-cream/10 hover:text-cream focus-visible:bg-cream/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream ${
                  activeIndex === index ? "bg-cream/10 text-cream" : "text-cream/70"
                }`}
              >
                <span className="font-display text-sm tracking-normal">{chapter.number}</span>
                <span className={`max-w-32 uppercase ${isFilm ? "md:max-w-none" : ""}`}>
                  {chapter.title}
                </span>
              </a>
            </li>
          ))}
        </ol>
        <a
          href="#flavors"
          aria-label={
            isReturningVisitor
              ? "Skip the film — you already watched it this session"
              : undefined
          }
          className={`flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-xl px-3 text-center font-body text-xs uppercase tracking-[0.12em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream ${
            isFilm ? "md:mt-1 md:w-full" : ""
          } ${
            isReturningVisitor
              ? "bg-cream font-semibold text-forest"
              : "text-cream/85 underline underline-offset-4 hover:text-cream"
          }`}
        >
          Skip the film
        </a>
      </div>
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 block h-0.5 bg-cream/20">
        <span
          className="block h-full w-[14.2857%] bg-amber"
          style={{
            transform: `translateX(${activeIndex * 100}%)`,
            transition: prefersReducedMotion ? "none" : PROGRESS_TRANSITION_CSS,
          }}
        />
      </span>
    </nav>
  );
}
