// lib/scenes/origin-film/gltf.ts
//
// Optional Blender-authored geometry for the origin film's hand and machine.
// See docs/origin-assets-blender-brief.md for the authoring contract.
//
// The asset is NOT committed, so "absent" is this repo's default and fully
// supported state — the film renders rig.ts's procedural hand and machine and
// nothing is wrong. Two consequences shape this module:
//
//   1. A 404 is silent. Warning on the documented default would fire on every
//      production page load and train everyone to ignore the warning that
//      actually matters. Every OTHER failure — network error, malformed
//      binary, renamed nodes — warns exactly once, because each of those means
//      someone tried to ship a model and it did not arrive.
//   2. The existence check runs BEFORE the loader is imported. `fetch` costs
//      one conditional request; GLTFLoader plus the meshopt decoder cost
//      ~35 kB of JavaScript. Importing them first, then discovering there is
//      no file to parse, would make every visitor pay for a feature the repo
//      does not currently use.

import * as THREE from "three";
import { glPalette } from "@/lib/palette";

export const ORIGIN_ASSETS_URL = "/origin-assets.glb";

export interface OriginAssets {
  hand: THREE.Object3D | null;
  machine: THREE.Object3D | null;
}

const NO_ASSETS: OriginAssets = { hand: null, machine: null };

function collectMaterialTextures(material: THREE.Material, textures: Set<THREE.Texture>): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) textures.add(value);
  }

  if (material instanceof THREE.ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
    }
  }
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/**
 * Swap every imported material for a code-owned one. The GLB's own materials
 * are authoring conveniences: `lib/palette.ts` stays the single source of
 * truth for color across the SVG film, the DOM and GL, so a brand change never
 * requires re-exporting a binary. The one thing read from the file is a child
 * named `Drum`, which takes the amber accent — mirroring `buildMachine()`.
 */
function replaceImportedMaterials(hand: THREE.Object3D | null, machine: THREE.Object3D | null): void {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  for (const root of [hand, machine]) {
    root?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of materialsOf(object)) {
        materials.add(material);
        collectMaterialTextures(material, textures);
      }
    });
  }

  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();

  hand?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = new THREE.MeshStandardMaterial({
      color: glPalette.amber,
      roughness: 0.7,
    });
  });

  machine?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material =
      object.name === "Drum"
        ? new THREE.MeshStandardMaterial({ color: glPalette.amber, roughness: 0.35 })
        : new THREE.MeshStandardMaterial({
            color: glPalette.ochre,
            roughness: 0.42,
            metalness: 0.12,
          });
  });
}

/**
 * Free everything in the loaded document that is not one of the two nodes we
 * keep. A GLB with stray meshes, or with the exporter's default scene wrapper
 * still carrying geometry, would otherwise leak GPU memory that nothing holds
 * a reference to.
 */
function disposeUnusedDocument(document: THREE.Object3D, kept: readonly (THREE.Object3D | null)[]): void {
  const keptIds = new Set<number>();
  for (const root of kept) {
    root?.traverse((object) => keptIds.add(object.id));
  }

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  document.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || keptIds.has(object.id)) return;
    geometries.add(object.geometry);
    for (const material of materialsOf(object)) {
      materials.add(material);
      collectMaterialTextures(material, textures);
    }
  });

  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Load the optional origin assets. Never rejects: every failure resolves to
 * nulls so the caller keeps its procedural rig. Does not delay scene init —
 * the caller starts it and swaps the result in when it arrives.
 */
export async function loadOriginAssets(url = ORIGIN_ASSETS_URL): Promise<OriginAssets> {
  let payload: ArrayBuffer;

  try {
    const response = await fetch(url);
    // The supported default. Silent by design — see this file's header.
    if (!response.ok) return NO_ASSETS;
    payload = await response.arrayBuffer();
  } catch (error) {
    console.warn(`[origin-film] ${url}: ${reasonFor(error)} — using procedural geometry`);
    return NO_ASSETS;
  }

  try {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/libs/meshopt_decoder.module.js"),
    ]);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    const gltf = await loader.parseAsync(payload, "");
    const hand = gltf.scene.getObjectByName("Hand") ?? null;
    const machine = gltf.scene.getObjectByName("Machine") ?? null;

    replaceImportedMaterials(hand, machine);
    disposeUnusedDocument(gltf.scene, [hand, machine]);

    const missing = [hand ? null : "Hand", machine ? null : "Machine"].filter(
      (name): name is string => name !== null,
    );
    if (missing.length > 0) {
      console.warn(
        `[origin-film] ${url}: missing node${missing.length > 1 ? "s" : ""} ${missing.join(", ")} — using procedural geometry`,
      );
    }

    return { hand, machine };
  } catch (error) {
    console.warn(`[origin-film] ${url}: ${reasonFor(error)} — using procedural geometry`);
    return NO_ASSETS;
  }
}
