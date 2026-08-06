// test/engine/text/gl-text.test.ts
//
// GlText (MsdfText.ts) lifecycle/dispose against a mocked FontHandle — a
// real (but image-less) THREE.Texture stands in for a loaded atlas, exactly
// like other gl/ tests construct real three.js objects without a live
// WebGL context (see test/engine/gl/gpgpu.test.ts). No canvas/OffscreenCanvas
// involved, so this runs fine under jsdom.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GlText } from "@/lib/engine/gl/text/MsdfText";
import type { FontHandle, FontMetrics } from "@/lib/engine/gl/text/font";

function fixtureMetrics(): FontMetrics {
  const glyphs = new Map<string, { id: number; x: number; y: number; width: number; height: number; xoffset: number; yoffset: number; xadvance: number }>();
  glyphs.set("A", { id: 65, x: 0, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 0, xadvance: 10 });
  glyphs.set("B", { id: 66, x: 8, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 0, xadvance: 10 });
  glyphs.set(" ", { id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 5 });
  return { glyphs, kernings: new Map(), size: 10, lineHeight: 12, base: 10, scaleW: 32, scaleH: 8 };
}

function fixtureFont(mode: "msdf" | "sdf" = "sdf"): FontHandle {
  return { mode, texture: new THREE.Texture(), metrics: fixtureMetrics() };
}

function meshOf(glText: GlText): THREE.InstancedMesh {
  const mesh = glText.object3d.children[0];
  expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
  return mesh as THREE.InstancedMesh;
}

describe("GlText", () => {
  it("builds one InstancedMesh instance per renderable glyph, and exposes layout's width/height", () => {
    const glText = new GlText(fixtureFont(), { text: "AB", fontSize: 10 });
    const mesh = meshOf(glText);
    expect(mesh.count).toBe(2);
    expect(glText.width).toBe(20);
    expect(glText.height).toBe(12);
  });

  it("uppercases input (the shared charset is uppercase-only)", () => {
    const glText = new GlText(fixtureFont(), { text: "ab", fontSize: 10 });
    expect(meshOf(glText).count).toBe(2);
    expect(glText.width).toBe(20);
  });

  it("mode:'msdf' defines USE_MSDF on the material; mode:'sdf' does not", () => {
    const msdfText = new GlText(fixtureFont("msdf"), { text: "A", fontSize: 10 });
    const sdfText = new GlText(fixtureFont("sdf"), { text: "A", fontSize: 10 });
    const msdfMaterial = meshOf(msdfText).material as THREE.ShaderMaterial;
    const sdfMaterial = meshOf(sdfText).material as THREE.ShaderMaterial;
    expect(msdfMaterial.defines).toHaveProperty("USE_MSDF");
    expect(sdfMaterial.defines).not.toHaveProperty("USE_MSDF");
  });

  it("setColor updates the shared material's uColor uniform", () => {
    const glText = new GlText(fixtureFont(), { text: "A", fontSize: 10, color: 0x112233 });
    const material = meshOf(glText).material as THREE.ShaderMaterial;
    const before = (material.uniforms.uColor!.value as THREE.Color).getHex();
    expect(before).toBe(0x112233);

    glText.setColor(0xff00ff);
    expect((material.uniforms.uColor!.value as THREE.Color).getHex()).toBe(0xff00ff);
  });

  it("applies the opacity option to uOpacity (default 1)", () => {
    const watermark = new GlText(fixtureFont(), { text: "A", fontSize: 10, opacity: 0.14 });
    const headline = new GlText(fixtureFont(), { text: "A", fontSize: 10 });
    const watermarkMaterial = meshOf(watermark).material as THREE.ShaderMaterial;
    const headlineMaterial = meshOf(headline).material as THREE.ShaderMaterial;
    expect(watermarkMaterial.uniforms.uOpacity!.value).toBeCloseTo(0.14);
    expect(headlineMaterial.uniforms.uOpacity!.value).toBe(1);
  });

  it("setOpacity updates the shared material's uOpacity uniform", () => {
    const glText = new GlText(fixtureFont(), { text: "A", fontSize: 10, opacity: 0.5 });
    const material = meshOf(glText).material as THREE.ShaderMaterial;
    glText.setOpacity(0.9);
    expect(material.uniforms.uOpacity!.value).toBeCloseTo(0.9);
  });

  it("F3: a caller-supplied opacity of 0 is honoured, in the constructor AND via setOpacity", () => {
    // The implementation defaults opacity with `opts.opacity ?? 1` precisely
    // so an explicit 0 (fully transparent, a legitimate GL text state — e.g.
    // fading a headline out) is preserved, not silently promoted to 1. 0 is
    // the one input where `??` and `||` diverge (`0 || 1` is `1`; `0 ?? 1`
    // is `0`), and it was untested — this pins both entry points against
    // ever regressing to `||`.
    const glText = new GlText(fixtureFont(), { text: "A", fontSize: 10, opacity: 0 });
    const material = meshOf(glText).material as THREE.ShaderMaterial;
    expect(material.uniforms.uOpacity!.value).toBe(0);

    glText.setOpacity(0.6);
    expect(material.uniforms.uOpacity!.value).toBeCloseTo(0.6);
    glText.setOpacity(0);
    expect(material.uniforms.uOpacity!.value).toBe(0);
  });

  it("setText rebuilds the InstancedMesh (new geometry, updated count) and disposes the old geometry", () => {
    const glText = new GlText(fixtureFont(), { text: "A", fontSize: 10 });
    const firstMesh = meshOf(glText);
    expect(firstMesh.count).toBe(1);
    const disposeSpy = vi.spyOn(firstMesh.geometry, "dispose");

    glText.setText("AB");

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    const secondMesh = meshOf(glText);
    expect(secondMesh).not.toBe(firstMesh);
    expect(secondMesh.count).toBe(2);
    expect(glText.width).toBe(20);
  });

  it("setText keeps the same object3d and material instance (no re-parenting needed by the caller)", () => {
    const glText = new GlText(fixtureFont(), { text: "A", fontSize: 10 });
    const object3d = glText.object3d;
    const material = meshOf(glText).material;

    glText.setText("AB");

    expect(glText.object3d).toBe(object3d);
    expect(meshOf(glText).material).toBe(material);
  });

  it("dispose() frees the mesh geometry and material, detaches object3d, and never touches the shared font texture", () => {
    const font = fixtureFont();
    const textureDisposeSpy = vi.spyOn(font.texture, "dispose");
    const glText = new GlText(font, { text: "AB", fontSize: 10 });

    const scene = new THREE.Scene();
    scene.add(glText.object3d);

    const mesh = meshOf(glText);
    const geometryDisposeSpy = vi.spyOn(mesh.geometry, "dispose");
    const materialDisposeSpy = vi.spyOn(mesh.material as THREE.ShaderMaterial, "dispose");

    glText.dispose();

    expect(geometryDisposeSpy).toHaveBeenCalledTimes(1);
    expect(materialDisposeSpy).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0); // object3d detached itself from its parent
    expect(textureDisposeSpy).not.toHaveBeenCalled(); // the FontHandle's texture is shared/owned elsewhere
  });

  it("a second GlText built from the same FontHandle is unaffected by the first's dispose()", () => {
    const font = fixtureFont();
    const first = new GlText(font, { text: "A", fontSize: 10 });
    const second = new GlText(font, { text: "B", fontSize: 10 });

    first.dispose();

    const secondMaterial = meshOf(second).material as THREE.ShaderMaterial;
    expect(secondMaterial.uniforms.uTexture!.value).toBe(font.texture);
    expect(meshOf(second).count).toBe(1); // "B" still renders fine from the shared font
  });
});
