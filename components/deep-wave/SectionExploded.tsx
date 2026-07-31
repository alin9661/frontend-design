// components/deep-wave/SectionExploded.tsx
//
// Section 2/6 (design doc §5): the can decomposes into lid/tab/shell/label/
// leaf planes on a scrubbing Timeline (see lib/scenes/exploded/scene.ts).
// This DOM copy is complete and readable with zero GL; the "exploded" scene
// renders behind it via EngineProvider's shared canvas and drives its
// Timeline from this section's scroll progress. Leader lines anchor toward
// normalized offsets within this section's rect — see the convention
// documented at the top of lib/scenes/exploded/scene.ts, which loosely
// tracks the PARTS grid below (kept in comment-sync manually since the
// scene module can't read DOM layout — it's worker-safe).

"use client";

import { useView } from "@/lib/engine/react/useView";
import GagStats from "./GagStats";

const PARTS: Array<{ name: string; note: string }> = [
  { name: "Lid", note: "Aluminum. Opens on the first pull. We checked." },
  { name: "Tab", note: "Rated for one dramatic crack per can. Do not overachieve." },
  {
    name: "Shell",
    note: "100% recycled aluminum, 0% recycled marketing copy.",
  },
  {
    name: "Label",
    note: "Printed, not projected — despite what Section 3 implies.",
  },
  {
    name: "Leaf ×3",
    note: "Yerba mate, whole leaf, steeped once, then left alone.",
  },
];

export default function SectionExploded() {
  const viewRef = useView("exploded");

  return (
    <section
      ref={viewRef}
      id="anatomy"
      aria-labelledby="deep-wave-exploded-heading"
      className="relative min-h-svh bg-forest px-6 py-32 text-cream"
    >
      {/* The exploded-can view renders behind this copy via EngineProvider's
          shared canvas; onProgress(p) drives lib/scenes/exploded/scene.ts's
          Timeline as this section scrolls through view. */}
      <div className="mx-auto max-w-3xl">
        <h2
          id="deep-wave-exploded-heading"
          className="font-display uppercase leading-[0.95] text-[clamp(2.25rem,7vw,5.5rem)]"
        >
          Anatomy of a Lift.
        </h2>
        <p className="mt-6 max-w-xl font-body text-lg text-cream/80">
          We ran the can through six diagnostic passes so you don&apos;t have
          to. Here&apos;s everything actually inside — no proprietary blend,
          no mystery molecule, just tea, water, and a can that knows when to
          stop pretending to be a spaceship.
        </p>

        <dl className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {PARTS.map((part) => (
            <div
              key={part.name}
              className="border-l-2 border-cream/30 pl-4"
            >
              <dt className="font-display uppercase text-xl">{part.name}</dt>
              <dd className="mt-1 font-body text-sm text-cream/70">
                {part.note}
              </dd>
            </div>
          ))}
        </dl>

        <GagStats
          stats={[
            { label: "Parts", value: "7", detail: "Lid, tab, shell, label, 3 leaves." },
            { label: "Assembly steps", value: "1", detail: "Filled, sealed, shipped." },
            { label: "Mystery molecules", value: "0", detail: "We looked twice." },
          ]}
        />
      </div>
    </section>
  );
}
