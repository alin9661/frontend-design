// lib/scenes/exploded/scene.ts
//
// "exploded" scene (design doc §5, row 2 "Exploded"): the can decomposes
// into lid / tab / shell / label / 3 procedural leaf planes along Y, all
// driven by ONE gl/timeline Timeline. `onProgress(p)` calls `tl.sample(p)`,
// which is idempotent and scrubs cleanly in either direction — there is no
// dt-based auto-animation here, the whole decomposition is a pure function
// of scroll progress.
//
// Consumes the can contract verbatim (owner: hero-can workstream):
//   buildCan(flavor, opts?) -> { group, parts: {shell,lid,tab,label}, dispose }
// That module may not exist yet mid-parallel-build; this file is written
// against the frozen contract in docs/deep-wave-engine-design.md §M2.
//
// Worker-safe per gl/'s layering law: no document/window/react imports.
//
// --- Leader-line anchor convention -----------------------------------------
// Scene modules never touch the DOM (worker-safe), so "DOM copy anchor
// points" can't be measured directly. Instead each part is assigned a
// NORMALIZED offset within the view's rect — `{ x: 0..1 left->right, y: 0..1
// top->bottom }`, i.e. plain CSS-style fractional coordinates, matching how
// SectionExploded.tsx's copy grid is laid out under the heading. That offset
// is converted to the view's local THREE space (1 world unit = 1 CSS px,
// origin at rect center, +Y up — see gl/view.ts) via:
//   localX = (offset.x - 0.5) * rect.width
//   localY = (0.5 - offset.y) * rect.height   // flip: DOM y-down -> GL y-up
// Each leader line is a 2-segment elbow: [partWorldPos, {x: anchorX, y:
// partWorldPos.y}, anchorWorldPos] — travel horizontally to the anchor's
// column first, then vertically to the anchor itself.
// -----------------------------------------------------------------------------

import * as THREE from "three";
import type { RectData, SceneModule, ViewContext } from "@/lib/engine/types";
import { easeInOutCubic, mapRange, smoothstep } from "@/lib/engine/core/math";
import { Timeline } from "@/lib/engine/gl/timeline";
import { buildCan } from "@/lib/scenes/hero-can/can-geometry";
import { createLabelTexture } from "@/lib/scenes/hero-can/label-texture";
import { decor, flavorById, flavors } from "@/lib/flavors";

// Anatomy section isn't flavor-specific copy, so any can from the lineup
// "works" contractually — but `flavors[0]` (lemon, a light gold/mustard
// can) is off-brand here: no other /deep-wave section uses that color, and
// it clashes with the green/cream palette everywhere else on the page (a
// confirmed design-review finding). Mint's can color is the same green
// family hero-can/scene.ts uses for its own can.
const DEFAULT_FLAVOR_ID = flavorById("mint").id;
/** Shifts the whole exploded assembly right of the copy column (confirmed
 * design-review fix, same composition pattern as hero-can/scene.ts). */
const ASSEMBLY_X_OFFSET_FACTOR = 0.2; // × ctx.rect.width

type CanPartKey = "lid" | "tab" | "shell" | "label";
type LeafKey = "leaf0" | "leaf1" | "leaf2";
type PartKey = CanPartKey | LeafKey;

const CAN_PART_KEYS: readonly CanPartKey[] = ["lid", "tab", "shell", "label"];
const LEAF_KEYS: readonly LeafKey[] = ["leaf0", "leaf1", "leaf2"];
const ALL_PART_KEYS: readonly PartKey[] = [...CAN_PART_KEYS, ...LEAF_KEYS];

interface ExplodeTarget {
  // Index signature (in addition to the named properties below) so a
  // `delta` object can be passed straight to Timeline.add(), whose `target`
  // param is typed `Record<string, number>`.
  [prop: string]: number;
  y: number;
  rotX: number;
  rotZ: number;
}

/**
 * Target deltas at Timeline p=1, added on top of each part's assembled
 * (p=0) local position/rotation. Values are in the can-group's own local
 * space (world units == that group's units, whatever hero-can chose them to
 * be) so the explode direction/scale stays consistent with the can's own
 * proportions regardless of any transform buildCan applies to the group.
 * Exported so test/scenes/exploded.test.ts can assert exact expected
 * positions without duplicating magic numbers.
 */
// Gaps widened (confirmed design-review fix — "the exploded can is
// actually one tilted blob", parts overlapping enough to read as one mass
// rather than a diagram) so each part clears its neighbors by a larger
// margin at full explode (p=1), giving the leader lines an unambiguous,
// visibly-separated endpoint to land on.
export const EXPLODE_TARGETS: Record<PartKey, ExplodeTarget> = {
  lid: { y: 230, rotX: 0.05, rotZ: 0 },
  tab: { y: 360, rotX: 0.2, rotZ: 0.9 },
  label: { y: -30, rotX: 0, rotZ: 0.35 },
  shell: { y: -180, rotX: 0, rotZ: 0 },
  leaf0: { y: -320, rotX: 0.25, rotZ: -0.4 },
  leaf1: { y: -370, rotX: -0.2, rotZ: 0.5 },
  leaf2: { y: -420, rotX: 0.15, rotZ: -0.25 },
};

/** Normalized [0,1] rect offsets each leader line points at — see file header. */
const ANCHOR_OFFSETS: Record<PartKey, { x: number; y: number }> = {
  lid: { x: 0.08, y: 0.4 },
  tab: { x: 0.34, y: 0.4 },
  shell: { x: 0.6, y: 0.4 },
  label: { x: 0.86, y: 0.4 },
  leaf0: { x: 0.6, y: 0.62 },
  leaf1: { x: 0.6, y: 0.62 },
  leaf2: { x: 0.6, y: 0.62 },
};

const LEAF_BASE_LOCAL: Record<LeafKey, { x: number; y: number; z: number; rotZ: number }> = {
  leaf0: { x: -20, y: -10, z: 12, rotZ: 0.2 },
  leaf1: { x: 0, y: -6, z: -16, rotZ: -0.15 },
  leaf2: { x: 20, y: -10, z: 10, rotZ: 0.35 },
};

const LEAF_LENGTH = 70;
const LEAF_WIDTH = 24;
const LEAF_COLORS: Record<LeafKey, string> = {
  leaf0: decor.leafDark,
  leaf1: decor.leafLight,
  leaf2: decor.leafDark,
};

const LEADER_LINE_COLOR = 0xf9f9ee; // brand.cream
const LEADER_LINE_BASE_OPACITY = 0.7;

// Motion-audit fix C1: the explosion used to run linearly across the FULL
// 0..1 view-progress span, so the can was already mid-explode the instant
// this section entered view and only half-exploded at center (the section's
// most readable moment) — no assembled "before" state and no fully-exploded
// "after" state to read against. Re-keyed with a dead zone on both ends
// (assembled through the first quarter while the section is still entering,
// fully exploded by the last quarter before it exits) so the decomposition
// itself plays out through the readable middle, eased rather than linear so
// velocity ramps up/down instead of starting/stopping instantly.
export const EXPLODE_DEADZONE_START = 0.25;
export const EXPLODE_DEADZONE_END = 0.75;

// Motion-audit fix N7: leader-line opacity used to be `0.7 * p` raw — a
// straight-line fade across the whole span, so the lines were already
// partway visible before the parts had meaningfully separated. Windowed so
// they arrive as a deliberate beat AFTER the explosion is underway (parts
// have cleared each other) and are fully on well before center.
export const LEADER_LINE_FADE_IN_START = 0.35;
export const LEADER_LINE_FADE_IN_END = 0.6;

/** A simple bezier lens/leaf silhouette, pointed along +Y, centered at origin. */
function createLeafGeometry(length: number, width: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const half = length / 2;
  shape.moveTo(0, -half);
  shape.quadraticCurveTo(width, -half * 0.25, 0, half);
  shape.quadraticCurveTo(-width, -half * 0.25, 0, -half);
  return new THREE.ShapeGeometry(shape, 8);
}

interface TrackedPart {
  object: THREE.Object3D;
  base: { y: number; rotX: number; rotZ: number };
  delta: ExplodeTarget; // mutated in place by Timeline.sample()
}

class ExplodedScene implements SceneModule {
  private group: THREE.Group | null = null;
  private canDispose: (() => void) | null = null;
  private timeline: Timeline | null = null;
  private tracked = new Map<PartKey, TrackedPart>();

  private leafGeometry: THREE.ShapeGeometry | null = null;
  private leafMaterials: THREE.MeshStandardMaterial[] = [];

  private leaderMaterial: THREE.LineBasicMaterial | null = null;
  private leaderLines: THREE.Line[] = [];

  private ambient: THREE.AmbientLight | null = null;
  private directional: THREE.DirectionalLight | null = null;
  private rim: THREE.DirectionalLight | null = null;

  private scene: THREE.Scene | null = null;
  private rect: RectData = { top: 0, left: 0, width: 0, height: 0 };
  private lastProgress = 0;

  init(ctx: ViewContext): void {
    // Re-runnable: tear down any previous instance's resources first
    // (context-loss restore calls init again on the SAME SceneModule).
    this.dispose();

    this.scene = ctx.scene;
    this.rect = ctx.rect;

    const flavor = flavors.find((f) => f.id === DEFAULT_FLAVOR_ID) ?? flavors[0]!;
    // Real label texture (design-review F-002): without one, buildCan's
    // label band falls back to solid `flavor.accent` — for mint that's
    // #14574A, a near-black slab that swallowed the whole part against this
    // section's dark background. The printed label also simply makes more
    // sense in the section whose copy is literally about the label.
    const labelTexture = createLabelTexture(flavor);
    const built = buildCan(flavor, { labelTexture });
    const group = built.group;
    this.group = group;
    const disposeBuilt = built.dispose;
    this.canDispose = () => {
      disposeBuilt();
      labelTexture.dispose();
    };
    group.position.x = ctx.rect.width * ASSEMBLY_X_OFFSET_FACTOR;
    ctx.scene.add(group);

    for (const key of CAN_PART_KEYS) {
      this.registerPart(key, built.parts[key]);
    }

    this.leafGeometry = createLeafGeometry(LEAF_LENGTH, LEAF_WIDTH);
    for (const key of LEAF_KEYS) {
      const base = LEAF_BASE_LOCAL[key];
      const material = new THREE.MeshStandardMaterial({
        color: LEAF_COLORS[key],
        side: THREE.DoubleSide,
        roughness: 0.6,
      });
      this.leafMaterials.push(material);
      const mesh = new THREE.Mesh(this.leafGeometry, material);
      mesh.position.set(base.x, base.y, base.z);
      mesh.rotation.z = base.rotZ;
      group.add(mesh);
      this.registerPart(key, mesh);
    }

    // Lighting (design-review F-002): mint's label wraps most of the can in
    // #24765F, which is close in value to this section's forest background —
    // at the old ambient 0.5 / key 1.0-from-(1,1,1) the assembly read as a
    // black silhouette. Brighter key pulled toward the camera lights the
    // faces the viewer actually sees, and a cool rim from behind-left cuts
    // the silhouette off the background.
    this.ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.directional = new THREE.DirectionalLight(0xffffff, 1.5);
    this.directional.position.set(0.8, 1.2, 1.8);
    this.rim = new THREE.DirectionalLight(0xcfe8dd, 0.9);
    this.rim.position.set(-1.2, 0.4, -1.5);
    ctx.scene.add(this.ambient, this.directional, this.rim);

    this.leaderMaterial = new THREE.LineBasicMaterial({
      color: LEADER_LINE_COLOR,
      transparent: true,
      opacity: 0,
    });
    for (const key of ALL_PART_KEYS) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(9), 3) // 3 points x,y,z
      );
      const line = new THREE.Line(geometry, this.leaderMaterial);
      ctx.scene.add(line);
      this.leaderLines.push(line);
    }

    this.timeline = this.buildTimeline();
    this.lastProgress = 0;
    this.applyProgress(0);
  }

  private registerPart(key: PartKey, object: THREE.Object3D): void {
    this.tracked.set(key, {
      object,
      base: { y: object.position.y, rotX: object.rotation.x, rotZ: object.rotation.z },
      delta: { y: 0, rotX: 0, rotZ: 0 },
    });
  }

  private buildTimeline(): Timeline {
    const tl = new Timeline();
    for (const key of ALL_PART_KEYS) {
      const tracked = this.tracked.get(key);
      const target = EXPLODE_TARGETS[key];
      if (!tracked) continue;
      tl.add(tracked.delta, "y", [
        { t: EXPLODE_DEADZONE_START, v: 0 },
        { t: EXPLODE_DEADZONE_END, v: target.y, ease: easeInOutCubic },
      ]);
      tl.add(tracked.delta, "rotX", [
        { t: EXPLODE_DEADZONE_START, v: 0 },
        { t: EXPLODE_DEADZONE_END, v: target.rotX, ease: easeInOutCubic },
      ]);
      tl.add(tracked.delta, "rotZ", [
        { t: EXPLODE_DEADZONE_START, v: 0 },
        { t: EXPLODE_DEADZONE_END, v: target.rotZ, ease: easeInOutCubic },
      ]);
    }
    return tl;
  }

  update(_dt: number, ctx: ViewContext): void {
    this.rect = ctx.rect;
    this.scene = ctx.scene;
  }

  onProgress(p: number): void {
    this.applyProgress(p);
  }

  private applyProgress(p: number): void {
    if (!this.timeline || !this.group) return;
    this.timeline.sample(p);
    this.lastProgress = p;

    for (const tracked of this.tracked.values()) {
      tracked.object.position.y = tracked.base.y + tracked.delta.y;
      tracked.object.rotation.x = tracked.base.rotX + tracked.delta.rotX;
      tracked.object.rotation.z = tracked.base.rotZ + tracked.delta.rotZ;
    }

    this.group.updateMatrixWorld(true);
    this.updateLeaderLines(p);
  }

  private updateLeaderLines(p: number): void {
    if (this.leaderMaterial) {
      const fadeIn = smoothstep(
        mapRange(p, LEADER_LINE_FADE_IN_START, LEADER_LINE_FADE_IN_END, 0, 1, true)
      );
      this.leaderMaterial.opacity = LEADER_LINE_BASE_OPACITY * fadeIn;
    }

    const worldPos = new THREE.Vector3();
    ALL_PART_KEYS.forEach((key, i) => {
      const tracked = this.tracked.get(key);
      const line = this.leaderLines[i];
      if (!tracked || !line) return;

      tracked.object.getWorldPosition(worldPos);
      const anchor = this.anchorWorldPosition(key);
      const elbow = { x: anchor.x, y: worldPos.y, z: 0 };

      const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      attr.setXYZ(0, worldPos.x, worldPos.y, worldPos.z);
      attr.setXYZ(1, elbow.x, elbow.y, elbow.z);
      attr.setXYZ(2, anchor.x, anchor.y, anchor.z);
      attr.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    });
  }

  /** Normalized rect offset -> view-local world position (see file header convention). */
  private anchorWorldPosition(key: PartKey): { x: number; y: number; z: number } {
    const offset = ANCHOR_OFFSETS[key];
    return {
      x: (offset.x - 0.5) * this.rect.width,
      y: (0.5 - offset.y) * this.rect.height,
      z: 0,
    };
  }

  dispose(): void {
    for (const line of this.leaderLines) {
      line.parent?.remove(line);
      line.geometry.dispose();
    }
    this.leaderLines = [];
    this.leaderMaterial?.dispose();
    this.leaderMaterial = null;

    this.leafGeometry?.dispose();
    this.leafGeometry = null;
    for (const material of this.leafMaterials) material.dispose();
    this.leafMaterials = [];

    if (this.ambient) this.ambient.parent?.remove(this.ambient);
    if (this.directional) this.directional.parent?.remove(this.directional);
    if (this.rim) this.rim.parent?.remove(this.rim);
    this.ambient = null;
    this.directional = null;
    this.rim = null;

    if (this.group) this.group.parent?.remove(this.group);
    this.canDispose?.();
    this.canDispose = null;
    this.group = null;

    this.tracked.clear();
    this.timeline = null;
    this.lastProgress = 0;
  }
}

export function createExplodedScene(): SceneModule {
  return new ExplodedScene();
}

export default createExplodedScene;
