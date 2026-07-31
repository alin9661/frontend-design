// lib/engine/gl/text/index.ts
//
// Public barrel for gl/text/ — the ONLY import path other workstreams
// should use ("@/lib/engine/gl/text"), per the design doc §4C text
// contract: `loadFont`, `FontHandle`, `GlText`.
//
// loadFont() tries the build-time MSDF atlas first
// (fetch("/msdf/anton.json" + ".png")); msdfgen failed on this machine
// (public/msdf/FALLBACK.md), so in practice every caller gets `mode: "sdf"`
// via sdf-atlas.ts's runtime tiny-sdf generator today. Both paths produce
// the same FontHandle shape so MsdfText.ts (GlText) never branches on how
// the font was built past its ShaderMaterial's `mode` #define.

import * as THREE from "three";
import type { AssetManager } from "../../types";
import { parseBmfontJson, type FontHandle } from "./font";
import { generateSdfAtlas, supportsSdfAtlasGeneration } from "./sdf-atlas";

export type { FontHandle } from "./font";
export { GlText, type GlTextOptions } from "./MsdfText";

const MSDF_JSON_URL = "/msdf/anton.json";
const MSDF_PNG_URL = "/msdf/anton.png";
const DEFAULT_ASSET_ID = "font-anton";
const DEFAULT_ASSET_WEIGHT = 1;

async function loadMsdfFont(): Promise<FontHandle> {
  const [jsonRes, pngRes] = await Promise.all([fetch(MSDF_JSON_URL), fetch(MSDF_PNG_URL)]);
  if (!jsonRes.ok || !pngRes.ok) {
    throw new Error(`loadFont: MSDF atlas not available (json ${jsonRes.status}, png ${pngRes.status})`);
  }

  const [json, blob] = await Promise.all([jsonRes.json(), pngRes.blob()]);
  const metrics = parseBmfontJson(json);

  // createImageBitmap (not `Image()`/`document`) so this stays worker-safe.
  const bitmap = await createImageBitmap(blob);
  const texture = new THREE.Texture(bitmap);
  texture.needsUpdate = true;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return { mode: "msdf", texture, metrics };
}

async function loadSdfFont(): Promise<FontHandle> {
  if (!supportsSdfAtlasGeneration()) {
    throw new Error("loadFont: neither the MSDF atlas nor OffscreenCanvas (sdf fallback) is available");
  }
  const { metrics, canvas } = await generateSdfAtlas();
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { mode: "sdf", texture, metrics };
}

async function loadFontImpl(): Promise<FontHandle> {
  try {
    return await loadMsdfFont();
  } catch {
    // Expected on this machine — see public/msdf/FALLBACK.md.
    return loadSdfFont();
  }
}

/**
 * Loads the Deep Wave headline/section-title font, preferring the
 * build-time MSDF atlas and transparently falling back to a runtime SDF
 * atlas (design doc §4C). Best-effort registers itself as a weighted job on
 * `assets` for loading-progress purposes — but always resolves directly
 * (via the same underlying promise) even if `assets` has already started or
 * this font id was already registered by an earlier caller, since callers
 * may invoke `loadFont` lazily from a SceneModule.init() well after the
 * page's initial AssetManager batch has resolved (see hand-off notes: this
 * is the one place the text contract's `AssetManager` lifecycle was
 * ambiguous).
 */
export async function loadFont(assets: AssetManager): Promise<FontHandle> {
  let promise: Promise<FontHandle> | null = null;
  const run = (): Promise<FontHandle> => {
    if (!promise) promise = loadFontImpl();
    return promise;
  };

  try {
    assets.add<FontHandle>(DEFAULT_ASSET_ID, DEFAULT_ASSET_WEIGHT, run);
  } catch {
    // AssetManager already started, or a font job was already registered
    // under this id — either way, we still load (and cache) directly below.
  }

  return run();
}
