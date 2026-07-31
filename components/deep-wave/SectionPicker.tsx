// components/deep-wave/SectionPicker.tsx
//
// Section 6/6 (design doc §5): 5 flavor cans on a drag/arrow-key carousel.
// The DOM buttons + selection state below are the REAL interaction contract
// (M0), untouched. M2 (picker workstream) wires this to the real "picker"
// scene (lib/scenes/picker/scene.ts): selecting a flavor button both updates
// the DOM panel (as before) AND calls `useEngine().invoke(viewId, "select",
// [index])` — the cross-thread SCENE_INVOKE RPC that rotates the GL
// carousel and lerps its background tint to `flavor.bg`. `viewId` comes from
// useView's `onReady` option (a minimal M2 addition — see useView.ts's
// header — since useView's documented return is just a ref callback with no
// way to read back the viewId EngineProvider assigned it). The DOM panel
// below already works with zero GL, as required by §6's a11y rule.

"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { flavors } from "@/lib/flavors";
import { useView } from "@/lib/engine/react/useView";
import { useEngine } from "@/lib/engine/react/useEngine";

export default function SectionPicker() {
  const [selectedId, setSelectedId] = useState(flavors[0]!.id);
  const [viewId, setViewId] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const selected = flavors.find((f) => f.id === selectedId) ?? flavors[0]!;
  const { invoke } = useEngine();
  const viewRef = useView("picker", { onReady: setViewId });

  function selectFlavor(id: string, index: number) {
    setSelectedId(id);
    if (viewId !== null) {
      invoke(viewId, "select", [index]);
    }
  }

  return (
    <section
      ref={viewRef}
      id="picker"
      aria-labelledby="deep-wave-picker-heading"
      className="relative min-h-svh px-6 py-32 text-cream"
    >
      {/* Background lives in its own negative-z layer so the shared GL
          canvas (fixed z-0, rendered before every section) shows through
          instead of being occluded by this section's own background — see
          SectionHero.tsx's comment for the full stacking-order rationale. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-forest" />
      {/* 5 can meshes render behind this copy via EngineProvider's shared
          canvas (lib/scenes/picker/scene.ts); selecting a flavor below also
          calls invoke(viewId, "select", [index]) so the GL carousel and the
          DOM buttons stay in sync. GL clear-region lerps to flavor.bg. */}
      <div className="mx-auto max-w-3xl">
        <h2
          id="deep-wave-picker-heading"
          className="font-display uppercase leading-[0.95] text-[clamp(2.25rem,7vw,5.5rem)]"
        >
          Choose Your Lift.
        </h2>
        <p className="mt-6 max-w-xl font-body text-lg text-cream/80">
          Five flavors. Zero AI input, despite the branding upstairs. Pick
          one — the can spins, the background answers, the AI takes no
          credit.
        </p>

        <div
          role="group"
          aria-label="Flavor picker"
          className="mt-10 flex flex-wrap gap-3"
        >
          {flavors.map((flavor, index) => (
            <button
              key={flavor.id}
              type="button"
              aria-pressed={flavor.id === selectedId}
              onClick={() => selectFlavor(flavor.id, index)}
              className="flex items-center gap-2 rounded-full border border-cream/30 px-4 py-2 font-body text-sm uppercase tracking-wide transition-colors data-[selected=true]:border-cream data-[selected=true]:bg-cream data-[selected=true]:text-forest"
              data-selected={flavor.id === selectedId}
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: flavor.can }}
              />
              {flavor.name}
            </button>
          ))}
        </div>

        <div className="mt-8 min-h-[6rem]">
          {/* No AnimatePresence: this is a same-tick content swap (not a
              mount/unmount transition), and AnimatePresence's exit-then-enter
              sequencing needs real animation-frame timing to resolve — which
              would make its appearance async/flaky in tests for no visual
              benefit here. Keying the motion.div still replays the entrance
              animation on every selection. */}
          <motion.div
            key={selected.id}
            initial={reduceMotion ? undefined : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <p className="font-display uppercase text-2xl">{selected.name}</p>
            <p className="mt-2 max-w-md font-body text-cream/80">
              {selected.tagline}
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
