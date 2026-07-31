// components/deep-wave/SectionSplats.tsx
//
// Section 5/6 (design doc §5): synthesizeCanScene() Gaussian splat set
// (lib/scenes/splat-lounge/scene.ts), camera orbiting on scroll via
// SplatMesh + Timeline. DOM/copy is the M0 shell, untouched; the live HUD
// numbers (splat count, sortMs) come from `?debug` + worker STATS messages
// (DebugHud.tsx) rather than local prop plumbing here — STATS is already a
// global (not per-view) channel in the current worker/host contract, so a
// per-section stat readout would either duplicate that global number or
// need a new per-view stats channel neither host implementation exposes yet
// (see the workstream return notes for the exact gap: render.worker.ts /
// host.ts's MainThreadHost both hardcode `splats: 0, sortMs: 0` today since
// gl/Stage has no per-view SceneModule getter for either host to read
// `SplatMesh.stats` through — a cross-workstream wiring gap, not something
// fixable from this section component alone).

"use client";

import { useView } from "@/lib/engine/react/useView";
import GagStats from "./GagStats";

export default function SectionSplats() {
  const viewRef = useView("splat-lounge");

  return (
    <section
      ref={viewRef}
      id="lounge"
      aria-labelledby="deep-wave-splats-heading"
      className="relative min-h-svh px-6 py-32 text-cream"
    >
      {/* Background lives in its own negative-z layer so the shared GL
          canvas (fixed z-0, rendered before every section) shows through
          instead of being occluded by this section's own background — see
          SectionHero.tsx's comment for the full stacking-order rationale. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-cream" />
      {/* Left-side scrim behind the copy column (confirmed design-review
          fix, paired with lib/scenes/splat-lounge/scene.ts's orbit-distance
          fix): the splat cloud is dark near the camera, so even after
          pulling the orbit back to a proper "can on a table" framing, the
          headline/stats need guaranteed contrast rather than depending on
          exactly what the render looks like under the copy at any given
          scroll position. `text-cream` above (was `text-forest`) pairs with
          it — dark-on-dark was the confirmed ~1.3:1 contrast failure. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(90deg, rgba(10,25,20,0.75), transparent 60%)" }}
      />
      {/* SplatMesh renders behind this copy via EngineProvider's shared
          canvas; scroll orbits the camera around the synthesized can +
          table + ambient-puff splat set (lib/scenes/splat-lounge/scene.ts).
          ?splat=<url> external .splat/.ply loading is not yet wired — see
          scene.ts's header comment for why. */}
      <div className="relative mx-auto max-w-3xl">
        <h2
          id="deep-wave-splats-heading"
          className="font-display uppercase leading-[0.95] text-[clamp(2rem,6.5vw,5rem)]"
        >
          So Real It&apos;s Statistically Questionable.
        </h2>
        <p className="mt-6 max-w-xl font-body text-lg text-cream/80">
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
