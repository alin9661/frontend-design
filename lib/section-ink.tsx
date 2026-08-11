"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flavors } from "@/lib/flavors";

/** The header is 64px on compact screens and 80px from the md breakpoint. */
function headerSampleY() {
  return window.matchMedia("(min-width: 768px)").matches ? 40 : 32;
}
const DEFAULT_INK = "#F9F9EE";

type SectionInkContextValue = {
  ink: string;
  publish: (color: string) => void;
};

const fallbackContext: SectionInkContextValue = {
  ink: DEFAULT_INK,
  publish: () => undefined,
};

const SectionInkContext = createContext<SectionInkContextValue>(fallbackContext);

/** Internal channel through which the origin film publishes its generated ink track. */
export const AutoSectionInkContext = createContext<(color: string) => void>(() => undefined);

/**
 * Shares the color that should be used by persistent chrome over the section
 * currently sitting beneath the header.
 */
export function SectionInkProvider({ children }: { children: ReactNode }) {
  const [ink, setInk] = useState(DEFAULT_INK);
  const publish = useCallback((color: string) => {
    setInk((current) => (current === color ? current : color));
  }, []);

  return (
    <SectionInkContext.Provider value={{ ink, publish }}>
      {children}
    </SectionInkContext.Provider>
  );
}

/**
 * Registers a section's preferred foreground color when a color is supplied;
 * without one, it reads the current shared color for persistent UI.
 */
export function useSectionInk(color?: string): string {
  const { ink, publish } = useContext(SectionInkContext);

  useEffect(() => {
    if (color) publish(color);
  }, [color, publish]);

  return ink;
}

function SectionInkRegion({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}) {
  const regionRef = useRef<HTMLDivElement>(null);
  const [isUnderHeader, setIsUnderHeader] = useState(false);

  useSectionInk(isUnderHeader ? color : undefined);

  useEffect(() => {
    const updateActiveRegion = () => {
      const region = regionRef.current;
      if (!region) return;

      const { top, bottom } = region.getBoundingClientRect();
      const sampleY = headerSampleY();
      setIsUnderHeader(top <= sampleY && bottom > sampleY);
    };

    updateActiveRegion();
    window.addEventListener("scroll", updateActiveRegion, { passive: true });
    window.addEventListener("resize", updateActiveRegion);

    return () => {
      window.removeEventListener("scroll", updateActiveRegion);
      window.removeEventListener("resize", updateActiveRegion);
    };
  }, []);

  return <div ref={regionRef}>{children}</div>;
}

const DARK_INK = "#1D423C";

/**
 * Parses a CSS color that the browser has already resolved (`rgb()` / `rgba()`)
 * or an authored hex string. Returns null for anything transparent or
 * unresolvable, which callers treat as "keep the ink you already have".
 */
export function parseColor(color: string): [number, number, number] | null {
  const trimmed = color.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : hex[1];
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ];
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
  if (!rgb) return null;
  const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  // A fully transparent background tells us nothing about what shows through.
  if (parts.length > 3 && parts[3] === 0) return null;
  return [parts[0], parts[1], parts[2]];
}

/**
 * Picks readable ink for a background color using WCAG relative luminance.
 * Light backgrounds (the origin film ends on cream #F9F9EE) get forest ink;
 * dark backgrounds get cream.
 */
export function pickInk(background: string): string | null {
  const rgb = parseColor(background);
  if (!rgb) return null;

  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return luminance > 0.35 ? DARK_INK : DEFAULT_INK;
}

/** Publishes ink supplied by the origin film's generated timeline track. */
export function AutoSectionInk({ children }: { children: ReactNode }) {
  const [ink, setInk] = useState(DEFAULT_INK);
  const publish = useCallback((color: string) => {
    setInk((current) => (current === color ? current : color));
  }, []);

  return (
    <AutoSectionInkContext.Provider value={publish}>
      <SectionInkRegion color={ink}>{children}</SectionInkRegion>
    </AutoSectionInkContext.Provider>
  );
}

/** Publishes a fixed ink color while its child section is beneath the header. */
export function FixedSectionInk({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}) {
  return <SectionInkRegion color={color}>{children}</SectionInkRegion>;
}

/**
 * Publishes the active flavor's contrast-approved ink. FlavorShowcase owns
 * the carousel state, so this wrapper listens to its exposed pressed state
 * instead of duplicating that state or reaching into the component.
 */
export function FlavorSectionInk({ children }: { children: ReactNode }) {
  const regionRef = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState(flavors[0].ink);

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;

    const updateInk = () => {
      const activeButton = region.querySelector<HTMLButtonElement>(
        'button[aria-pressed="true"]',
      );
      const activeFlavor = flavors.find(
        (flavor) => flavor.name === activeButton?.getAttribute("aria-label"),
      );
      if (activeFlavor) setInk(activeFlavor.ink);
    };

    updateInk();
    const observer = new MutationObserver(updateInk);
    observer.observe(region, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={regionRef}>
      <SectionInkRegion color={ink}>{children}</SectionInkRegion>
    </div>
  );
}
