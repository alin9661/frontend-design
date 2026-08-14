"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import SoundToggle, { type SoundscapeHandle } from "@/components/SoundToggle";
import { useSectionInk } from "@/lib/section-ink";

function headerHeight() {
  return window.matchMedia("(min-width: 768px)").matches ? 80 : 64;
}

/**
 * Where the visitor is inside the origin film, 0..1.
 *
 * The ambient soundscape's five beds are anchored to origin-film chapters, but
 * this chrome lives in the root layout, outside the film's React subtree, so
 * there is no MotionValue to subscribe to. It reads the section's rect instead,
 * with the same "start start → end end" mapping the film's own `useScroll`
 * uses, so the audio and the picture agree on where the story is.
 *
 * Returns 0 — the first bed — when the film is not on the page at all, which
 * is every route except "/".
 */
export function originFilmProgress(): number {
  if (typeof document === "undefined") return 0;

  const film = document.querySelector("[data-origin-film]");
  if (!film) return 0;

  const rect = film.getBoundingClientRect();
  const scrollableDistance = rect.height - window.innerHeight;
  if (scrollableDistance <= 0) return 0;

  return Math.min(1, Math.max(0, -rect.top / scrollableDistance));
}

type InstantAnchorProps = {
  id: string;
  focusTarget?: boolean;
};

function jumpToAnchor(
  event: MouseEvent<HTMLAnchorElement>,
  { id, focusTarget = false }: InstantAnchorProps,
) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const target = document.getElementById(id);
  if (!target) return;

  event.preventDefault();
  window.history.pushState(null, "", `#${id}`);

  // globals.css deliberately keeps smooth scrolling for storytelling CTAs.
  // An inline override applies only for this programmatic navigation, making
  // header wayfinding immediate even from the 650–800svh origin film.
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo({
    top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - headerHeight()),
    left: 0,
    behavior: "auto",
  });
  root.style.scrollBehavior = previousScrollBehavior;

  if (focusTarget) target.focus({ preventScroll: true });
}

export default function SiteHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const ink = useSectionInk();
  const soundscapeRef = useRef<SoundscapeHandle | null>(null);

  useEffect(() => {
    const onScroll = () => {
      setIsScrolled(window.scrollY > 8);
      // Pushed straight into the audio graph rather than through a `progress`
      // prop: the film is 650–800svh, and re-rendering this header on every
      // scroll frame to move a crossfade would be absurd. While sound is off
      // the handle is null and this costs one property read.
      soundscapeRef.current?.setProgress(originFilmProgress());
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // SoundToggle owns the soundscape's whole lifecycle — it hands the live
  // handle over on enable and `null` on disable/unmount, and disposes it
  // itself. Nothing here is disposed; the reference is just dropped.
  const onSoundscapeChange = useCallback((soundscape: SoundscapeHandle | null) => {
    soundscapeRef.current = soundscape;
    soundscape?.setProgress(originFilmProgress());
  }, []);

  return (
    <>
      <a
        href="#main-content"
        onClick={(event) => jumpToAnchor(event, { id: "main-content", focusTarget: true })}
        className="sr-only fixed left-3 top-3 z-[60] flex h-11 items-center rounded-full bg-cream px-4 font-body text-sm font-semibold text-forest focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2"
      >
        Skip to content
      </a>
      <header
        className={`fixed inset-x-0 top-0 z-50 h-16 md:h-20 ${
          isScrolled ? "bg-forest/10 shadow-[0_1px_0_rgba(249,249,238,0.18)] backdrop-blur-sm" : ""
        }`}
        style={{ color: ink }}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-2 px-3 sm:px-6 md:h-20">
          <a
            href="/"
            aria-label="Mateína"
            className="flex h-11 shrink-0 items-center font-display text-2xl uppercase tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 focus-visible:ring-offset-forest"
          >
            MATEÍNA
          </a>
          <nav aria-label="Primary navigation" className="flex items-center gap-0.5 sm:gap-2">
            <a
              href="#flavors"
              onClick={(event) => jumpToAnchor(event, { id: "flavors" })}
              className="flex h-11 items-center px-2 font-body text-[0.625rem] font-semibold uppercase tracking-[0.08em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current sm:px-3 sm:text-xs sm:tracking-[0.12em]"
            >
              Flavors
            </a>
            <a
              href="#benefits"
              onClick={(event) => jumpToAnchor(event, { id: "benefits" })}
              className="flex h-11 items-center px-2 font-body text-[0.625rem] font-semibold uppercase tracking-[0.08em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current sm:px-3 sm:text-xs sm:tracking-[0.12em]"
            >
              Benefits
            </a>
            <a
              href="/refer"
              className="flex h-11 items-center px-2 font-body text-[0.625rem] font-semibold uppercase tracking-[0.08em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current sm:px-3 sm:text-xs sm:tracking-[0.12em]"
            >
              Refer
            </a>
          </nav>
        </div>
      </header>
      {/*
        The soundscape switch is deliberately NOT inside the header bar. Its
        accessible name is a visible label ("Ambient sound"), which at 375px
        would push the wordmark and the three nav links off the row; parking it
        bottom-right keeps every breakpoint intact, keeps it clear of the
        chapter scrubber (top-24 on mobile, right-6 centred from md) and of the
        film's copy block (bottom-16), and puts it last in the tab order,
        after all of the header's wayfinding.

        It carries its own forest/cream pair rather than the section ink: it
        floats over the BOTTOM of the viewport, and `ink` is chosen for
        whatever sits under the header at the top — over the film those two
        are frequently opposite colours.
      */}
      <div className="fixed bottom-3 right-3 z-50 md:bottom-6 md:right-6">
        <SoundToggle
          onSoundscapeChange={onSoundscapeChange}
          className="border-transparent bg-forest/85 text-cream shadow-lg backdrop-blur-sm"
        />
      </div>
    </>
  );
}
