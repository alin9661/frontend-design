import * as THREE from "three";
import type { PointerHit, QualityTier, SceneModule, ViewContext } from "@/lib/engine/types";
import { computeProgress } from "@/lib/engine/gl/view";
import { flavorById } from "@/lib/flavors";
import { glPalette } from "@/lib/palette";
import { buildCan, type BuiltCan } from "@/lib/scenes/hero-can/can-geometry";
import { createDragInspector, type DragInspector } from "@/lib/visuals/drag-inspect";
import {
  isActive,
  originChapters,
  originPoseForProgress,
  type Origin3DPose,
} from "@/lib/visuals/origin-timeline";
import { PollenField } from "./pollen";
import {
  buildBasket,
  buildBrew,
  buildCarton,
  buildHand,
  buildLeaves,
  buildMachine,
  buildShelf,
  type BuiltShelf,
} from "./rig";
import { loadOriginAssets, type OriginAssets } from "./gltf";

const MINT = flavorById("mint");

/** Gap between adjacent shelf cans, matching `lib/visuals/shelf-to-showcase`'s
 * `defaultHandoffGeometry.shelfSpacing` so the GL row and the DOM row that
 * hands over to it describe the same arrangement. */
export const SHELF_CAN_SPACING = 105;

/**
 * X of shelf can `index` in a row of `count`, centred on the origin.
 *
 * Shared by `init()`'s seeding and `renderShelf()`'s per-frame layout: they
 * used to carry two different formulas — one count-independent (`(index - 2)`,
 * correct only for a 5-can row) — and only agreed because update() overwrote
 * init() on the very next frame.
 */
export function shelfCanX(index: number, count: number): number {
  return (index - (count - 1) / 2) * SHELF_CAN_SPACING;
}

/**
 * Which shelf can lifts and tilts off the row on the STOCK beat: the centre
 * one, whatever the row's length.
 *
 * Hardcoding index 2 is correct for the 5-can medium/high rows and WRONG for
 * the low tier's 3-can row, where it is the right-hand can — so a low-tier
 * device lifted a can well off-centre from the hero can fading in at x = 0.
 * `Math.floor` rather than round: for an even count either middle can is
 * defensible, and the left one keeps this deterministic.
 */
export function heroShelfIndex(count: number): number {
  return Math.floor((count - 1) / 2);
}

const QUALITY_COUNTS: Record<QualityTier, { leaves: number; shelfCans: number }> = {
  low: { leaves: 14, shelfCans: 3 },
  medium: { leaves: 22, shelfCans: 5 },
  high: { leaves: 30, shelfCans: 5 },
};

/**
 * The film's motion ledger: ONE dominant system per chapter. The leaves are
 * the continuous substrate — they are on screen for the whole film, so they
 * are not a beat and do not spend a chapter's budget:
 *
 *   01 GROW    -> pollen field   (the only additive system in this chapter)
 *   02 COLLECT -> basket
 *   03 MAKE    -> machine
 *   04 CAN     -> brew + hero can
 *   05 SHIP    -> carton
 *   06 STOCK   -> shelf
 *   07 GRAB    -> hand
 *
 * So the pollen lives and dies inside chapter 01's band rather than hanging
 * around behind the machine and the carton. Drag-to-inspect rides chapter 04
 * WITHOUT spending its budget: it is an input affordance that only moves when
 * the visitor moves it, not an autonomous system competing for attention.
 */
const POLLEN_CHAPTER = 0;
const INSPECT_CHAPTER = 3;

/** Below this the pollen group is hidden outright rather than drawn at ~0. */
const POLLEN_VISIBILITY_EPSILON = 0.005;

/**
 * Spring-back rate (1/s) for the inspected can. Deliberately non-zero (the
 * inspector's own default is 0, "park wherever inertia left it"): the film
 * scripts the can's rotation in every other chapter, so a released inspection
 * has to ease back onto the scripted pose instead of dragging an off-script
 * offset through SHIP, STOCK and GRAB.
 */
const INSPECT_RETURN_SPRING = 1.6;

const NO_INSPECT_OFFSET = { yaw: 0, pitch: 0 } as const;

/**
 * 0..1 across one chapter's own band. Chapter-local rather than film-global
 * because that is the clock `pollenOpacityForProgress` expects, and because
 * reading it off `originChapters` means a chapter-weight retune moves the
 * pollen with its chapter instead of stranding it.
 */
function chapterLocalProgress(index: number, progress: number): number {
  const band = originChapters[index]!.band;
  const span = Math.max(band.out - band.in, Number.EPSILON);
  return Math.min(1, Math.max(0, (progress - band.in) / span));
}

function setCanOpacity(built: BuiltCan, opacity: number): void {
  built.group.visible = opacity > 0.005;

  for (const mesh of Object.values(built.parts)) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.transparent = opacity < 0.995;
    material.opacity = opacity;
    material.depthWrite = opacity > 0.5;
  }
}

function setMaterialOpacity(material: THREE.Material | THREE.Material[], opacity: number): void {
  for (const item of Array.isArray(material) ? material : [material]) {
    item.transparent = opacity < 0.995;
    item.opacity = opacity;
  }
}

/** Dispose a plain builder-owned object graph, de-duplicating shared resources. */
function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    if (material instanceof THREE.ShaderMaterial) {
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
      }
    }
  }

  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  root.clear();
}

function disposeLoadedAssets(assets: OriginAssets): void {
  const roots = new Set(
    [assets.hand, assets.machine].filter((root): root is THREE.Object3D => root !== null),
  );
  for (const root of roots) {
    root.removeFromParent();
    disposeObject(root);
  }
}

function replaceProceduralObject(
  world: THREE.Group,
  procedural: THREE.Object3D,
  loaded: THREE.Object3D,
): THREE.Object3D {
  loaded.position.copy(procedural.position);
  loaded.rotation.copy(procedural.rotation);
  loaded.scale.copy(procedural.scale);
  loaded.visible = procedural.visible;
  loaded.name = procedural.name;

  world.remove(procedural);
  disposeObject(procedural);
  world.add(loaded);
  return loaded;
}

class OriginFilmScene implements SceneModule {
  private root: THREE.Group | null = null;
  private world: THREE.Group | null = null;
  private leaves: THREE.InstancedMesh | null = null;
  private brew: THREE.Mesh | null = null;
  private brewMaterial: THREE.ShaderMaterial | null = null;
  private basket: THREE.Mesh | null = null;
  private machine: THREE.Object3D | null = null;
  private carton: THREE.Group | null = null;
  private hand: THREE.Object3D | null = null;
  private can: BuiltCan | null = null;
  private shelf: BuiltShelf | null = null;
  private pollen: PollenField | null = null;
  /**
   * Pure state machine — no listeners, timers or GPU resources — so dropping
   * the reference in dispose() is its entire teardown. Rebuilt by init()
   * because `reducedMotion` is baked in at construction.
   */
  private inspector: DragInspector | null = null;
  private inspectDragging = false;
  /**
   * The per-view camera outlives this module (View owns it; init() is
   * re-runnable for context-loss restore) and update() writes an ABSOLUTE
   * pose into it, so the base has to be captured and handed back on dispose —
   * same contract the hero-can scene follows for its camera pull.
   */
  private camera: THREE.Camera | null = null;
  private readonly baseCameraPosition = new THREE.Vector3();
  private readonly baseCameraQuaternion = new THREE.Quaternion();

  private width = 1;
  private height = 1;
  private quality: QualityTier = "high";
  private compactRig = false;
  private progress = 0;
  private elapsed = 0;
  private pointerHit: { x: number; y: number } | null = null;
  private pointerEventPending = false;
  private generation = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();

  init(ctx: ViewContext): void {
    this.dispose();
    const generation = ++this.generation;

    const counts = QUALITY_COUNTS[ctx.quality];
    this.width = Math.max(1, ctx.size.width);
    this.height = Math.max(1, ctx.size.height);
    this.quality = ctx.quality;
    this.compactRig = ctx.quality === "low" || ctx.size.width < 768;
    this.elapsed = 0;
    this.pointerHit = null;
    this.pointerEventPending = false;
    this.inspectDragging = false;
    this.progress = computeProgress(ctx.rect, ctx.scroll.current, ctx.size.height);

    // Captured AFTER dispose() above has already handed any previous pose
    // back, so a context-loss reinit records the true base rather than the
    // film pose the last run left behind.
    this.camera = ctx.camera;
    this.baseCameraPosition.copy(ctx.camera.position);
    this.baseCameraQuaternion.copy(ctx.camera.quaternion);

    this.root = new THREE.Group();
    this.root.name = "origin-film-root";
    this.world = new THREE.Group();
    this.world.name = "origin-film-world";
    this.root.add(this.world);

    this.leaves = buildLeaves(counts.leaves);
    this.world.add(this.leaves);

    const brew = buildBrew();
    this.brew = brew.mesh;
    this.brewMaterial = brew.material;
    this.world.add(this.brew);

    this.basket = buildBasket();
    this.machine = buildMachine({ simplified: this.compactRig });
    this.carton = buildCarton();
    this.hand = buildHand({ silhouette: this.compactRig });
    this.world.add(this.basket, this.machine, this.carton, this.hand);

    this.can = buildCan(MINT);
    this.can.group.name = "origin-film-hero-can";
    this.can.group.position.z = 75;
    this.world.add(this.can.group);
    setCanOpacity(this.can, 0);

    this.shelf = buildShelf(counts.shelfCans);
    this.world.add(this.shelf.group);
    this.shelf.setOpacity(0);

    // `floatSupport` is optional on ViewContext: `undefined` means nobody
    // probed the context, and ViewContext's own contract says to read that as
    // "none" and take the CPU path. Guessing "float" is what produces a
    // silently black GPGPU field, so the fallback is never widened here.
    this.pollen = new PollenField({
      support: ctx.floatSupport ?? "none",
      quality: ctx.quality,
      reducedMotion: ctx.reducedMotion,
    });
    this.world.add(this.pollen.object3d);

    this.inspector = createDragInspector({
      reducedMotion: ctx.reducedMotion,
      returnSpring: INSPECT_RETURN_SPRING,
    });

    const key = new THREE.DirectionalLight(glPalette.keyWarm, 3.5);
    key.position.set(-300, 420, 500);
    const rim = new THREE.PointLight(glPalette.amber, 950, 1200, 2);
    rim.position.set(260, 80, 260);
    this.root.add(
      new THREE.HemisphereLight(glPalette.skyWarm, glPalette.forestDeep, 1.7),
      key,
      rim,
    );

    ctx.scene.add(this.root);
    // Seed a pose immediately so the first draw never exposes the builders'
    // hidden/zero-opacity setup state. Reduced-motion hosts keep calling
    // Stage.update() with dt = 0, so scroll poses advance without idle motion.
    this.update(0, ctx);

    // Fire-and-forget: the film renders the procedural rig from this frame on,
    // and the optional GLB swaps in whenever it lands. `generation` was
    // captured after dispose() bumped it, so a result from a previous init (or
    // one that arrives after this scene is torn down) is recognised as stale
    // and freed instead of attached to a dead graph.
    if (!this.compactRig) {
      const world = this.world;
      void loadOriginAssets()
        .then((assets) => {
          if (this.generation !== generation || this.world !== world) {
            disposeLoadedAssets(assets);
            return;
          }

          if (assets.hand && this.hand) {
            this.hand = replaceProceduralObject(world, this.hand, assets.hand);
          }
          if (assets.machine && this.machine) {
            this.machine = replaceProceduralObject(world, this.machine, assets.machine);
          }
        })
        // loadOriginAssets never rejects, so this only catches a throw from the
        // swap itself. Inside a worker an unhandled rejection can take the whole
        // render loop down, and losing the film to a failed cosmetic upgrade
        // would be a strictly worse outcome than keeping the procedural rig.
        .catch((error: unknown) => {
          console.warn(`[origin-film] asset swap failed: ${String(error)}`);
        });
    }
  }

  onProgress(progress: number): void {
    this.progress = progress;
  }

  onPointer(hit: PointerHit | null): void {
    this.pointerHit = hit ? { x: hit.x, y: hit.y } : null;
    this.pointerEventPending = true;
  }

  update(dt: number, ctx: ViewContext): void {
    if (
      !this.world ||
      !this.leaves ||
      !this.brew ||
      !this.brewMaterial ||
      !this.basket ||
      !this.machine ||
      !this.carton ||
      !this.hand ||
      !this.can ||
      !this.shelf
    ) {
      return;
    }

    this.width = Math.max(1, ctx.size.width);
    this.height = Math.max(1, ctx.size.height);

    // Scroll IS the film: the pose stays scroll-driven under reduced motion.
    // What stops is the ambient stuff nobody asked for — the elapsed-time
    // spins/flutter and the pointer parallax (§6 a11y), same split the
    // hero-can scene makes between its scroll pull and its idle spin/tilt.
    const animate = !ctx.reducedMotion;
    if (animate) this.elapsed += dt;

    const pose = originPoseForProgress(this.progress);
    // Raycast onPointer callbacks are transition-only in the engine. Use a
    // fresh hit for this frame, then resume the continuously sampled shared
    // pointer so parallax does not freeze at the hover-entry coordinate.
    const hadPointerEvent = this.pointerEventPending;
    const sourcePointer = !animate
      ? { x: 0, y: 0 }
      : hadPointerEvent
        ? (this.pointerHit ?? { x: 0, y: 0 })
        : ctx.pointer.inside
          ? ctx.pointer
          : { x: 0, y: 0 };
    this.pointerEventPending = false;
    // The same two sources, but WITHOUT the reduced-motion blanking above:
    // inspection is something the visitor does with their own hand, not
    // ambient motion, so it stays live in that branch. The inspector drops
    // its inertia and spring-back on its own when reducedMotion is set.
    const dragPointer =
      hadPointerEvent && this.pointerHit
        ? this.pointerHit
        : ctx.pointer.inside
          ? { x: ctx.pointer.x, y: ctx.pointer.y }
          : null;
    const inspect = this.updateInspection(dt, ctx, dragPointer);
    // The legacy listener produced -0.5..0.5 and positive-down Y. Engine
    // pointer coordinates are -1..1 and positive-up, so preserve the old
    // visual amplitude and direction when adapting them.
    const pointerX = sourcePointer.x * 0.5;
    const pointerY = -sourcePointer.y * 0.5;

    ctx.camera.position.set(0, pose.cameraY, pose.cameraZ);
    ctx.camera.lookAt(0, -20, 0);

    this.renderLeaves(pose);
    this.renderBasket(pose);
    this.renderMachine(pose);
    this.renderBrew(pose);
    this.renderCan(pose, pointerX, pointerY, inspect);
    this.renderCarton(pose);
    this.renderShelf(pose, pointerX);
    this.renderHand(pose);
    this.updatePollen(dt, ctx);

    this.world.rotation.x += (pointerY * 0.045 - this.world.rotation.x) * 0.055;
    this.world.rotation.y += (pointerX * 0.055 - this.world.rotation.y) * 0.055;
  }

  dispose(): void {
    this.generation += 1;

    // Hand the view's camera back unposed — see the `camera` field note.
    if (this.camera) {
      this.camera.position.copy(this.baseCameraPosition);
      this.camera.quaternion.copy(this.baseCameraQuaternion);
      this.camera = null;
    }

    this.root?.parent?.remove(this.root);

    this.can?.dispose();
    this.shelf?.dispose();

    if (this.leaves) {
      this.leaves.geometry.dispose();
      for (const material of Array.isArray(this.leaves.material)
        ? this.leaves.material
        : [this.leaves.material]) {
        material.dispose();
      }
      this.leaves.dispose();
      this.leaves.clear();
    }
    if (this.brew) disposeObject(this.brew);
    if (this.basket) disposeObject(this.basket);
    if (this.machine) disposeObject(this.machine);
    if (this.carton) disposeObject(this.carton);
    if (this.hand) disposeObject(this.hand);

    if (this.pollen) {
      // Contract order: detach BEFORE dispose(), which empties the field's own
      // group. The field frees its render targets, materials, seed texture and
      // geometry from there, so this is the only pollen teardown call.
      this.pollen.object3d.removeFromParent();
      this.pollen.dispose();
      this.pollen = null;
    }
    this.inspector = null;
    this.inspectDragging = false;

    this.root?.clear();
    this.world?.clear();
    this.root = null;
    this.world = null;
    this.leaves = null;
    this.brew = null;
    this.brewMaterial = null;
    this.basket = null;
    this.machine = null;
    this.carton = null;
    this.hand = null;
    this.can = null;
    this.shelf = null;
    this.pointerHit = null;
    this.pointerEventPending = false;
  }

  /** Leaves start scattered, then spiral into the basket as collection rises. */
  private renderLeaves(pose: Origin3DPose): void {
    const spreadX = Math.max(this.width * 0.52, 360);
    const spreadY = Math.max(this.height * 0.72, 520);

    for (let index = 0; index < this.leaves!.count; index += 1) {
      const seed = index * 12.9898;
      const spiral = (pose.collection * Math.PI * 2 * (index % 6)) / 6;
      const homeX = (Math.sin(seed) * 0.5 + 0.5) * spreadX - spreadX / 2;
      const homeY = (Math.sin(seed * 2.17) * 0.5 + 0.5) * spreadY - spreadY / 2;
      const x = homeX + Math.cos(spiral) * pose.collection * 120;
      const y =
        homeY -
        pose.leafTravel * (0.45 + (index % 5) * 0.12) +
        pose.collection * (40 - homeY * 0.72);

      this.position.set(x, y, -220 + (index % 7) * 66);
      this.euler.set(
        Math.sin(seed + this.elapsed * 0.3) * 0.45,
        pose.worldRotation + seed + spiral,
        Math.cos(seed + this.elapsed * 0.22) * 0.7,
      );
      this.quaternion.setFromEuler(this.euler);
      this.scale.setScalar(0.32 + (index % 5) * 0.11);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.leaves!.setMatrixAt(index, this.matrix);
    }

    this.leaves!.instanceMatrix.needsUpdate = true;
  }

  private renderBasket(pose: Origin3DPose): void {
    this.basket!.visible = pose.collection > 0.005;
    setMaterialOpacity(this.basket!.material, pose.collection);
    this.basket!.rotation.y = this.elapsed * 1.4;
    this.basket!.position.y = -80 + pose.collection * 45;
  }

  private renderMachine(pose: Origin3DPose): void {
    this.machine!.visible = pose.manufacturing > 0.005;
    this.machine!.traverse((object) => {
      if (object instanceof THREE.Mesh) setMaterialOpacity(object.material, pose.manufacturing);
    });
    this.machine!.rotation.y = this.elapsed * 0.5;
  }

  private renderBrew(pose: Origin3DPose): void {
    this.brewMaterial!.uniforms.uTime!.value = this.elapsed;
    this.brewMaterial!.uniforms.uOpacity!.value = pose.brewOpacity;
    this.brewMaterial!.uniforms.uFill!.value = pose.fill;
    this.brew!.visible = pose.brewOpacity > 0.005;
  }

  private renderCan(
    pose: Origin3DPose,
    pointerX: number,
    pointerY: number,
    inspect: { yaw: number; pitch: number },
  ): void {
    setCanOpacity(this.can!, pose.canOpacity * (1 - pose.shelf * 0.88));
    this.can!.group.position.set(this.width >= 768 ? this.width * 0.18 : 0, pose.canY, 75);
    this.can!.group.scale.setScalar(pose.canScale);
    // The inspection offset is ADDED to the scripted pose rather than
    // replacing it: the film keeps authoring the can, the visitor pushes it
    // off that pose, and the spring in updateInspection() brings it back.
    // Both signs already match the rig (pointer down => rotation.x positive).
    this.can!.group.rotation.set(
      pointerY * 0.1 + inspect.pitch,
      this.elapsed * 0.12 + pointerX * 0.16 + inspect.yaw,
      -0.06 + pointerX * 0.05,
    );
  }

  /**
   * Drives the drag-to-inspect machine and returns the rotation offset for the
   * hero can. Inspection is only LIVE while the CAN chapter is active — the
   * film scripts the can everywhere else — and any leftover offset is carried
   * home by the spring rather than snapped away.
   */
  private updateInspection(
    dt: number,
    ctx: ViewContext,
    pointer: { x: number; y: number } | null,
  ): { yaw: number; pitch: number } {
    const inspector = this.inspector;
    if (!inspector) return NO_INSPECT_OFFSET;

    const live = isActive(INSPECT_CHAPTER, this.progress);
    const holding = live && pointer !== null && ctx.pointer.down;

    if (holding) {
      // Engine pointer coordinates are -1..1 and positive-UP; the inspector
      // wants screen pixels with y growing DOWN, so the vertical axis flips.
      const x = pointer.x * this.width * 0.5;
      const y = -pointer.y * this.height * 0.5;

      if (this.inspectDragging) {
        inspector.onPointerMove(x, y);
      } else {
        inspector.onPointerDown(x, y);
        this.inspectDragging = true;
      }
    } else if (this.inspectDragging) {
      // A gesture that scrolls out of the chapter is CANCELLED, not released:
      // it must not fling the can on its way off-script.
      if (live) inspector.onPointerUp();
      else inspector.onPointerCancel();
      this.inspectDragging = false;
    }

    inspector.update(dt);
    const state = inspector.state;

    // Reduced motion disables the inspector's spring-back too, so the offset
    // would otherwise ride out of the chapter and fight every later beat.
    // Snap it home instead — a snap is what "no animation" looks like.
    if (!live && ctx.reducedMotion && (state.yaw !== 0 || state.pitch !== 0)) {
      inspector.reset();
      return NO_INSPECT_OFFSET;
    }

    return { yaw: state.yaw, pitch: state.pitch };
  }

  /**
   * Pollen is chapter 01's dominant system (see the motion ledger), so it runs
   * on that chapter's OWN clock: `PollenField` fades it up from nothing and
   * back to nothing across the 0..1 it is handed, which is what stops it
   * bleeding into chapter 02's basket beat.
   */
  private updatePollen(dt: number, ctx: ViewContext): void {
    const pollen = this.pollen;
    if (!pollen) return;

    pollen.update(dt, {
      // Optional on ViewContext. `undefined` means this host lent no
      // render-to-texture seam: the GPU path then holds its seeded pose and
      // the CPU path keeps drifting. Neither throws.
      renderer: ctx.renderer ?? null,
      progress: chapterLocalProgress(POLLEN_CHAPTER, this.progress),
      pointer: ctx.pointer.inside ? { x: ctx.pointer.x, y: ctx.pointer.y } : { x: 0, y: 0 },
      scrollVelocity: ctx.scroll.velocity,
    });

    pollen.object3d.visible = pollen.opacity > POLLEN_VISIBILITY_EPSILON;
  }

  private renderCarton(pose: Origin3DPose): void {
    this.carton!.visible = pose.pack + pose.ship > 0.005;
    this.carton!.rotation.y = pose.ship * this.elapsed * 1.8;
    this.carton!.position.z = -30 - pose.ship * 650;
    this.carton!.scale.setScalar(0.7 + pose.pack * 0.3);
  }

  private renderShelf(pose: Origin3DPose, pointerX: number): void {
    const shelf = this.shelf!;
    const shelfCount = shelf.count;
    const hero = heroShelfIndex(shelfCount);
    shelf.setOpacity(pose.shelf);

    for (let index = 0; index < shelfCount; index += 1) {
      this.position.set(shelfCanX(index, shelfCount), -150, 55);
      this.euler.set(0, pointerX * 0.12, 0);

      if (index === hero) {
        this.euler.z = -pose.shelf * 0.08;
        this.position.y += pose.shelf * 24;
      }
      this.quaternion.setFromEuler(this.euler);
      this.scale.setScalar(0.5);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      shelf.setMatrixAt(index, this.matrix);
    }
  }

  private renderHand(pose: Origin3DPose): void {
    this.hand!.visible = pose.grip > 0.005;
    this.hand!.position.set(
      this.width >= 768 ? this.width * 0.18 : 0,
      -220 + pose.grip * 170,
      340 - pose.grip * 330,
    );
    this.hand!.rotation.set(-pose.grip * 0.75, 0, pose.grip * 0.1);
    this.hand!.scale.setScalar(this.compactRig ? 0.75 : 1);
  }
}

export function createOriginFilmScene(): SceneModule {
  return new OriginFilmScene();
}

export default createOriginFilmScene;
