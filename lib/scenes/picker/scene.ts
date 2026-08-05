// lib/scenes/picker/scene.ts
//
// Section 6/6 (docs/deep-wave-engine-design.md §5 row 6): all 5 flavors as
// cans on a circular carousel, wired over `@/lib/scenes/hero-can` (can
// geometry/label) and `@/lib/engine/gl/text` (flavor-name headline). All
// actually-interesting behavior (carousel angle math, damped convergence,
// invoke dispatch, disposal bookkeeping) lives in ./carousel.ts and
// ./dispose-bag.ts, which have zero dependency on either contract and so are
// unit-tested independently of this file (test/scenes/picker.test.ts); this
// file is a thin GL-wiring layer over those two plus the can/text contracts.
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
/** Ambient/key light intensities — matches hero-can/scene.ts's rig so the
 * lit-material cans (buildCan) actually read instead of rendering as solid
 * black silhouettes (a confirmed design-review bug: this scene never lit
 * its cans at all). */
// Raised from 0.65/1.4 (design-review F-005): at those levels the standard-
// material cans read olive/brown — the label colors never reached their
// authored values against the bright flavor background.
const AMBIENT_INTENSITY = 0.95;
const KEY_LIGHT_INTENSITY = 1.8;
/** Fraction of the view's CSS width the carousel settles right-of-center
 * (composition fix — see `ringGroup`'s doc comment on the class below).
 * 0.3, not the design-review finding's literal 0.22, after visually
 * confirming 0.22 still let the selected (CENTER_SCALE-enlarged) can clip
 * the "Raspberry Yuzu" pill at 1440px. */
const RING_X_OFFSET_FACTOR = 0.3;
/** World-z the nameplate sits at — slightly toward the camera so it reads in
 * front of the carousel ring. */
const NAMEPLATE_Z = 40;
/**
 * How far down the visible half-height the nameplate is parked, as a fraction.
 *
 * This was a flat `y = -300`, then briefly `-0.6 * rect.height` — both wrong
 * for the same underlying reason: neither is the frustum. The engine sets
 * `camera.position.z = cameraDistanceForHeight(rect.height)` so that 1 world
 * unit == 1 CSS px *at z=0*; the frustum NARROWS toward the camera, so at
 * NAMEPLATE_Z the visible half-height is already less than `rect.height / 2`.
 * `0.6 * rect.height` is therefore outside the bottom edge on any view —
 * on a real 900px viewport it put the nameplate ~90px below the frustum,
 * i.e. invisible. Derive from the frustum at the nameplate's own depth
 * instead, and keep a margin inside it.
 */
const NAMEPLATE_MARGIN_FACTOR = 0.68;

/** Visible half-height (world units) at `z` for a perspective camera looking
 * down -Z from `camera.position.z`. */
function visibleHalfHeightAt(camera: THREE.PerspectiveCamera, z: number): number {
  const distance = Math.max(1, camera.position.z - z);
  return Math.tan((camera.fov * Math.PI) / 360) * distance;
}

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

/** Full-bleed size (plus position, which never moves — see `ringGroup`'s
 * comment for why the quad no longer needs to react to the carousel at
 * all) for the bg quad at `BG_QUAD_Z`. */
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
  /**
   * Holds only the cans and carries the carousel's rotation — kept as a
   * SEPARATE, off-center child of `root` (not `root` itself) for two
   * confirmed design-review bugs this fixes together:
   *
   *  1. "Picker background is a hard-edged wedge": the bg quad and lights
   *     used to be siblings of the cans directly under the one group that
   *     also carried the carousel's rotation, so THEY spun with it too —
   *     the full-bleed tint quad swept around like a wedge instead of
   *     staying a fixed backdrop. Now `root` (bgMesh/lights/text's parent)
   *     never rotates at all; only `ringGroup` does.
   *  2. "Carousel drifts off-center / cropped after selecting a flavor":
   *     each can's position used to bake in a `-CAROUSEL_RADIUS` z-offset
   *     directly, so the ring's own geometric center sat at
   *     `(0,0,-CAROUSEL_RADIUS)` while the ROTATION PIVOT was the origin —
   *     a point ON the ring's edge, not its center. Rotating around a
   *     point on a circle's own circumference doesn't just re-aim the
   *     circle, it swings the whole thing sideways. `ringGroup` puts that
   *     `-CAROUSEL_RADIUS` offset on the GROUP itself (so the pivot IS the
   *     ring's center) and each can's own local position is a plain
   *     `(sin θ · R, 0, cos θ · R)` — a true circle around `ringGroup`'s
   *     own origin, with no baked-in offset.
   */
  private ringGroup: THREE.Group | null = null;
  private bgMesh: THREE.Mesh | null = null;
  private bgMaterial: THREE.MeshBasicMaterial | null = null;
  private ambientLight: THREE.AmbientLight | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
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

    // Lights are added to `root` (never rotates, unlike `ringGroup`) so the
    // lit cans stay correctly shaded regardless of carousel rotation. A
    // confirmed design-review bug: this scene built lit
    // MeshStandardMaterial cans (buildCan) but never added any light at
    // all, so every can rendered as a solid black silhouette.
    this.ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    this.keyLight = new THREE.DirectionalLight(0xfff4e0, KEY_LIGHT_INTENSITY);
    this.keyLight.position.set(1.2, 1.6, 1.4);
    this.root.add(this.ambientLight, this.keyLight);

    const bgGeometry = new THREE.PlaneGeometry(1, 1);
    this.bgMaterial = new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false });
    this.bgMesh = new THREE.Mesh(bgGeometry, this.bgMaterial);
    this.bgMesh.renderOrder = -1;
    this.root.add(this.bgMesh);
    this.disposeBag.add(() => bgGeometry.dispose());
    this.disposeBag.add(() => this.bgMaterial?.dispose());

    // See this class's `ringGroup` doc comment for why the radius offset
    // lives on the group and each can's own local position is offset-free.
    // The x offset is a composition fix (confirmed design-review finding):
    // dead-center parking left the settled can competing with the DOM copy
    // column and, at narrow widths, cropped near the edge — nudging the
    // whole ring right of center gives the copy its own column and keeps
    // the selected can clear of the flavor-pill row above it.
    this.ringGroup = new THREE.Group();
    this.ringGroup.position.set(ctx.rect.width * RING_X_OFFSET_FACTOR, 0, -CAROUSEL_RADIUS);
    this.root.add(this.ringGroup);

    this.cans = flavors.map((flavor: Flavor, index: number) => {
      const label = createLabelTexture(flavor);
      const built = buildCan(flavor, { labelTexture: label });
      const theta = placementAngle(index, flavors.length);
      built.group.position.set(Math.sin(theta) * CAROUSEL_RADIUS, 0, Math.cos(theta) * CAROUSEL_RADIUS);
      this.ringGroup!.add(built.group);
      this.disposeBag.add(built.dispose);
      this.disposeBag.add(() => label.dispose());
      return { index, group: built.group };
    });

    // Not registered as a raycast target (design review item D): selection
    // flows entirely through the real DOM buttons + invoke("select", [i])
    // per design doc §5 row 6, so registering these groups would only cost
    // a real per-frame raycast against 5 targets for zero payoff today.
    // Re-register when hover-selection lands (see TODOS.md).

    this.applyFrame(ctx);

    return loadFont(ctx.assets)
      .then((font) => {
        const flavor = flavors[this.carousel.selectedIndex]!;
        this.flavorText = new GlText(font, {
          text: flavor.name,
          fontSize: FLAVOR_NAME_FONT_SIZE,
          align: "center",
        });
        this.lastTextedIndex = this.carousel.selectedIndex;
        // Child of `root` (never rotates), NOT `ringGroup` — the flavor
        // name must stay screen-facing regardless of carousel rotation.
        // Nameplate placement (design-review F-001): parked under the
        // carousel column (same x offset as ringGroup), below the settled
        // can's bottom rim (can height 480, center y=0 → bottom -240) —
        // it used to float at view center where it duplicated the DOM
        // flavor heading in the copy column. Positioned once here from
        // whatever ctx this init()/font-load happened to see (H3: if a
        // resize lands in between, this can be transiently stale — the
        // NEXT `applyFrame(ctx)` call, same as `ringGroup`'s own x, always
        // corrects it from the live ctx).
        this.flavorText.object3d.position.set(
          ctx.rect.width * RING_X_OFFSET_FACTOR,
          -visibleHalfHeightAt(ctx.camera, NAMEPLATE_Z) * NAMEPLATE_MARGIN_FACTOR,
          NAMEPLATE_Z
        );
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
    this.applyFrame(ctx);
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
    this.ringGroup = null;
    this.bgMesh = null;
    this.bgMaterial = null;
    this.ambientLight = null;
    this.keyLight = null;
    this.cans = [];
    this.flavorText = null;
    this.lastTextedIndex = -1;
  }

  /** Pushes the carousel's current (possibly just-damped) state onto the THREE scene graph. */
  private applyFrame(ctx?: ViewContext): void {
    if (!this.root || !this.ringGroup) return;
    this.ringGroup.rotation.y = this.carousel.angle;
    if (ctx) {
      this.ringGroup.position.x = ctx.rect.width * RING_X_OFFSET_FACTOR;
      // H3 fix: this used to only be set once, inside loadFont().then()'s
      // init-time ctx closure — so unlike ringGroup's own x (recomputed
      // from the live ctx every frame, right above), a resize after init
      // moved the ring but left the nameplate parked at its stale x/y,
      // breaking this comment's own promise ("same x offset as ringGroup").
      // Now tracked here every frame, same as the ring.
      if (this.flavorText) {
        this.flavorText.object3d.position.x = ctx.rect.width * RING_X_OFFSET_FACTOR;
        this.flavorText.object3d.position.y =
          -visibleHalfHeightAt(ctx.camera, NAMEPLATE_Z) * NAMEPLATE_MARGIN_FACTOR;
      }
    }
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
