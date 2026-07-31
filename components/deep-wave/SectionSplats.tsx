// components/deep-wave/SectionSplats.tsx
//
// Section 5/6 (design doc §5): synthesizeCanScene() Gaussian splat set,
// camera orbiting on scroll. DOM/copy is the M0 shell, untouched; the real
// HUD numbers (splat count, sortMs) come from `?debug` + worker STATS
// messages, already wired in DebugHud.tsx. M1 wires `useView` here (real
// "splat-lounge" scene lands in M2; uses the M1 checkpoint "placeholder"
// scene for now).

"use client";

import { useView } from "@/lib/engine/react/useView";
import GagStats from "./GagStats";

export default function SectionSplats() {
  const viewRef = useView("placeholder");

  return (
    <section
      ref={viewRef}
      id="lounge"
      aria-labelledby="deep-wave-splats-heading"
      className="relative min-h-svh bg-cream px-6 py-32 text-forest"
    >
      {/* SplatMesh renders behind this copy via EngineProvider's shared
          canvas once the real "splat-lounge" scene lands in M2; scroll
          orbits the camera around the synthesized can + table + ambient-puff
          splat set. Also honors ?splat=<url> to load an external .splat/
          .ply. */}
      <div className="mx-auto max-w-3xl">
        <h2
          id="deep-wave-splats-heading"
          className="font-display uppercase leading-[0.95] text-[clamp(2rem,6.5vw,5rem)]"
        >
          So Real It&apos;s Statistically Questionable.
        </h2>
        <p className="mt-6 max-w-xl font-body text-lg text-forest/80">
          The can, reconstructed as a hundred thousand soft little
          probability clouds instead of a flat photo, because it&apos;s 2026
          and regular renders felt insufficiently ambitious. Tastes exactly
          the same either way.
        </p>
        <GagStats
          stats={[
            { label: "Splat count", value: "~100k", detail: "Synthesized, not scanned." },
            { label: "Sort passes", value: "Continuous", detail: "16-bit counting sort." },
            { label: "Photorealism", value: "Debatable", detail: "In a good way." },
          ]}
        />
      </div>
    </section>
  );
}
