// lib/engine/gl/shaders/riso-policy.ts
//
// The riso treatment's PURE half: the route/tier/motion policy, and the
// non-GL fallback descriptor the DOM layer paints when the GPU pass is off.
//
// Split out of ./riso.ts for one reason, and it is a hard one: riso.ts imports
// `three` and `postprocessing` to define the Effect subclass. Anything that
// imports it drags the whole GL graph in with it — so the DOM overlay that
// renders the fallback could not live in a component without putting three.js
// into a route's first-load JS, which is exactly what scripts/check-bundle.ts
// exists to prevent. Nothing in this file touches three, postprocessing, GL or
// the DOM; riso.ts re-exports all of it, so existing importers are unaffected.

import type { QualityTier } from "../../types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/* Policy — pure, no GL, no DOM                                               */
/* -------------------------------------------------------------------------- */

/** The route the riso treatment is art-directed for. Nowhere else gets it. */
export const RISO_GRAIN_ROUTE = "/";

export interface RisoGrainPolicyInput {
  quality: QualityTier;
  reducedMotion: boolean;
  /** Pathname, e.g. from `usePathname()`. Query/hash and a trailing slash are tolerated. */
  route: string;
}

/**
 * - `"animated"` — run the GL effect with a live (stepped) clock.
 * - `"static"`   — run the GL effect with the clock frozen at 0. Reduced
 *                  motion keeps the print texture but gets zero temporal
 *                  change, so there is no shimmer to trigger vestibular
 *                  symptoms. Removing it entirely would cost the page its
 *                  identity for no additional a11y gain.
 * - `"fallback"` — too slow for a full-screen post pass; the DOM layer should
 *                  apply `RISO_GRAIN_FALLBACK` instead so the aesthetic
 *                  degrades rather than vanishing.
 * - `"off"`      — not this route; draw nothing.
 */
export type RisoGrainMode = "animated" | "static" | "fallback" | "off";

/** Pure: `"/"`, `"/?utm=x"`, `"/#top"` are the riso route; `"/deep-wave"` is not. */
export function isRisoGrainRoute(route: string): boolean {
  const path = route.split("?")[0].split("#")[0];
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return (trimmed === "" ? "/" : trimmed) === RISO_GRAIN_ROUTE;
}

/**
 * Pure: the full decision. Route gate first (an off-route page gets nothing at
 * all, not even the CSS fallback), then the hardware gate, then motion.
 */
export function risoGrainMode(input: RisoGrainPolicyInput): RisoGrainMode {
  if (!isRisoGrainRoute(input.route)) return "off";
  if (input.quality === "low") return "fallback";
  return input.reducedMotion ? "static" : "animated";
}

/**
 * Pure: may the GL effect be constructed and added to the composer at all?
 * Mirrors `shouldEnablePost` in gl/post.ts. False for both `"fallback"` and
 * `"off"` — neither of those involves a GPU pass.
 */
export function shouldEnableRisoGrain(input: RisoGrainPolicyInput): boolean {
  const mode = risoGrainMode(input);
  return mode === "animated" || mode === "static";
}

/** Pure: should the grain clock advance? Only in `"animated"` mode. */
export function shouldAnimateRisoGrain(input: RisoGrainPolicyInput): boolean {
  return risoGrainMode(input) === "animated";
}

/**
 * A serialisable description of the non-GL grain. This module does not render
 * it: the DOM layer spreads `style` onto a `pointer-events: none` overlay
 * element that covers the section.
 */
export interface RisoGrainFallback {
  readonly kind: "css-overlay";
  /** The `<filter>` id inside `svg`, for callers that inline the markup instead. */
  readonly filterId: string;
  /** Standalone SVG markup: an feTurbulence tile, no `<animate>` anywhere. */
  readonly svg: string;
  /** The same SVG, percent-encoded as a `data:` URI. */
  readonly dataUri: string;
  /** Tile edge in CSS px — matches the SVG's own width/height. */
  readonly tileSize: number;
  /** Ready to spread onto a React `style` prop. */
  readonly style: {
    readonly backgroundImage: string;
    readonly backgroundRepeat: "repeat";
    readonly backgroundSize: string;
    readonly mixBlendMode: "multiply";
    readonly opacity: string;
    readonly pointerEvents: "none";
  };
}

export interface RisoGrainFallbackOptions {
  /** Overlay opacity, 0..1. Default 0.18. */
  opacity?: number;
  /** Tile edge in CSS px. Default 180. */
  tileSize?: number;
  /** feTurbulence base frequency. Default 0.65 — coarse, to match the GL cells. */
  baseFrequency?: number;
}

/**
 * Builds the fallback descriptor. `feTurbulence` with a low octave count and a
 * `feComponentTransfer` crush is the closest static approximation of the GL
 * pass that a browser can composite for free; it is intentionally *static*, so
 * it needs no separate reduced-motion variant.
 */
export function buildRisoGrainFallback(opts: RisoGrainFallbackOptions = {}): RisoGrainFallback {
  const opacity = clamp(opts.opacity ?? 0.18, 0, 1);
  const tileSize = Math.round(clamp(opts.tileSize ?? 180, 16, 1024));
  const baseFrequency = clamp(opts.baseFrequency ?? 0.65, 0.05, 4);
  const filterId = "riso-grain-fallback";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}">` +
    `<filter id="${filterId}" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${baseFrequency}" numOctaves="2" stitchTiles="stitch" seed="7" result="tooth"/>` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `<feComponentTransfer><feFuncA type="linear" slope="0.55" intercept="0"/></feComponentTransfer>` +
    `</filter>` +
    `<rect width="100%" height="100%" filter="url(#${filterId})"/>` +
    `</svg>`;

  const dataUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  return {
    kind: "css-overlay",
    filterId,
    svg,
    dataUri,
    tileSize,
    style: {
      backgroundImage: `url("${dataUri}")`,
      backgroundRepeat: "repeat",
      backgroundSize: `${tileSize}px ${tileSize}px`,
      mixBlendMode: "multiply",
      opacity: String(opacity),
      pointerEvents: "none",
    },
  };
}

/** The default low-tier descriptor. */
export const RISO_GRAIN_FALLBACK: RisoGrainFallback = buildRisoGrainFallback();
