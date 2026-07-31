// components/deep-wave/DeepWaveExperience.tsx
//
// M1: wraps the whole experience in EngineProvider (constructs the engine
// client-side only, in an effect; renders the shared <GlCanvas/> internally)
// + LoadingScreen + DebugHud + the 6 sections. Every section already
// renders complete, readable, keyboard/SR-operable content on its own
// (§6's GL-less a11y rule); each now also calls `useView("placeholder")` to
// register itself as a tracked GL view — real per-section scene ids land in
// M2, this checkpoint uses lib/scenes/placeholder/scene.ts for all six.

"use client";

import EngineProvider from "@/lib/engine/react/EngineProvider";
import LoadingScreen from "./LoadingScreen";
import DebugHud from "./DebugHud";
import SectionHero from "./SectionHero";
import SectionExploded from "./SectionExploded";
import SectionParticles from "./SectionParticles";
import SectionPointer from "./SectionPointer";
import SectionSplats from "./SectionSplats";
import SectionPicker from "./SectionPicker";

export default function DeepWaveExperience() {
  return (
    <EngineProvider>
      <LoadingScreen />
      <DebugHud />
      <main>
        <SectionHero />
        <SectionExploded />
        <SectionParticles />
        <SectionPointer />
        <SectionSplats />
        <SectionPicker />
      </main>
    </EngineProvider>
  );
}
