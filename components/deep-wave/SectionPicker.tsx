// components/deep-wave/SectionPicker.tsx
//
// Section 6/6 (design doc §5): 5 flavor cans on a drag/arrow-key carousel.
// The DOM buttons + selection state below are the REAL interaction contract
// (M0), untouched. M1 wires `useView` here; the GL can mesh + MSDF flavor
// name + real "picker" scene + `invoke(viewId, "select", [i])` cross-thread
// sync land together in M2 (this section has no way to reach its own
// viewId to call `invoke` until then — uses the M1 checkpoint "placeholder"
// scene for now). The DOM panel below already works with zero GL, as
// required by §6's a11y rule.

"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { flavors } from "@/lib/flavors";
import { useView } from "@/lib/engine/react/useView";

export default function SectionPicker() {
  const [selectedId, setSelectedId] = useState(flavors[0]!.id);
  const reduceMotion = useReducedMotion();
  const selected = flavors.find((f) => f.id === selectedId) ?? flavors[0]!;
  const viewRef = useView("placeholder");

  return (
    <section
      ref={viewRef}
      id="picker"
      aria-labelledby="deep-wave-picker-heading"
      className="relative min-h-svh bg-forest px-6 py-32 text-cream"
    >
      {/* 5 can meshes render behind this copy via EngineProvider's shared
          canvas once the real "picker" scene lands in M2; selecting a
          flavor below also calls invoke(viewId, "select", [index]) so the
          GL carousel and the DOM buttons stay in sync. GL clear-region
          lerps to flavor.bg. */}
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
          {flavors.map((flavor) => (
            <button
              key={flavor.id}
              type="button"
              aria-pressed={flavor.id === selectedId}
              onClick={() => setSelectedId(flavor.id)}
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
