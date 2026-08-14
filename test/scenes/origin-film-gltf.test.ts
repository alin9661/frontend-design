// test/scenes/origin-film-gltf.test.ts
//
// The optional Blender-authored hand and machine. The binary is deliberately
// not committed, so CI only ever exercises the fallback path for real — which
// makes the mocked paths here the only coverage the swap logic gets, and the
// reason they assert observable graph state (parents, disposals, warnings)
// rather than "the function was called".

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

const loaderMocks = vi.hoisted(() => ({
  decoder: { name: "test-meshopt-decoder" },
  parseAsync: vi.fn(),
  setMeshoptDecoder: vi.fn(),
}));

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setMeshoptDecoder(decoder: unknown): this {
      loaderMocks.setMeshoptDecoder(decoder);
      return this;
    }

    parseAsync(data: ArrayBuffer, path: string): unknown {
      return loaderMocks.parseAsync(data, path);
    }
  },
}));

vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({
  MeshoptDecoder: loaderMocks.decoder,
}));

import type { ViewContext } from "@/lib/engine/types";
import { glPalette } from "@/lib/palette";
import { loadOriginAssets, ORIGIN_ASSETS_URL } from "@/lib/scenes/origin-film/gltf";
import createOriginFilmScene from "@/lib/scenes/origin-film/scene";
import { originPoseForProgress } from "@/lib/visuals/origin-timeline";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

const PAYLOAD = new ArrayBuffer(8);

/** A 200 carrying a GLB body. */
function servesAsset(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => PAYLOAD })),
  );
}

/** The repo's default state: no binary committed. */
function servesNothing(status = 404): void {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status })));
}

function makeCtx(): ViewContext {
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
  };
}

function world(ctx: ViewContext): THREE.Group {
  return ctx.scene.getObjectByName("origin-film-world") as THREE.Group;
}

function makeAssetScene(...nodes: THREE.Object3D[]): THREE.Group {
  const scene = new THREE.Group();
  scene.add(...nodes);
  return scene;
}

function named(node: THREE.Object3D, name: string): THREE.Object3D {
  node.name = name;
  return node;
}

function disposeGraph(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      material.dispose();
    }
  });
  root.clear();
}

beforeEach(() => {
  loaderMocks.parseAsync.mockReset();
  loaderMocks.setMeshoptDecoder.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("origin-film GLTF integration", () => {
  it("replaces both procedural nodes while preserving their live transforms and visibility", async () => {
    servesAsset();
    const pending = deferred<{ scene: THREE.Group }>();
    loaderMocks.parseAsync.mockReturnValue(pending.promise);
    const loadedHand = named(new THREE.Group(), "Hand");
    const loadedMachine = named(new THREE.Group(), "Machine");
    const assetScene = makeAssetScene(loadedHand, loadedMachine);
    const ctx = makeCtx();
    const scene = createOriginFilmScene();

    scene.init(ctx);
    scene.onProgress?.(0.82);
    scene.update(0.016, ctx);

    const proceduralHand = ctx.scene.getObjectByName("origin-film-hand") as THREE.Object3D;
    const proceduralMachine = ctx.scene.getObjectByName("origin-film-machine") as THREE.Object3D;
    const expectedHand = {
      position: proceduralHand.position.toArray(),
      rotation: proceduralHand.rotation.toArray(),
      scale: proceduralHand.scale.toArray(),
      visible: proceduralHand.visible,
      name: proceduralHand.name,
    };
    const expectedMachine = {
      position: proceduralMachine.position.toArray(),
      visible: proceduralMachine.visible,
      name: proceduralMachine.name,
    };

    pending.resolve({ scene: assetScene });
    await vi.waitFor(() => {
      expect(loadedHand.parent).toBe(world(ctx));
      expect(loadedMachine.parent).toBe(world(ctx));
    });

    expect(proceduralHand.parent).toBeNull();
    expect(proceduralMachine.parent).toBeNull();
    expect(loadedHand.position.toArray()).toEqual(expectedHand.position);
    expect(loadedHand.rotation.toArray()).toEqual(expectedHand.rotation);
    expect(loadedHand.scale.toArray()).toEqual(expectedHand.scale);
    expect(loadedHand.visible).toBe(expectedHand.visible);
    expect(loadedHand.name).toBe(expectedHand.name);
    expect(loadedMachine.position.toArray()).toEqual(expectedMachine.position);
    expect(loadedMachine.visible).toBe(expectedMachine.visible);
    expect(loadedMachine.name).toBe(expectedMachine.name);

    // The swapped-in nodes must keep taking the per-frame pose, which is what
    // proves update() reads the live fields rather than an init-time capture.
    scene.onProgress?.(0.97);
    scene.update(0.016, ctx);
    const pose = originPoseForProgress(0.97);
    expect(loadedHand.position.y).toBeCloseTo(-220 + pose.grip * 170);
    expect(loadedHand.visible).toBe(pose.grip > 0.005);

    scene.dispose();
  });

  it("stays silent when the asset is simply absent, which is the repo's default state", async () => {
    servesNothing();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = makeCtx();
    const scene = createOriginFilmScene();

    scene.init(ctx);
    await expect(loadOriginAssets()).resolves.toEqual({ hand: null, machine: null });

    expect(warn).not.toHaveBeenCalled();
    expect(ctx.scene.getObjectByName("origin-film-hand")!.parent).toBe(world(ctx));

    scene.dispose();
  });

  it("never imports the loader or the meshopt decoder when there is no asset to parse", async () => {
    servesNothing();

    await loadOriginAssets();

    // Constructing the loader is the only thing that calls this. Never called
    // means ~35 kB of GLTFLoader + decoder was never fetched for the default
    // no-binary configuration.
    expect(loaderMocks.setMeshoptDecoder).not.toHaveBeenCalled();
    expect(loaderMocks.parseAsync).not.toHaveBeenCalled();
  });

  it("warns once and keeps the procedural rig updateable when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("NetworkError");
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = makeCtx();
    const scene = createOriginFilmScene();

    expect(() => scene.init(ctx)).not.toThrow();
    const proceduralHand = ctx.scene.getObjectByName("origin-film-hand") as THREE.Object3D;
    const proceduralMachine = ctx.scene.getObjectByName("origin-film-machine") as THREE.Object3D;

    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NetworkError"));
    expect(proceduralHand.parent).toBe(world(ctx));
    expect(proceduralMachine.parent).toBe(world(ctx));

    scene.onProgress?.(0.82);
    expect(() => scene.update(0.016, ctx)).not.toThrow();
    const pose = originPoseForProgress(0.82);
    expect(proceduralHand.position.y).toBeCloseTo(-220 + pose.grip * 170);
    expect(proceduralHand.visible).toBe(pose.grip > 0.005);
    expect(proceduralMachine.visible).toBe(pose.manufacturing > 0.005);

    scene.dispose();
  });

  it("warns once and falls back when the binary is malformed", async () => {
    servesAsset();
    loaderMocks.parseAsync.mockRejectedValue(new Error("Unsupported glTF magic"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(loadOriginAssets()).resolves.toEqual({ hand: null, machine: null });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unsupported glTF magic"));
  });

  it("warns by name when a renamed node breaks the loader's only contract", async () => {
    servesAsset();
    const stray = named(new THREE.Group(), "hand_final_v2");
    loaderMocks.parseAsync.mockResolvedValue({ scene: makeAssetScene(stray) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const assets = await loadOriginAssets();

    expect(assets).toEqual({ hand: null, machine: null });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/missing nodes Hand, Machine/));
  });

  it("replaces every imported material from the palette and disposes source materials and textures", async () => {
    servesAsset();
    const handTexture = new THREE.Texture();
    const machineTexture = new THREE.Texture();
    const drumTexture = new THREE.Texture();
    const handSource = new THREE.MeshStandardMaterial({ map: handTexture });
    const machineSource = new THREE.MeshStandardMaterial({ map: machineTexture });
    const drumSource = new THREE.MeshStandardMaterial({ map: drumTexture });
    const sourceMaterials = [handSource, machineSource, drumSource];
    const sourceTextures = [handTexture, machineTexture, drumTexture];
    const materialDisposals = sourceMaterials.map((material) => vi.spyOn(material, "dispose"));
    const textureDisposals = sourceTextures.map((texture) => vi.spyOn(texture, "dispose"));

    const handMesh = new THREE.Mesh(new THREE.BoxGeometry(), handSource);
    const machineMesh = new THREE.Mesh(new THREE.BoxGeometry(), machineSource);
    const drumMesh = named(
      new THREE.Mesh(new THREE.CylinderGeometry(), drumSource),
      "Drum",
    ) as THREE.Mesh;
    const hand = named(new THREE.Group(), "Hand");
    const machine = named(new THREE.Group(), "Machine");
    hand.add(handMesh);
    machine.add(machineMesh, drumMesh);
    const assetScene = makeAssetScene(hand, machine);
    loaderMocks.parseAsync.mockResolvedValue({ scene: assetScene });

    const assets = await loadOriginAssets("/materials.glb");

    expect(loaderMocks.setMeshoptDecoder).toHaveBeenCalledOnce();
    expect(loaderMocks.setMeshoptDecoder).toHaveBeenCalledWith(loaderMocks.decoder);
    expect(loaderMocks.parseAsync).toHaveBeenCalledWith(PAYLOAD, "");
    for (const disposal of [...materialDisposals, ...textureDisposals]) {
      expect(disposal).toHaveBeenCalledOnce();
    }

    const handMaterial = handMesh.material as THREE.MeshStandardMaterial;
    const machineMaterial = machineMesh.material as THREE.MeshStandardMaterial;
    const drumMaterial = drumMesh.material as THREE.MeshStandardMaterial;
    expect(handMaterial).not.toBe(handSource);
    expect(handMaterial.color.getHex()).toBe(glPalette.amber);
    expect(handMaterial.roughness).toBe(0.7);
    expect(machineMaterial).not.toBe(machineSource);
    expect(machineMaterial.color.getHex()).toBe(glPalette.ochre);
    expect(machineMaterial.roughness).toBe(0.42);
    expect(machineMaterial.metalness).toBe(0.12);
    expect(drumMaterial).not.toBe(drumSource);
    expect(drumMaterial.color.getHex()).toBe(glPalette.amber);
    expect(drumMaterial.roughness).toBe(0.35);
    expect(assets).toEqual({ hand, machine });

    disposeGraph(assetScene);
  });

  it("frees geometry in the document that is not one of the two kept nodes", async () => {
    servesAsset();
    const strayGeometry = new THREE.BoxGeometry();
    const strayDispose = vi.spyOn(strayGeometry, "dispose");
    const keptGeometry = new THREE.BoxGeometry();
    const keptDispose = vi.spyOn(keptGeometry, "dispose");

    const hand = named(new THREE.Group(), "Hand");
    hand.add(new THREE.Mesh(keptGeometry, new THREE.MeshStandardMaterial()));
    const machine = named(new THREE.Group(), "Machine");
    const stray = new THREE.Mesh(strayGeometry, new THREE.MeshStandardMaterial());
    loaderMocks.parseAsync.mockResolvedValue({ scene: makeAssetScene(hand, machine, stray) });

    await loadOriginAssets();

    expect(strayDispose).toHaveBeenCalledOnce();
    // The nodes we keep must survive — disposing their geometry here would
    // hand the scene an already-freed buffer.
    expect(keptDispose).not.toHaveBeenCalled();
  });

  it("disposes a late result after scene disposal without attaching it to the dead graph", async () => {
    servesAsset();
    const pending = deferred<{ scene: THREE.Group }>();
    loaderMocks.parseAsync.mockReturnValue(pending.promise);
    const geometry = new THREE.BoxGeometry();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(THREE.MeshStandardMaterial.prototype, "dispose");
    const loadedMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    const loadedHand = named(new THREE.Group(), "Hand");
    const loadedMachine = named(new THREE.Group(), "Machine");
    loadedHand.add(loadedMesh);
    const assetScene = makeAssetScene(loadedHand, loadedMachine);
    const ctx = makeCtx();
    const scene = createOriginFilmScene();

    scene.init(ctx);
    scene.dispose();
    pending.resolve({ scene: assetScene });

    await vi.waitFor(() => expect(geometryDispose).toHaveBeenCalledOnce());
    const replacementMaterial = loadedMesh.material as THREE.MeshStandardMaterial;
    expect(materialDispose.mock.contexts).toContain(replacementMaterial);
    expect(loadedHand.parent).toBeNull();
    expect(loadedMachine.parent).toBeNull();
    expect(ctx.scene.children).toHaveLength(0);
  });

  it("keeps GLTFLoader behind the dynamic-import boundary", () => {
    const sceneSource = readFileSync(`${process.cwd()}/lib/scenes/origin-film/scene.ts`, "utf8");
    const gltfSource = readFileSync(`${process.cwd()}/lib/scenes/origin-film/gltf.ts`, "utf8");

    expect(sceneSource).not.toContain("three/examples/jsm/loaders/GLTFLoader.js");
    expect(gltfSource).toContain('import("three/examples/jsm/loaders/GLTFLoader.js")');
    expect(gltfSource).toContain('import("three/examples/jsm/libs/meshopt_decoder.module.js")');
    expect(gltfSource).not.toMatch(
      /^import .*three\/examples\/jsm\/(?:loaders\/GLTFLoader|libs\/meshopt_decoder\.module)\.js/m,
    );
  });
});
