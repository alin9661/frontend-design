// lib/engine/worker/scene-registry.ts
//
// SceneId -> dynamic-import loader map. Both the worker and the main-thread
// fallback host import this SAME registry (functions can't cross
// postMessage, so each side resolves scene ids to modules locally).
//
// Convention: each scene module's default export is a FACTORY
// (`() => SceneModule`), called once per loader invocation so every view
// gets its own instance. Only "placeholder" resolves for now — the M2
// scenes fill in the rest.

import type { SceneId, SceneModule } from "../types";

export type SceneLoader = () => Promise<SceneModule>;

export const sceneRegistry: Record<SceneId, SceneLoader> = {
  placeholder: () =>
    import("@/lib/scenes/placeholder/scene").then((m) => m.default()),
  "hero-can": () =>
    import("@/lib/scenes/hero-can/scene").then((m) => m.default()),
  exploded: () =>
    import("@/lib/scenes/exploded/scene").then((m) => m.default()),
  particles: () =>
    import("@/lib/scenes/particles/scene").then((m) => m.default()),
  "pointer-field": () =>
    import("@/lib/scenes/pointer-field/scene").then((m) => m.default()),
  "splat-lounge": () =>
    import("@/lib/scenes/splat-lounge/scene").then((m) => m.default()),
  picker: () =>
    import("@/lib/scenes/picker/scene").then((m) => m.default()),
};

export function loadScene(id: SceneId): Promise<SceneModule> {
  const loader = sceneRegistry[id];
  return loader();
}
