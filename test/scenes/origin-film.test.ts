import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { QualityTier, ViewContext } from "@/lib/engine/types";
import { loadScene, sceneRegistry } from "@/lib/engine/worker/scene-registry";
import { glPalette } from "@/lib/palette";
import {
  buildBasket,
  buildBrew,
  buildCarton,
  buildHand,
  buildLeaves,
  buildMachine,
  buildShelf,
} from "@/lib/scenes/origin-film/rig";
import {
  POLLEN_CPU_COUNT,
  POLLEN_MAX_OPACITY,
  POLLEN_SIM_SIZE,
} from "@/lib/scenes/origin-film/pollen";
import createOriginFilmScene, {
  heroShelfIndex,
  shelfCanX,
  SHELF_CAN_SPACING,
} from "@/lib/scenes/origin-film/scene";
import { isActive, originChapters, originPoseForProgress } from "@/lib/visuals/origin-timeline";

function makeCtx(overrides: Partial<ViewContext> = {}): ViewContext {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 10000),
    rect: { top: 0, left: 0, width: 800, height: 600 },
    scroll: { target: 0, current: 0, velocity: 0, progress: 0, limit: 1000 },
    pointer: { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: true },
    assets: {
      add: () => {},
      get: () => {
        throw new Error("not needed in this test");
      },
      start: async () => {},
      onProgress: () => () => {},
    },
    size: { width: 800, height: 600, dpr: 1 },
    quality: "high",
    reducedMotion: false,
    ...overrides,
  };
}

function originRoot(ctx: ViewContext): THREE.Group {
  return ctx.scene.getObjectByName("origin-film-root") as THREE.Group;
}

function world(ctx: ViewContext): THREE.Group {
  return ctx.scene.getObjectByName("origin-film-world") as THREE.Group;
}

function heroCan(ctx: ViewContext): THREE.Group {
  return ctx.scene.getObjectByName("origin-film-hero-can") as THREE.Group;
}

function pollenGroup(ctx: ViewContext): THREE.Group {
  return ctx.scene.getObjectByName("origin-film-pollen") as THREE.Group;
}

function pollenMotes(ctx: ViewContext): THREE.InstancedMesh {
  return ctx.scene.getObjectByName("origin-film-pollen-motes") as THREE.InstancedMesh;
}

function pollenPoints(ctx: ViewContext): THREE.Points {
  return ctx.scene.getObjectByName("origin-film-pollen-points") as THREE.Points;
}

function instancePose(mesh: THREE.InstancedMesh): Float32Array {
  return Float32Array.from(mesh.instanceMatrix.array);
}

function maxAbsDelta(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  return worst;
}

function disposeMesh(mesh: THREE.Mesh | THREE.InstancedMesh): void {
  mesh.geometry.dispose();
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    material.dispose();
  }
  if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
}

function disposeGroup(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

describe("lib/scenes/origin-film/rig", () => {
  it("buildLeaves creates the requested number of dynamic palette-colored instances", () => {
    const leaves = buildLeaves(7);

    expect(leaves.count).toBe(7);
    expect(leaves.instanceMatrix.usage).toBe(THREE.DynamicDrawUsage);
    expect(leaves.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect((leaves.material as THREE.MeshStandardMaterial).color.getHex()).toBe(glPalette.leaf);

    disposeMesh(leaves);
  });

  it("buildBrew returns the open liquid mesh and its writable shader uniforms", () => {
    const { mesh, material } = buildBrew();
    const geometry = mesh.geometry as THREE.CylinderGeometry;

    expect(mesh.position.toArray()).toEqual([0, -20, -55]);
    expect(geometry.parameters.openEnded).toBe(true);
    expect(material.uniforms.uTime!.value).toBe(0);
    expect(material.uniforms.uOpacity!.value).toBe(0);
    expect(material.uniforms.uFill!.value).toBe(0);

    disposeMesh(mesh);
  });

  it("buildBasket preserves the tapered open cylinder and amber material", () => {
    const basket = buildBasket();
    const geometry = basket.geometry as THREE.CylinderGeometry;
    const material = basket.material as THREE.MeshStandardMaterial;

    expect(geometry.parameters.radiusTop).toBe(100);
    expect(geometry.parameters.radiusBottom).toBe(78);
    expect(geometry.parameters.openEnded).toBe(true);
    expect(material.color.getHex()).toBe(glPalette.amber);

    disposeMesh(basket);
  });

  it("buildMachine assembles five rollers and one raised drying drum", () => {
    const machine = buildMachine();

    expect(machine.children).toHaveLength(6);
    expect(machine.children.slice(0, 5).map((child) => child.position.x)).toEqual([
      -144,
      -72,
      0,
      72,
      144,
    ]);
    expect(machine.children[5]!.position.toArray()).toEqual([0, 125, -20]);
    expect(machine.position.toArray()).toEqual([0, 0, -80]);

    disposeGroup(machine);
  });

  it("buildCarton assembles its box, two open flaps, and tape", () => {
    const carton = buildCarton();

    expect(carton.children).toHaveLength(4);
    expect(carton.children[1]!.position.toArray()).toEqual([-75, 84, 0]);
    expect(carton.children[2]!.position.toArray()).toEqual([75, 84, 0]);
    expect(carton.position.toArray()).toEqual([0, -30, -30]);

    disposeGroup(carton);
  });

  it("buildHand assembles a flattened palm and four capsule fingers", () => {
    const hand = buildHand();

    expect(hand.children).toHaveLength(5);
    expect(hand.children[0]!.scale.toArray()).toEqual([1, 0.55, 0.28]);
    expect(hand.children.slice(1).map((child) => child.position.x)).toEqual([-46, -15, 16, 47]);
    expect(hand.position.toArray()).toEqual([0, -220, 340]);
    expect(hand.visible).toBe(false);

    disposeGroup(hand);
  });

  it("buildShelf returns canonical flavors and clamps counts to the available range", () => {
    const three = buildShelf(3);
    const all = buildShelf(99);
    const none = buildShelf(-1);

    expect(three.map((built) => built.group.name)).toEqual(["can-lemon", "can-peach", "can-mint"]);
    expect(all).toHaveLength(5);
    expect(none).toEqual([]);

    for (const built of [...three, ...all]) built.dispose();
  });
});

describe("lib/scenes/origin-film/scene", () => {
  it("is registered under origin-film and dynamically resolves a real SceneModule", async () => {
    expect(sceneRegistry["origin-film"]).toBeTypeOf("function");

    const scene = await loadScene("origin-film");
    expect(scene.init).toBeTypeOf("function");
    expect(scene.update).toBeTypeOf("function");
    expect(scene.dispose).toBeTypeOf("function");
  });

  it("default-exports a factory that returns a fresh functional SceneModule each call", () => {
    const first = createOriginFilmScene();
    const second = createOriginFilmScene();
    const firstCtx = makeCtx();
    const secondCtx = makeCtx();

    expect(first).not.toBe(second);
    first.init(firstCtx);
    second.init(secondCtx);
    expect(originRoot(firstCtx)).not.toBe(originRoot(secondCtx));

    first.dispose();
    second.dispose();
  });

  it.each([
    ["low", 14, 3],
    ["medium", 22, 5],
    ["high", 30, 5],
  ] satisfies Array<[QualityTier, number, number]>) (
    "maps %s quality to %i leaves and %i shelf cans",
    (quality, leafCount, shelfCount) => {
      const ctx = makeCtx({ quality });
      const scene = createOriginFilmScene();
      scene.init(ctx);

      const leaves = ctx.scene.getObjectByName("origin-film-leaves") as THREE.InstancedMesh;
      const shelf = world(ctx).children.filter((child) =>
        child.name.startsWith("origin-film-shelf-can-"),
      );
      expect(leaves.count).toBe(leafCount);
      expect(shelf).toHaveLength(shelfCount);

      scene.dispose();
    },
  );

  it.each(["low", "medium", "high"] satisfies QualityTier[])(
    "lifts the CENTRE shelf can on the stock beat at %s quality, not a hardcoded index 2",
    (quality) => {
      // The low tier builds a 3-can row, where index 2 is the RIGHT-HAND can,
      // not the middle one. Hardcoding it lifted the wrong can — off-centre
      // from the hero can fading in at x = 0 at the same moment.
      const ctx = makeCtx({ quality });
      const scene = createOriginFilmScene();
      scene.init(ctx);

      const shelf = world(ctx)
        .children.filter((child) => child.name.startsWith("origin-film-shelf-can-"))
        .sort((a, b) => a.name.localeCompare(b.name));

      // Park the film on the stock beat so the lift is at full amplitude.
      scene.onProgress?.(originChapters[5].band.peak);
      scene.update(1 / 60, ctx);

      const lifted = shelf.filter((can) => can.rotation.z !== 0);
      expect(lifted).toHaveLength(1);
      expect(lifted[0]).toBe(shelf[heroShelfIndex(shelf.length)]);
      // ...and the can that lifts is the one standing at the row's centre.
      expect(lifted[0].position.x).toBeCloseTo(0, 9);

      // The whole row is still centred and evenly spaced at every count.
      expect(shelf.reduce((sum, can) => sum + can.position.x, 0)).toBeCloseTo(0, 9);
      for (let i = 1; i < shelf.length; i += 1) {
        expect(shelf[i].position.x - shelf[i - 1].position.x).toBeCloseTo(SHELF_CAN_SPACING, 9);
      }

      scene.dispose();
    },
  );

  it("seeds the shelf with the same layout formula update() uses, at every count", () => {
    // init() used to place cans with `(index - 2) * 100` — a third formula,
    // correct for no count at all — and got away with it only because the
    // next frame's update() overwrote it.
    for (const [quality, count] of [
      ["low", 3],
      ["high", 5],
    ] satisfies Array<[QualityTier, number]>) {
      const ctx = makeCtx({ quality });
      const scene = createOriginFilmScene();
      scene.init(ctx);

      const shelf = world(ctx)
        .children.filter((child) => child.name.startsWith("origin-film-shelf-can-"))
        .sort((a, b) => a.name.localeCompare(b.name));

      expect(shelf).toHaveLength(count);
      shelf.forEach((can, index) => {
        expect(can.position.x).toBeCloseTo(shelfCanX(index, count), 9);
      });

      scene.dispose();
    }
  });

  it("is re-runnable without accumulating scene children or old GPU objects", () => {
    const ctx = makeCtx();
    const scene = createOriginFilmScene();
    scene.init(ctx);
    const firstRoot = originRoot(ctx);
    const firstLeaves = ctx.scene.getObjectByName("origin-film-leaves") as THREE.InstancedMesh;
    const geometryDispose = vi.spyOn(firstLeaves.geometry, "dispose");

    scene.init(ctx);

    expect(ctx.scene.children).toHaveLength(1);
    expect(firstRoot.parent).toBeNull();
    expect(originRoot(ctx)).not.toBe(firstRoot);
    expect(geometryDispose).toHaveBeenCalledOnce();

    scene.dispose();
  });

  it("dispose removes the rig and frees representative geometries and materials", () => {
    const ctx = makeCtx();
    const scene = createOriginFilmScene();
    scene.init(ctx);
    const leaves = ctx.scene.getObjectByName("origin-film-leaves") as THREE.InstancedMesh;
    const brew = ctx.scene.getObjectByName("origin-film-brew") as THREE.Mesh;
    const leafGeometryDispose = vi.spyOn(leaves.geometry, "dispose");
    const leafMaterialDispose = vi.spyOn(leaves.material as THREE.Material, "dispose");
    const brewGeometryDispose = vi.spyOn(brew.geometry, "dispose");
    const brewMaterialDispose = vi.spyOn(brew.material as THREE.Material, "dispose");

    scene.dispose();

    expect(ctx.scene.children).toHaveLength(0);
    expect(leafGeometryDispose).toHaveBeenCalledOnce();
    expect(leafMaterialDispose).toHaveBeenCalledOnce();
    expect(brewGeometryDispose).toHaveBeenCalledOnce();
    expect(brewMaterialDispose).toHaveBeenCalledOnce();
  });

  it("seeds live per-view progress and applies the representative mid-film pose on its first update", () => {
    const ctx = makeCtx();
    const scene = createOriginFilmScene();
    const pose = originPoseForProgress(0.5);
    scene.init(ctx);

    // A top-pinned 600px view in a 600px viewport has per-view progress
    // 0.5 at scrollY=0. update() intentionally runs before onProgress().
    scene.update(0, ctx);

    const can = ctx.scene.getObjectByName("origin-film-hero-can") as THREE.Group;
    const brew = ctx.scene.getObjectByName("origin-film-brew") as THREE.Mesh;
    expect(can.position.toArray()).toEqual([144, pose.canY, 75]);
    expect(can.scale.x).toBeCloseTo(pose.canScale);
    expect((brew.material as THREE.ShaderMaterial).uniforms.uFill!.value).toBeCloseTo(pose.fill);
    expect(ctx.camera.position.y).toBeCloseTo(pose.cameraY);
    expect(ctx.camera.position.z).toBeCloseTo(pose.cameraZ);

    scene.dispose();
  });

  it("hands the view camera back to its pre-init pose on dispose", () => {
    const ctx = makeCtx();
    ctx.camera.position.set(0, 12, 900);
    ctx.camera.lookAt(0, 0, 0);
    const basePosition = ctx.camera.position.toArray();
    const baseQuaternion = ctx.camera.quaternion.toArray();

    const scene = createOriginFilmScene();
    scene.init(ctx);
    scene.onProgress?.(0.35);
    scene.update(0.016, ctx);
    expect(ctx.camera.position.z).not.toBeCloseTo(basePosition[2]!);

    scene.dispose();

    expect(ctx.camera.position.toArray()).toEqual(basePosition);
    expect(ctx.camera.quaternion.toArray()).toEqual(baseQuaternion);
  });

  it("re-init after a posed run captures the true camera base, not the film pose", () => {
    const ctx = makeCtx();
    ctx.camera.position.set(0, 12, 900);
    const basePosition = ctx.camera.position.toArray();

    const scene = createOriginFilmScene();
    scene.init(ctx);
    scene.onProgress?.(0.35);
    scene.update(0.016, ctx);

    scene.init(ctx); // context-loss restore, mid-film
    scene.dispose();

    expect(ctx.camera.position.toArray()).toEqual(basePosition);
  });

  it("freezes ambient spin and pointer parallax under reduced motion but keeps the scroll pose", () => {
    const moving = makeCtx({ pointer: { x: 1, y: -1, vx: 0, vy: 0, down: false, inside: true } });
    const still = makeCtx({
      pointer: { x: 1, y: -1, vx: 0, vy: 0, down: false, inside: true },
      reducedMotion: true,
    });
    const movingScene = createOriginFilmScene();
    const stillScene = createOriginFilmScene();
    movingScene.init(moving);
    stillScene.init(still);
    movingScene.onProgress?.(0.2);
    stillScene.onProgress?.(0.2);
    movingScene.update(0.5, moving);
    stillScene.update(0.5, still);

    const movingBasket = moving.scene.getObjectByName("origin-film-basket") as THREE.Mesh;
    const stillBasket = still.scene.getObjectByName("origin-film-basket") as THREE.Mesh;
    const pose = originPoseForProgress(0.2);

    // Ambient: the basket's elapsed-driven spin and the pointer parallax run
    // in the default branch and are pinned flat in the reduced-motion branch.
    expect(movingBasket.rotation.y).toBeGreaterThan(0);
    expect(stillBasket.rotation.y).toBe(0);
    expect(world(moving).rotation.y).toBeGreaterThan(0);
    expect(world(still).rotation.y).toBe(0);

    // Scroll pose: identical in both branches.
    expect(stillBasket.position.y).toBeCloseTo(movingBasket.position.y);
    expect(still.camera.position.z).toBeCloseTo(pose.cameraZ);

    movingScene.dispose();
    stillScene.dispose();
  });

  it("uses onProgress for later poses and onPointer/null for the legacy parallax input", () => {
    const ctx = makeCtx({ size: { width: 700, height: 600, dpr: 1 }, quality: "low" });
    const scene = createOriginFilmScene();
    scene.init(ctx);
    scene.onProgress?.(0.82);
    scene.onPointer?.({ x: 1, y: -1, point: { x: 0, y: 0, z: 0 }, distance: 1 });
    scene.update(0, ctx);

    const pose = originPoseForProgress(0.82);
    const rootWorld = world(ctx);
    const hand = ctx.scene.getObjectByName("origin-film-hand") as THREE.Group;
    expect(ctx.camera.position.z).toBeCloseTo(pose.cameraZ);
    expect(rootWorld.rotation.x).toBeGreaterThan(0);
    expect(rootWorld.rotation.y).toBeGreaterThan(0);
    expect(hand.scale.x).toBe(0.75);

    const rotationBeforeNull = rootWorld.rotation.y;
    scene.onPointer?.(null);
    scene.update(0, ctx);
    expect(rootWorld.rotation.y).toBeLessThan(rotationBeforeNull);

    scene.dispose();
  });
});

describe("lib/scenes/origin-film/scene — drag-to-inspect", () => {
  // Derived from the bands, not typed in: a chapter-weight retune moves the
  // inspection window with chapter 04 instead of stranding these tests.
  const canProgress = (originChapters[3]!.band.peak + originChapters[4]!.band.peak) / 2;
  const stockProgress = (originChapters[5]!.band.peak + originChapters[6]!.band.peak) / 2;
  const FRAME = 1 / 60;

  /**
   * Runs two identical scenes down the same pointer trajectory; only the first
   * one presses the button. Every difference between the two cans is therefore
   * the inspector's doing and nothing else — the shared pointer parallax, the
   * elapsed-time spin and the scroll pose all cancel out.
   */
  function inspectPair(
    progress: number,
    axis: "x" | "y" = "x",
    overrides: Partial<ViewContext> = {},
  ) {
    const dragCtx = makeCtx(overrides);
    const idleCtx = makeCtx(overrides);
    const dragScene = createOriginFilmScene();
    const idleScene = createOriginFilmScene();

    dragScene.init(dragCtx);
    idleScene.init(idleCtx);
    dragScene.onProgress?.(progress);
    idleScene.onProgress?.(progress);

    // Frame 0 idles; frame 1 presses at the origin; frame 2 crosses the axis
    // lock (which rebases, so it rotates nothing); frame 3 does the travel.
    // Vertical travel is negative because engine pointer Y is positive-UP.
    const travel = axis === "x" ? [0, 0, 0.2, 0.4] : [0, 0, -0.2, -0.4];
    travel.forEach((value, index) => {
      if (axis === "x") {
        dragCtx.pointer.x = value;
        idleCtx.pointer.x = value;
      } else {
        dragCtx.pointer.y = value;
        idleCtx.pointer.y = value;
      }
      dragCtx.pointer.down = index > 0;
      dragScene.update(FRAME, dragCtx);
      idleScene.update(FRAME, idleCtx);
    });

    return {
      dragCtx,
      dragScene,
      dragCan: heroCan(dragCtx),
      idleCan: heroCan(idleCtx),
      /** Lets go and runs both scenes on for six seconds. */
      release(frames = 360) {
        dragCtx.pointer.down = false;
        for (let i = 0; i < frames; i += 1) {
          dragScene.update(FRAME, dragCtx);
          idleScene.update(FRAME, idleCtx);
        }
      },
      dispose() {
        dragScene.dispose();
        idleScene.dispose();
      },
    };
  }

  it("rotates the hero can from a horizontal drag while the CAN chapter is active", () => {
    expect(isActive(3, canProgress)).toBe(true);
    const rig = inspectPair(canProgress);

    // 80 CSS px of post-lock travel at the inspector's default 0.01 rad/px.
    expect(rig.dragCan.rotation.y - rig.idleCan.rotation.y).toBeCloseTo(0.8, 6);

    rig.dispose();
  });

  it("refuses the same drag outside the CAN chapter, leaving the scripted pose alone", () => {
    expect(isActive(3, stockProgress)).toBe(false);
    const rig = inspectPair(stockProgress);

    expect(rig.dragCan.rotation.y).toBeCloseTo(rig.idleCan.rotation.y, 12);
    expect(rig.dragCan.rotation.x).toBeCloseTo(rig.idleCan.rotation.x, 12);

    rig.dispose();
  });

  it("hands a vertical gesture back to the scroller instead of turning the can", () => {
    const rig = inspectPair(canProgress, "y");

    // The pointer moved exactly as far as the horizontal case, but down the
    // screen: the axis lock gives the gesture to the page and rotates nothing.
    expect(rig.dragCan.rotation.y).toBeCloseTo(rig.idleCan.rotation.y, 12);
    expect(rig.dragCan.rotation.x).toBeCloseTo(rig.idleCan.rotation.x, 12);

    rig.dispose();
  });

  it("springs an inspected can back onto the scripted pose after release", () => {
    const rig = inspectPair(canProgress);
    const grabbed = rig.dragCan.rotation.y - rig.idleCan.rotation.y;

    rig.release();

    expect(grabbed).toBeGreaterThan(0.5);
    expect(Math.abs(rig.dragCan.rotation.y - rig.idleCan.rotation.y)).toBeLessThan(0.005);

    rig.dispose();
  });

  it("keeps inspection live under reduced motion, but holds instead of coasting", () => {
    const rig = inspectPair(canProgress, "x", { reducedMotion: true });

    // Reduced motion blanks the elapsed spin and the pointer parallax, so the
    // scripted rotation is flat and the can's yaw IS the inspection offset.
    expect(rig.idleCan.rotation.y).toBe(0);
    expect(rig.dragCan.rotation.y).toBeCloseTo(0.8, 6);

    const held = rig.dragCan.rotation.y;
    rig.release();
    // No inertia and no spring-back: it stops exactly where the finger left it.
    expect(rig.dragCan.rotation.y).toBe(held);

    // Leaving the chapter must still hand the can back to the film — with the
    // spring disabled, that has to be a snap rather than a glide.
    rig.dragScene.onProgress?.(stockProgress);
    rig.dragScene.update(FRAME, rig.dragCtx);
    expect(rig.dragCan.rotation.y).toBe(0);

    rig.dispose();
  });
});

describe("lib/scenes/origin-film/scene — pollen field", () => {
  const growBand = originChapters[0]!.band;
  const growMid = (growBand.in + growBand.out) / 2;
  const FRAME = 1 / 60;

  it("falls back to the CPU mote field when the host never probed float support", () => {
    const ctx = makeCtx();
    const scene = createOriginFilmScene();
    scene.init(ctx);

    const motes = pollenMotes(ctx);
    expect(motes).toBeInstanceOf(THREE.InstancedMesh);
    expect(motes.count).toBe(POLLEN_CPU_COUNT.high);
    expect(ctx.scene.getObjectByName("origin-film-pollen-points")).toBeUndefined();

    scene.dispose();
  });

  it("takes the GPU points path once the context has probed float render targets", () => {
    const ctx = makeCtx({ floatSupport: "float" });
    const scene = createOriginFilmScene();
    scene.init(ctx);

    const points = pollenPoints(ctx);
    expect(points).toBeInstanceOf(THREE.Points);
    expect(points.geometry.getAttribute("aUv").count).toBe(POLLEN_SIM_SIZE.high ** 2);
    expect(ctx.scene.getObjectByName("origin-film-pollen-motes")).toBeUndefined();

    scene.dispose();
  });

  it("keeps a low-tier context on the CPU path even when float targets exist", () => {
    const ctx = makeCtx({ floatSupport: "float", quality: "low" });
    const scene = createOriginFilmScene();
    scene.init(ctx);

    expect(pollenMotes(ctx).count).toBe(POLLEN_CPU_COUNT.low);
    expect(ctx.scene.getObjectByName("origin-film-pollen-points")).toBeUndefined();

    scene.dispose();
  });

  it("belongs to chapter 01 only: absent at both of its edges, gone by the machine beat", () => {
    const ctx = makeCtx();
    const scene = createOriginFilmScene();
    scene.init(ctx);
    const material = pollenMotes(ctx).material as THREE.MeshBasicMaterial;

    scene.onProgress?.(growBand.in);
    scene.update(FRAME, ctx);
    expect(material.opacity).toBe(0);
    expect(pollenGroup(ctx).visible).toBe(false);

    scene.onProgress?.(growMid);
    scene.update(FRAME, ctx);
    expect(material.opacity).toBeCloseTo(POLLEN_MAX_OPACITY, 6);
    expect(pollenGroup(ctx).visible).toBe(true);

    // Chapter 03's dominant system is the machine; the pollen has to be gone.
    scene.onProgress?.(originChapters[2]!.band.peak);
    scene.update(FRAME, ctx);
    expect(material.opacity).toBe(0);
    expect(pollenGroup(ctx).visible).toBe(false);

    scene.dispose();
  });

  it("keeps drifting on the CPU path when the host lends no renderer", () => {
    // makeCtx() sets no `renderer`, which is the ViewContext every host without
    // a real WebGLRenderer hands over.
    const ctx = makeCtx();
    const scene = createOriginFilmScene();
    scene.init(ctx);
    scene.onProgress?.(growMid);
    scene.update(FRAME, ctx);

    const before = instancePose(pollenMotes(ctx));
    for (let i = 0; i < 60; i += 1) scene.update(FRAME, ctx);
    const after = instancePose(pollenMotes(ctx));

    expect(maxAbsDelta(before, after)).toBeGreaterThan(1);

    scene.dispose();
  });

  it("holds the GPU field's seeded pose when the host lends no renderer", () => {
    const ctx = makeCtx({ floatSupport: "float" });
    const scene = createOriginFilmScene();
    scene.init(ctx);
    scene.onProgress?.(growMid);
    for (let i = 0; i < 10; i += 1) scene.update(FRAME, ctx);

    const material = pollenPoints(ctx).material as THREE.ShaderMaterial;
    // No ping-pong ran, so the renderer still reads the seed texture...
    expect(material.uniforms.uUseSimTexture!.value).toBe(0);
    // ...but presence is scroll-driven, so it is still fully faded up.
    expect(material.uniforms.uOpacity!.value).toBeCloseTo(POLLEN_MAX_OPACITY, 6);

    scene.dispose();
  });

  it("freezes the field under reduced motion while presence still tracks scroll", () => {
    const ctx = makeCtx({ reducedMotion: true });
    const scene = createOriginFilmScene();
    scene.init(ctx);
    scene.onProgress?.(growMid);
    scene.update(FRAME, ctx);

    const motes = pollenMotes(ctx);
    const material = motes.material as THREE.MeshBasicMaterial;
    const before = instancePose(motes);
    for (let i = 0; i < 60; i += 1) scene.update(FRAME, ctx);

    expect(maxAbsDelta(before, instancePose(motes))).toBe(0);
    expect(material.opacity).toBeCloseTo(POLLEN_MAX_OPACITY, 6);

    scene.onProgress?.(growBand.out);
    scene.update(FRAME, ctx);
    expect(material.opacity).toBe(0);

    scene.dispose();
  });

  it("frees the field on dispose and builds exactly one on a context-loss restore", () => {
    const ctx = makeCtx();
    const scene = createOriginFilmScene();
    scene.init(ctx);
    const first = pollenMotes(ctx);
    const firstGeometry = vi.spyOn(first.geometry, "dispose");
    const firstMaterial = vi.spyOn(first.material as THREE.Material, "dispose");

    scene.init(ctx); // context-loss restore

    expect(firstGeometry).toHaveBeenCalledOnce();
    expect(firstMaterial).toHaveBeenCalledOnce();
    expect(world(ctx).children.filter((child) => child.name === "origin-film-pollen")).toHaveLength(
      1,
    );

    const second = pollenMotes(ctx);
    const secondGeometry = vi.spyOn(second.geometry, "dispose");
    scene.dispose();

    expect(secondGeometry).toHaveBeenCalledOnce();
    expect(second.parent).toBeNull();
  });

  it("frees the GPU field's points geometry and shader on dispose", () => {
    const ctx = makeCtx({ floatSupport: "float" });
    const scene = createOriginFilmScene();
    scene.init(ctx);
    const points = pollenPoints(ctx);
    const geometryDispose = vi.spyOn(points.geometry, "dispose");
    const materialDispose = vi.spyOn(points.material as THREE.Material, "dispose");

    scene.dispose();

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(points.parent).toBeNull();
  });
});
