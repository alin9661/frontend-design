// lib/engine/react/RisoGrainOverlay.tsx
//
// The DOM half of the riso treatment (C6), and the thing `risoGrainMode`'s
// `"fallback"` verdict has always referred to: "the DOM layer should apply
// RISO_GRAIN_FALLBACK instead so the aesthetic degrades rather than
// vanishing." Until this component existed there was no such layer, so a
// low-tier visitor got no grain at all by either path — the GPU pass declines
// on that tier, and nothing painted the CSS overlay — which is precisely the
// vanishing the fallback was written to prevent.
//
// It imports `./shaders/riso-policy`, never `./shaders/riso`: the latter
// defines a `postprocessing` Effect over `three`, and a component that pulls
// that in would put the entire GL graph into a route's first-load JS.
//
// Rendered as a sibling of <GlCanvas/> inside EngineProvider, so it inherits
// the same fixed, full-viewport, decorative, pointer-transparent footprint the
// canvas has — and costs `/` nothing, because EngineProvider is itself behind
// a post-mount dynamic import.

"use client";

import type { QualityTier } from "@/lib/engine/types";
import {
  RISO_GRAIN_FALLBACK,
  risoGrainMode,
} from "@/lib/engine/gl/shaders/riso-policy";

export interface RisoGrainOverlayProps {
  /** Detected tier; `null` before the engine effect has measured one. */
  quality: QualityTier | null;
  reducedMotion: boolean;
  /** Pathname. `undefined` (no DOM) means "I do not know where I am" — no grain. */
  route: string | undefined;
}

/**
 * Renders the static print texture, or nothing at all.
 *
 * Deliberately narrow: this paints ONLY in `"fallback"` mode. In `"animated"`
 * and `"static"` the GPU pass owns the grain and a second, CSS copy of it
 * would double the texture; in `"off"` the route is not art-directed for it.
 */
export default function RisoGrainOverlay({
  quality,
  reducedMotion,
  route,
}: RisoGrainOverlayProps) {
  if (quality === null || route === undefined) return null;
  if (risoGrainMode({ quality, reducedMotion, route }) !== "fallback") return null;

  return (
    <div
      aria-hidden="true"
      data-riso-grain-fallback=""
      // `z-0` and `fixed inset-0` mirror GlCanvas: the grain sits on the same
      // plane the GL pass would have composited into, under every section's
      // own content. `mixBlendMode: multiply` comes from the descriptor.
      className="pointer-events-none fixed inset-0 z-0"
      style={RISO_GRAIN_FALLBACK.style}
    />
  );
}
