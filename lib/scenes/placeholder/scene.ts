// lib/scenes/placeholder/scene.ts
//
// M1 integration checkpoint scene: a slowly spinning box, colored per-view
// so multiple mounted views are visibly distinct. Exists so the whole
// pipeline (Stage -> RenderHost -> both worker and main-thread hosts) has
// something real to render before the M2 bespoke scenes land.
//
// Default export is a FACTORY (`() => SceneModule`), not a shared instance —
// scene-registry.ts calls it once per view so each view gets its own mesh
// state. `init` stays idempotent/re-runnable per instance for context-loss
// recovery, per the SceneModule contract.

import * as THREE from "three";
import type { SceneModule, ViewContext } from "@/lib/engine/types";

const SPIN_SPEED_X = 0.4; // rad/s
const SPIN_SPEED_Y = 0.6; // rad/s
const BOX_SIZE = 80;

/** Deterministic per-view hue derived from the view's document-space rect. */
function colorForRect(rect: { top: number; left: number }): THREE.Color {
  const hue = (((rect.top * 0.31 + rect.left * 0.53) % 360) + 360) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.55, 0.55);
}

class PlaceholderScene implements SceneModule {
  private geometry: THREE.BoxGeometry | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private light: THREE.DirectionalLight | null = null;

  init(ctx: ViewContext): void {
    // Re-runnable: if a previous init already built the mesh (context
    // restore), tear it down first rather than leaking a duplicate.
    this.dispose();

    this.geometry = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
    this.material = new THREE.MeshStandardMaterial({
      color: colorForRect(ctx.rect),
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    ctx.scene.add(this.mesh);

    this.light = new THREE.DirectionalLight(0xffffff, 1);
    this.light.position.set(1, 1, 1);
    ctx.scene.add(this.light);
  }

  update(dt: number, ctx: ViewContext): void {
    if (!this.mesh) return;
    if (ctx.reducedMotion) return; // static frame — no auto-spin
    this.mesh.rotation.x += dt * SPIN_SPEED_X;
    this.mesh.rotation.y += dt * SPIN_SPEED_Y;
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.parent?.remove(this.mesh);
    }
    if (this.light) {
      this.light.parent?.remove(this.light);
    }
    this.geometry?.dispose();
    this.material?.dispose();
    this.geometry = null;
    this.material = null;
    this.mesh = null;
    this.light = null;
  }
}

export function createPlaceholderScene(): SceneModule {
  return new PlaceholderScene();
}

export default createPlaceholderScene;
