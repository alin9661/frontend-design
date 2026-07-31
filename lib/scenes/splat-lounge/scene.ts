// lib/scenes/splat-lounge/scene.ts
//
// Section 5 (design doc §5 "Splat lounge"): synthesizeCanScene()'s ~130k
// splats rendered via SplatMesh, with scroll orbiting the camera around the
// can/table/ambient-puff set — the "photoreal moment". `onProgress(p)`
// drives a Timeline that owns the orbit angle/height/distance; `update()`
// applies the timeline's current camera state and re-sorts the splat cloud
// against it (SplatMesh.update decides on its own whether a re-sort is
// actually warranted, per its camera-delta threshold).
//
// `?splat=<url>` (an external `.splat`/`.ply` — design doc §5) is NOT wired
// here: fetching an external asset needs the AssetManager's async job
// pipeline (`ctx.assets.add(...)`) plumbed through by whichever integration
// pass wires `?splat=` at the route level, since `init(ctx)` only gets
// `ctx.assets` once per view and this scene has no signal for "the URL
// changed, re-run me" beyond a full re-init. Left as a documented gap — see
// the workstream return notes.
//
// gl/'s layering law: no document/window/react imports; worker-safe.

import * as THREE from "three";
import type { SceneModule, ViewContext } from "@/lib/engine/types";
import { easeInOutCubic } from "@/lib/engine/core/math";
import { Timeline } from "@/lib/engine/gl/timeline";
import { SplatMesh } from "@/lib/engine/gl/splats/SplatMesh";
import { synthesizeCanScene, CAN_HEIGHT } from "@/lib/engine/gl/splats/synthesize";

interface OrbitState {
  [key: string]: number;
  angle: number;
  height: number;
  distance: number;
}

const LOOK_AT_HEIGHT = CAN_HEIGHT * 0.4;

class SplatLoungeScene implements SceneModule {
  private splat: SplatMesh | null = null;
  private timeline: Timeline = new Timeline();
  private readonly orbit: OrbitState = { angle: 0, height: 0, distance: 0 };

  init(ctx: ViewContext): void {
    // Re-runnable (context-loss restore): tear down any previous instance
    // before building a fresh one rather than leaking splats/textures.
    this.dispose();

    const data = synthesizeCanScene();
    this.splat = new SplatMesh(data);
    ctx.scene.add(this.splat.object3d);

    this.timeline = new Timeline()
      .add(this.orbit, "angle", [
        { t: 0, v: -Math.PI * 0.35 },
        { t: 1, v: Math.PI * 0.35, ease: easeInOutCubic },
      ])
      .add(this.orbit, "height", [
        { t: 0, v: CAN_HEIGHT * 0.55 },
        { t: 0.5, v: CAN_HEIGHT * 0.9 },
        { t: 1, v: CAN_HEIGHT * 0.6 },
      ])
      .add(this.orbit, "distance", [
        { t: 0, v: 260 },
        { t: 1, v: 340 },
      ]);
    this.timeline.sample(0);
    this.applyCamera(ctx.camera);
  }

  onProgress(p: number): void {
    this.timeline.sample(p);
  }

  update(_dt: number, ctx: ViewContext): void {
    if (!this.splat) return;
    this.applyCamera(ctx.camera);
    this.splat.update(ctx.camera);
  }

  private applyCamera(camera: THREE.PerspectiveCamera): void {
    const { angle, height, distance } = this.orbit;
    camera.position.set(Math.sin(angle) * distance, height, Math.cos(angle) * distance);
    camera.lookAt(0, LOOK_AT_HEIGHT, 0);
  }

  dispose(): void {
    // SplatMesh.dispose() removes its own object3d from its scene parent
    // (whatever that parent currently is) before freeing its geometry/
    // material/textures — no need to hold onto `ctx.scene` here.
    if (this.splat) {
      this.splat.dispose();
      this.splat = null;
    }
  }
}

export function createSplatLoungeScene(): SceneModule {
  return new SplatLoungeScene();
}

export default createSplatLoungeScene;
