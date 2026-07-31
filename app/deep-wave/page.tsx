import type { Metadata } from "next";
import DeepWaveExperience from "@/components/deep-wave/DeepWaveExperience";

export const metadata: Metadata = {
  title: "DEEP WAVE — Mateína, Brewed by AI*",
  description:
    "An experimental WebGL showcase for Mateína: six scroll-driven scenes, procedural cans, Gaussian splats — and zero actual AI in the recipe.",
};

export default function DeepWavePage() {
  return <DeepWaveExperience />;
}
