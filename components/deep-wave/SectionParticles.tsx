// components/deep-wave/SectionParticles.tsx
//
// Section 3/6 (design doc §5): curl-noise energy/steam particles, scroll-
// driven forest→lemon color ramp, MSDF section title. DOM/copy is the M0
// shell, untouched. Wires `useView("particles")` — see
// lib/scenes/particles/scene.ts for the actual gpgpu/curl-noise field.

"use client";

import { useView } from "@/lib/engine/react/useView";
import GagStats from "./GagStats";

export default function SectionParticles() {
  const viewRef = useView("particles");

  return (
    <section
      ref={viewRef}
      id="energy"
      aria-labelledby="deep-wave-particles-heading"
      className="relative min-h-svh px-6 py-32 text-forest"
    >
      {/* Background lives in its own negative-z layer so the shared GL
          canvas (fixed z-0, rendered before every section) shows through
          instead of being occluded by this section's own background — see
          SectionHero.tsx's comment for the full stacking-order rationale. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-cream" />
      {/* The gpgpu ping-pong particle field renders behind this copy via
          EngineProvider's shared canvas once the real "particles" scene
          lands in M2, ramping forest → lemon with scroll progress. */}
      <div className="mx-auto max-w-3xl">
        <h2
          id="deep-wave-particles-heading"
          className="font-display uppercase leading-[0.95] text-[clamp(2.25rem,7vw,5.5rem)]"
        >
          Your Energy, Rendered.
        </h2>
        <p className="mt-6 max-w-xl font-body text-lg text-forest/80">
          We modeled the caffeine-to-calm curve in real time so you don&apos;t
          have to picture it. It looks like a slow drift of forest fog easing
          into citrus — not a spike chart, not a cliff, not a 2pm crash.
        </p>
        <GagStats
          stats={[
            { label: "Crash probability", value: "0%", detail: "Modeled, not promised." },
            { label: "Jitters detected", value: "0", detail: "Checked twice." },
            {
              label: "Particle count",
              value: "128²–512²",
              detail: "As many as your GPU can afford.",
            },
          ]}
        />
      </div>
    </section>
  );
}
