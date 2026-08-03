// lib/scenes/pointer-field/scene.ts
//
// M2 "pointer-field" scene (design doc §5 row 4): ~300 InstancedMesh leaf +
// berry shapes on the pure `PointerFieldSim` spring integrator (sim.ts).
// Continuous pointer velocity (ViewContext.pointer) shoves nearby items;
// onPointer (click/down, and — since a PointerHit carries no separate
// "was this a click vs. a hover" flag — any touch-driven hover-enter too,
// which is exactly what makes "touch = same via pointer moves" work for
// free) applies a one-shot impulse burst. Items always spring back home.
// reducedMotion swaps the layout to an exact static grid and skips physics
// entirely (one static frame, per design doc §6 a11y: "static frames").
//
// Interactive registration (design doc §4A raycast gap): both leafMesh and
// berryMesh are registered via `ctx.registerInteractive()` so both
// RenderHost implementations raycast them each frame (gl/raycast.ts's
// shared `runViewRaycasts()`). Each mesh's `userData.instanceIndexMap` is
// set to that mesh's own `leafIndices`/`berryIndices` array, so a real hit's
// `instanceId` (see gl/raycast.ts's `resolveInstanceId`) already arrives
// here as the GLOBAL `PointerFieldSim` index regardless of which of the two
// meshes was actually hit — `onPointer` uses it to center the click impulse
// on that exact instance's own current position instead of the (less
// precise, since it's a point on the hit quad's surface rather than the
// instance's own center) raycast `hit.point`.
//
// Default export is a FACTORY (`() => SceneModule`), matching
// lib/scenes/placeholder/scene.ts's convention — scene-registry.ts calls it
// once per view so each mounted view gets its own instance/state.

import * as THREE from "three";
import type { PointerHit, SceneModule, ViewContext } from "@/lib/engine/types";
import { PointerFieldSim, createHomeGrid, colorForInstance, type FieldItemKind } from "./sim";

const TOTAL_COUNT = 300;
/** Every 4th instance (index % 4 === 3) is a berry — ~25% berries, ~75%
 * leaves, interleaved through the grid rather than split into two clusters. */
const BERRY_EVERY = 4;

const LEAF_SIZE = 15; // px, matches View's 1-world-unit = 1-CSS-px convention
const BERRY_RADIUS = 6; // px

/** Fraction of a grid cell an item's home position is jittered by when
 * motion is allowed, for an organic (non-mechanical) scatter. */
const HOME_JITTER = 0.6;

const SPRING_STIFFNESS = 90;
const SPRING_DAMPING = 12;

/** Continuous pointer-velocity shove (design doc: "pointer velocity ...
 * applies radial shove within influence radius"). */
const SHOVE_RADIUS = 140; // px
const SHOVE_STRENGTH = 2200; // px/s^2 per unit of (normalized pointer speed)

/** One-shot click/down impulse burst. */
const IMPULSE_RADIUS = 170; // px
const IMPULSE_STRENGTH = 4200; // px/s (added velocity, scaled by falloff)

function isBerry(index: number): boolean {
  return index % BERRY_EVERY === BERRY_EVERY - 1;
}

function leafGeometry(): THREE.BufferGeometry {
  // Simple almond/leaf silhouette, flat in the XY plane (facing the camera,
  // which sits on +z looking toward the origin with no explicit rotation —
  // same convention lib/scenes/placeholder/scene.ts relies on).
  const shape = new THREE.Shape();
  const half = LEAF_SIZE / 2;
  shape.moveTo(0, -half);
  shape.quadraticCurveTo(half, 0, 0, half);
  shape.quadraticCurveTo(-half, 0, 0, -half);
  return new THREE.ShapeGeometry(shape);
}

function berryGeometry(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(BERRY_RADIUS, 10);
}

class PointerFieldScene implements SceneModule {
  private sim: PointerFieldSim | null = null;
  private leafIndices: number[] = [];
  private berryIndices: number[] = [];
  private leafGeo: THREE.BufferGeometry | null = null;
  private berryGeo: THREE.BufferGeometry | null = null;
  private leafMat: THREE.MeshBasicMaterial | null = null;
  private berryMat: THREE.MeshBasicMaterial | null = null;
  private leafMesh: THREE.InstancedMesh | null = null;
  private berryMesh: THREE.InstancedMesh | null = null;
  private readonly dummy = new THREE.Object3D();
  private reducedMotion = false;
  private pendingImpulse: { x: number; y: number } | null = null;

  init(ctx: ViewContext): void {
    // Re-runnable: tear down any previous instance's resources first
    // (context-loss restore contract).
    this.dispose();

    this.reducedMotion = ctx.reducedMotion;

    const { width, height } = ctx.rect;
    const jitter = ctx.reducedMotion ? 0 : HOME_JITTER;
    const home = createHomeGrid(TOTAL_COUNT, width, height, jitter);
    this.sim = new PointerFieldSim(home.x, home.y, {
      stiffness: SPRING_STIFFNESS,
      damping: SPRING_DAMPING,
    });

    this.leafIndices = [];
    this.berryIndices = [];
    for (let i = 0; i < TOTAL_COUNT; i++) {
      (isBerry(i) ? this.berryIndices : this.leafIndices).push(i);
    }

    this.leafGeo = leafGeometry();
    this.berryGeo = berryGeometry();
    this.leafMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.berryMat = new THREE.MeshBasicMaterial({ vertexColors: true });

    this.leafMesh = new THREE.InstancedMesh(this.leafGeo, this.leafMat, Math.max(this.leafIndices.length, 1));
    this.berryMesh = new THREE.InstancedMesh(this.berryGeo, this.berryMat, Math.max(this.berryIndices.length, 1));
    // Per-instance positions span the full home grid, well outside the
    // (0-centered) geometry's own bounding sphere — without this, three's
    // default frustum-cull test (based on the un-instanced geometry bounds)
    // would incorrectly cull items near the grid's edges.
    this.leafMesh.frustumCulled = false;
    this.berryMesh.frustumCulled = false;

    this.applyColors(this.leafMesh, this.leafIndices, "leaf");
    this.applyColors(this.berryMesh, this.berryIndices, "berry");
    this.applyTransforms(this.leafMesh, this.leafIndices);
    this.applyTransforms(this.berryMesh, this.berryIndices);

    // See this class's header comment: lets gl/raycast.ts's toPointerHit
    // remap each mesh's own local instanceId back to the shared PointerFieldSim
    // global index space.
    this.leafMesh.userData.instanceIndexMap = this.leafIndices;
    this.berryMesh.userData.instanceIndexMap = this.berryIndices;

    ctx.scene.add(this.leafMesh);
    ctx.scene.add(this.berryMesh);
    ctx.registerInteractive?.([this.leafMesh, this.berryMesh]);
  }

  update(dt: number, ctx: ViewContext): void {
    this.reducedMotion = ctx.reducedMotion;
    const sim = this.sim;
    if (!sim || !this.leafMesh || !this.berryMesh) return;
    if (ctx.reducedMotion) return; // static grid — no physics, no per-frame work

    const { width, height } = ctx.rect;
    // ViewContext.pointer is the full-viewport normalized pointer (§4
    // core/pointer.ts), not a per-view NDC (that only exists once something
    // is actually raycast-hit). We approximate this view's local pointer
    // position by scaling it against the view's own half-extents, which is
    // exact when the section fills the viewport (true for this section) and
    // a reasonable approximation otherwise.
    const pointerX = ctx.pointer.x * (width / 2);
    const pointerY = ctx.pointer.y * (height / 2);
    const pointerSpeed = Math.hypot(ctx.pointer.vx, ctx.pointer.vy);
    if (ctx.pointer.inside && pointerSpeed > 0) {
      sim.applyRadialImpulse(pointerX, pointerY, SHOVE_RADIUS, pointerSpeed * SHOVE_STRENGTH * dt);
    }

    if (this.pendingImpulse) {
      sim.applyRadialImpulse(this.pendingImpulse.x, this.pendingImpulse.y, IMPULSE_RADIUS, IMPULSE_STRENGTH);
      this.pendingImpulse = null;
    }

    sim.step(dt);
    this.applyTransforms(this.leafMesh, this.leafIndices);
    this.applyTransforms(this.berryMesh, this.berryIndices);
  }

  onPointer(hit: PointerHit | null): void {
    if (!hit || this.reducedMotion) return;
    // Click/down burst (desktop) and touch's hover-enter-on-move (mobile)
    // both arrive here as a non-null hit — queued and applied on the next
    // update() so it happens on the sim's own dt-stepped clock.
    //
    // Prefer the real hit's instanceId (already remapped to this scene's
    // global PointerFieldSim index — see this class's header comment):
    // centers the impulse on that exact instance's own current position,
    // which is more precise than the raycast's hit.point (a point on the
    // hit quad's flat surface, not necessarily the instance's own center).
    // Falls back to hit.point for hand-built hits with no instanceId (e.g.
    // a non-instanced-mesh raycast target, or a hit synthesized in tests).
    if (this.sim && hit.instanceId != null) {
      const gx = this.sim.posX[hit.instanceId];
      const gy = this.sim.posY[hit.instanceId];
      if (gx != null && gy != null) {
        this.pendingImpulse = { x: gx, y: gy };
        return;
      }
    }
    this.pendingImpulse = { x: hit.point.x, y: hit.point.y };
  }

  dispose(): void {
    if (this.leafMesh) this.leafMesh.parent?.remove(this.leafMesh);
    if (this.berryMesh) this.berryMesh.parent?.remove(this.berryMesh);
    this.leafGeo?.dispose();
    this.berryGeo?.dispose();
    this.leafMat?.dispose();
    this.berryMat?.dispose();

    this.leafMesh = null;
    this.berryMesh = null;
    this.leafGeo = null;
    this.berryGeo = null;
    this.leafMat = null;
    this.berryMat = null;
    this.sim = null;
    this.leafIndices = [];
    this.berryIndices = [];
    this.pendingImpulse = null;
  }

  private applyColors(mesh: THREE.InstancedMesh, indices: number[], kind: FieldItemKind): void {
    const color = new THREE.Color();
    indices.forEach((globalIndex, localIndex) => {
      color.setHex(colorForInstance(globalIndex, kind));
      mesh.setColorAt(localIndex, color);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private applyTransforms(mesh: THREE.InstancedMesh, indices: number[]): void {
    const sim = this.sim;
    if (!sim) return;
    indices.forEach((globalIndex, localIndex) => {
      this.dummy.position.set(sim.posX[globalIndex]!, sim.posY[globalIndex]!, 0);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(localIndex, this.dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
}

export function createPointerFieldScene(): SceneModule {
  return new PointerFieldScene();
}

export default createPointerFieldScene;
