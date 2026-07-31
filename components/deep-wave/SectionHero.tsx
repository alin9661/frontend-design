// components/deep-wave/SectionHero.tsx
//
// Section 1/6 (design doc §5): procedural can hero. DOM/copy is the M0
// shell — the source of truth for both content and a11y, unconditionally
// visible whether or not GL ever mounts (canvas is `aria-hidden`, GL-less
// browsers/reduced-motion/context-loss all still render this section
// correctly with zero JS beyond React itself).
//
// a11y note on the MSDF/SDF headline (lib/scenes/hero-can/scene.ts): the
// design doc's progressive-enhancement sketch says to visually hide this
// DOM `<h1>` (keeping it screen-reader-only) once GL text is confirmed
// active, letting the GL glyphs be the sole visual carrier. This section
// deliberately does NOT do that: `lib/scenes/` (like gl/) may not import
// document/window/react (worker-safe layering law) and — when the
// WorkerHost path is active — the text actually renders in a different
// thread entirely, so there is no in-contract signal path for "GL text
// mounted" to reach back into this React component (WorkerToMain's message
// union is a frozen, worker-workstream-owned contract this section doesn't
// extend). Keeping the DOM headline permanently visible is the simplest
// a11y-safe choice available under the current contracts: the GL headline
// is purely an additive bloom/glow layer, so there's nothing to reconcile
// even if it never loads (module missing, font failure, reduced motion).

"use client";

import { useView } from "@/lib/engine/react/useView";
import GagStats from "./GagStats";

export default function SectionHero() {
  const viewRef = useView("hero-can");

  return (
    <section
      ref={viewRef}
      id="hero"
      aria-labelledby="deep-wave-hero-heading"
      className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-6 text-center text-forest"
    >
      {/* Background lives in its own negative-z layer, NOT as this section's
          own background: EngineProvider's shared <GlCanvas/> is a `fixed
          z-0` sibling rendered before every section in the DOM, and this
          `<section>` is itself `position:relative` with no z-index of its
          own — which (per CSS's painting order) puts the WHOLE section,
          including a background painted directly on it, in the same
          stacking group as the canvas, ordered after it (later in the DOM
          wins). An opaque `bg-*` class here would fully occlude the GL
          layer. This `-z-10` div escapes to the page's root stacking
          context instead (painted well before the canvas), so the can
          renders visibly behind the (still fully opaque, still GL-less
          readable) text below. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-cream" />
      {/* GL view host renders behind this content via EngineProvider's
          single shared <GlCanvas/> — nothing to mount per-section. */}
      <p className="font-body text-xs uppercase tracking-[0.35em] text-forest/60">
        Deep Wave / Mateína
      </p>
      <h1
        id="deep-wave-hero-heading"
        className="mt-4 font-display uppercase leading-[0.9] text-[clamp(2.5rem,10.5vw,9.5rem)]"
      >
        <span className="block">SMOOTH LIFT.</span>
        <span className="block">ZERO CRASH.</span>
      </h1>
      <p className="mt-8 max-w-xl font-body text-lg text-forest/80">
        Brewed by AI.<sup>*</sup> Or, more precisely, by a small team of
        Argentine farmers who have been doing this since long before AI had
        opinions about yerba mate.
      </p>
      <p className="mt-4 max-w-md font-body text-xs text-forest/50">
        *Marketing department&apos;s phrasing, not ours. Check the ingredient
        list — it contains no AI.
      </p>
      <GagStats
        stats={[
          {
            label: "Caffeine",
            value: "80mg",
            detail: "Naturally occurring, aggressively researched.",
          },
          { label: "Sugar", value: "0g", detail: "Yes, still smooth." },
          {
            label: "Leaf species",
            value: "1",
            detail: "Yerba mate, undisturbed since 1800s Misiones.",
          },
        ]}
      />
    </section>
  );
}
