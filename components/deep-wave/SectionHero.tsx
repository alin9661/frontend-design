// components/deep-wave/SectionHero.tsx
//
// Section 1/6 (design doc §5): procedural can hero. DOM/copy is the M0
// shell, untouched — this section already works with zero GL. M1 wires
// `useView` so this section's rect is tracked by the shared engine; the
// real "hero-can" scene lands in M2, so it uses the M1 checkpoint
// "placeholder" scene for now (per §7's build phasing).

"use client";

import { useView } from "@/lib/engine/react/useView";
import GagStats from "./GagStats";

export default function SectionHero() {
  const viewRef = useView("placeholder");

  return (
    <section
      ref={viewRef}
      id="hero"
      aria-labelledby="deep-wave-hero-heading"
      className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-cream px-6 text-center text-forest"
    >
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
