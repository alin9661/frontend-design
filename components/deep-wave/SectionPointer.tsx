// components/deep-wave/SectionPointer.tsx
//
// Section 4/6 (design doc §5): ~300 InstancedMesh leaves/berries with spring
// integrators reacting to pointer velocity + click impulse. DOM/copy is the
// M0 shell, untouched. Wires `useView("pointer-field")` — see
// lib/scenes/pointer-field/scene.ts for the actual GL scene (M2).

"use client";

import { useView } from "@/lib/engine/react/useView";
import GagStats from "./GagStats";

export default function SectionPointer() {
  const viewRef = useView("pointer-field");

  return (
    <section
      ref={viewRef}
      id="attention"
      aria-labelledby="deep-wave-pointer-heading"
      className="relative min-h-svh bg-forest px-6 py-32 text-cream"
    >
      {/* The instanced leaf/berry field renders behind this copy via
          EngineProvider's shared canvas (lib/scenes/pointer-field/scene.ts);
          onPointer(hit) drives its click/impulse burst (touch = move
          impulses, since a PointerHit doesn't distinguish hover from
          click/tap). */}
      <div className="mx-auto max-w-3xl">
        <h2
          id="deep-wave-pointer-heading"
          className="font-display uppercase leading-[0.95] text-[clamp(2.25rem,7vw,5.5rem)]"
        >
          It Knows You&apos;re There.
        </h2>
        <p className="mt-6 max-w-xl font-body text-lg text-cream/80">
          Three hundred leaves, berries, and citrus wedges, each running its
          own tiny physics simulation just to flinch when your cursor gets
          close. This is, if we&apos;re honest, the only part of this page an
          AI actually touched.
        </p>
        <GagStats
          stats={[
            { label: "Leaves employed", value: "~300" },
            { label: "Response time", value: "1 frame" },
            { label: "Leaves unionized", value: "Pending" },
          ]}
        />
      </div>
    </section>
  );
}
