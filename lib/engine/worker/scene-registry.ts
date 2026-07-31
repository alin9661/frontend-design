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

function notImplemented(id: SceneId): SceneLoader {
  return () =>
    Promise.reject(
      new Error(`scene-registry: scene "${id}" is not implemented yet (lands in M2)`)
    );
}

export const sceneRegistry: Record<SceneId, SceneLoader> = {
  placeholder: () =>
    import("@/lib/scenes/placeholder/scene").then((m) => m.default()),
  "hero-can": notImplemented("hero-can"),
  exploded: notImplemented("exploded"),
  particles: notImplemented("particles"),
  "pointer-field": notImplemented("pointer-field"),
  "splat-lounge": notImplemented("splat-lounge"),
  picker: notImplemented("picker"),
};

export function loadScene(id: SceneId): Promise<SceneModule> {
  const loader = sceneRegistry[id];
  return loader();
}
