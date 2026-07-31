// lib/scenes/picker/scene.ts
//
// Section 6/6 (docs/deep-wave-engine-design.md §5 row 6): all 5 flavors as
// cans on a circular carousel. Consumes the can contract verbatim (owner:
// hero-can agent) and the text contract verbatim (owner: text agent) — see
// this workstream's returned notes for the resulting mid-parallel friction:
// as of this writing neither `@/lib/scenes/hero-can/can-geometry` nor
// `@/lib/engine/gl/text` exist yet, so THIS file cannot be imported (by
// Vitest or by Next) until those workstreams land, exactly like the
// tsc/"other workstreams' not-yet-landed files" caveat this task was briefed
// with — just the runtime-import version of it rather than the type-check
// version. All actually-interesting behavior (carousel angle math, damped
// convergence, invoke dispatch, disposal bookkeeping) therefore lives in
// ./carousel.ts and ./dispose-bag.ts, which have zero dependency on either
// contract and so ARE fully unit-tested today (test/scenes/picker.test.ts).
// This file is deliberately a thin GL-wiring layer over those two: once the
// sibling workstreams land, integration should need no changes here beyond
// resolving imports.
//
// Default export is a FACTORY (`() => SceneModule`), matching
// lib/scenes/placeholder/scene.ts's convention — scene-registry.ts calls it
// once per view.

import * as THREE from "three";
import type { SceneModule, ViewContext } from "@/lib/engine/types";
import { flavors, type Flavor } from "@/lib/flavors";
import { buildCan } from "@/lib/scenes/hero-can/can-geometry";
import { createLabelTexture } from "@/lib/scenes/hero-can/label-texture";
import { loadFont, GlText } from "@/lib/engine/gl/text";
import { placementAngle, PickerCarousel } from "./carousel";
import { DisposeBag } from "./dispose-bag";

/** World-unit radius of the can carousel (1 unit = 1 CSS px at z=0, per gl/view.ts). */
const CAROUSEL_RADIUS = 220;
/** Depth (world z) of the fullscreen background-tint quad, behind every can. */
const BG_QUAD_Z = -260;
const FLAVOR_NAME_FONT_SIZE = 36;

interface CanEntry {
  index: number;
  group: THREE.Group;
}

/** Frustum height (world units) at `targetZ` for a camera at `camZ` with vertical FOV `fovDeg`. */
function frustumHeightAtZ(camZ: number, fovDeg: number, targetZ: number): number {
  const fovRad = (fovDeg * Math.PI) / 180;
  const distance = Math.max(camZ - targetZ, 1e-6);
  return 2 * distance * Math.tan(fovRad / 2);
}

function sizeAndPositionBgQuad(mesh: THREE.Mesh, camera: THREE.PerspectiveCamera): void {
  const height = frustumHeightAtZ(camera.position.z, camera.fov, BG_QUAD_Z);
  const width = height * camera.aspect;
  mesh.scale.set(width, height, 1);
  mesh.position.z = BG_QUAD_Z;
}

class PickerScene implements SceneModule {
  private carousel = new PickerCarousel(flavors.map((f) => f.bg));
  private disposeBag = new DisposeBag();
  private root: THREE.Group | null = null;
  private bgMesh: THREE.Mesh | null = null;
  private bgMaterial: THREE.MeshBasicMaterial | null = null;
  private cans: CanEntry[] = [];
  private flavorText: GlText | null = null;
  private lastTextedIndex = -1;

  init(ctx: ViewContext): void | Promise<void> {
    // Re-runnable, per SceneModule's contract (context-loss restore): tear
    // down anything a previous init built before rebuilding.
    this.dispose();
    this.disposeBag = new DisposeBag();

    this.root = new THREE.Group();
    ctx.scene.add(this.root);

    const bgGeometry = new THREE.PlaneGeometry(1, 1);
    this.bgMaterial = new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false });
    this.bgMesh = new THREE.Mesh(bgGeometry, this.bgMaterial);
    this.bgMesh.renderOrder = -1;
    this.root.add(this.bgMesh);
    this.disposeBag.add(() => bgGeometry.dispose());
    this.disposeBag.add(() => this.bgMaterial?.dispose());

    this.cans = flavors.map((flavor: Flavor, index: number) => {
      const label = createLabelTexture(flavor);
      const built = buildCan(flavor, { labelTexture: label });
      const theta = placementAngle(index, flavors.length);
      built.group.position.set(
        Math.sin(theta) * CAROUSEL_RADIUS,
        0,
        Math.cos(theta) * CAROUSEL_RADIUS - CAROUSEL_RADIUS
      );
      this.root!.add(built.group);
      this.disposeBag.add(built.dispose);
      this.disposeBag.add(() => label.dispose());
      return { index, group: built.group };
    });

    this.applyFrame();

    return loadFont(ctx.assets)
      .then((font) => {
        const flavor = flavors[this.carousel.selectedIndex]!;
        this.flavorText = new GlText(font, {
          text: flavor.name,
          fontSize: FLAVOR_NAME_FONT_SIZE,
          align: "center",
        });
        this.lastTextedIndex = this.carousel.selectedIndex;
        this.flavorText.object3d.position.set(0, -160, 40);
        this.root?.add(this.flavorText.object3d);
        this.disposeBag.add(() => this.flavorText?.dispose());
      })
      .catch(() => {
        // Decorative only: SectionPicker's real DOM heading/tagline already
        // name the flavor per §6's a11y rule, so a font-load failure must
        // not break the carousel itself.
      });
  }

  update(dt: number, ctx: ViewContext): void {
    if (!this.root) return;

    if (!ctx.reducedMotion) {
      this.carousel.step(dt);
    }
    this.applyFrame();
    sizeAndPositionBgQuad(this.bgMesh!, ctx.camera);

    if (this.flavorText && this.lastTextedIndex !== this.carousel.selectedIndex) {
      this.lastTextedIndex = this.carousel.selectedIndex;
      this.flavorText.setText(flavors[this.carousel.selectedIndex]!.name);
    }
  }

  invoke(method: string, args: unknown[]): void {
    this.carousel.invoke(method, args);
  }

  dispose(): void {
    this.disposeBag.disposeAll();
    this.root?.parent?.remove(this.root);
    this.root = null;
    this.bgMesh = null;
    this.bgMaterial = null;
    this.cans = [];
    this.flavorText = null;
    this.lastTextedIndex = -1;
  }

  /** Pushes the carousel's current (possibly just-damped) state onto the THREE scene graph. */
  private applyFrame(): void {
    if (!this.root) return;
    this.root.rotation.y = this.carousel.angle;
    for (const can of this.cans) {
      can.group.scale.setScalar(this.carousel.scaleFor(can.index));
    }
    if (this.bgMaterial) {
      const { r, g, b } = this.carousel.bg;
      this.bgMaterial.color.setRGB(r, g, b);
    }
  }
}

export function createPickerScene(): SceneModule {
  return new PickerScene();
}

export default createPickerScene;
