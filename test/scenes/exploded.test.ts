// test/scenes/exploded.test.ts
//
// lib/scenes/exploded/scene.ts — the can-decomposition scene. Covers:
// exact Timeline-driven positions/rotations at p=0/0.5/1 (against the
// scene's own exported EXPLODE_TARGETS so the assertions can't silently
// drift from the implementation), scrub-down-then-up returning to the
// assembled (p=0) state exactly, leader-line opacity/geometry tracking
// progress, and dispose bookkeeping (every geometry/material freed, the
// can group + lights + lines detached, buildCan's own dispose() invoked).
//
// The can contract (lib/scenes/hero-can/can-geometry.ts) is owned by a
// parallel workstream and may not exist yet, so it's mocked here with real
// THREE objects positioned at the origin — that keeps "base" (the p=0
// assembled pose the scene captures per part) at exactly 0 for every can
// part, which is what makes the exact-position assertions below clean.

import { describe, expect, it, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { ViewContext } from "@/lib/engine/types";

vi.mock("@/lib/scenes/hero-can/can-geometry", () => ({
  buildCan: vi.fn(() => {
    const group = new THREE.Group();
    const makePart = () =>
      new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial());
    const shell = makePart();
    const lid = makePart();
    const tab = makePart();
    const label = makePart();
    group.add(shell, lid, tab, label);
    return {
      group,
      parts: { shell, lid, tab, label },
      dispose: vi.fn(),
    };
  }),
}));

import { buildCan } from "@/lib/scenes/hero-can/can-geometry";
import createExplodedScene, {
  EXPLODE_DEADZONE_END,
  EXPLODE_DEADZONE_START,
  EXPLODE_TARGETS,
  LEADER_LINE_FADE_IN_END,
  LEADER_LINE_FADE_IN_START,
} from "@/lib/scenes/exploded/scene";
import { easeInOutCubic } from "@/lib/engine/core/math";

function makeCtx(overrides: Partial<ViewContext> = {}): ViewContext {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(45, 1, 0.1, 1000),
    rect: { top: 0, left: 0, width: 800, height: 600 },
    scroll: { target: 0, current: 0, velocity: 0, progress: 0, limit: 1000 },
    pointer: { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false },
    assets: {
      add: () => {},
      get: () => {
        throw new Error("n/a");
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

function latestBuilt() {
  const mocked = vi.mocked(buildCan);
  const result = mocked.mock.results[mocked.mock.results.length - 1];
  if (!result || result.type !== "return") throw new Error("buildCan was not called");
  return result.value as {
    group: THREE.Group;
    parts: { shell: THREE.Mesh; lid: THREE.Mesh; tab: THREE.Mesh; label: THREE.Mesh };
    dispose: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.mocked(buildCan).mockClear();
});

describe("exploded scene — Timeline-driven positions at fixed progress (C1: dead zone + eased middle)", () => {
  it("stays fully assembled through the entry dead zone (p=0..0.25)", () => {
    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);
    const { lid, tab, label } = latestBuilt().parts;

    for (const p of [0, 0.1, EXPLODE_DEADZONE_START]) {
      scene.onProgress?.(p);
      expect(lid.position.y).toBe(0);
      expect(tab.rotation.z).toBe(0);
      expect(label.rotation.z).toBe(0);
    }

    scene.dispose();
  });

  it("is fully exploded through the exit dead zone (p=0.75..1)", () => {
    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);
    const { lid, tab, label } = latestBuilt().parts;

    for (const p of [EXPLODE_DEADZONE_END, 0.9, 1]) {
      scene.onProgress?.(p);
      expect(lid.position.y).toBeCloseTo(EXPLODE_TARGETS.lid.y);
      expect(tab.rotation.z).toBeCloseTo(EXPLODE_TARGETS.tab.rotZ);
      expect(label.rotation.z).toBeCloseTo(EXPLODE_TARGETS.label.rotZ);
    }

    scene.dispose();
  });

  it("eases (not linearly interpolates) through the readable middle, matching easeInOutCubic exactly", () => {
    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);
    const { lid, tab, label } = latestBuilt().parts;

    // p=0.5 sits at the midpoint of the [0.25, 0.75] dead-zone window ->
    // localT=0.5, and easeInOutCubic(0.5) is exactly 0.5, so this point
    // coincidentally matches a linear half-explode — verified separately at
    // an off-center point (p=0.4) below where linear and eased diverge.
    scene.onProgress?.(0.5);
    expect(lid.position.y).toBeCloseTo(EXPLODE_TARGETS.lid.y * 0.5);

    const localT = (0.4 - EXPLODE_DEADZONE_START) / (EXPLODE_DEADZONE_END - EXPLODE_DEADZONE_START);
    const eased = easeInOutCubic(localT);
    scene.onProgress?.(0.4);
    expect(lid.position.y).toBeCloseTo(EXPLODE_TARGETS.lid.y * eased);
    expect(tab.rotation.z).toBeCloseTo(EXPLODE_TARGETS.tab.rotZ * eased);
    expect(label.rotation.z).toBeCloseTo(EXPLODE_TARGETS.label.rotZ * eased);
    // Sanity: eased progress at p=0.4 (localT=0.3) is behind a naive linear
    // 0.3 fraction — ease-in-out starts slow, confirming this isn't secretly
    // still linear.
    expect(eased).toBeLessThan(localT);

    scene.dispose();
  });

  it("lands the shell (which explodes downward, negative y) at exact fractions too", () => {
    const scene = createExplodedScene();
    scene.init(makeCtx());
    const { shell } = latestBuilt().parts;

    scene.onProgress?.(0.5);
    expect(shell.position.y).toBeCloseTo(EXPLODE_TARGETS.shell.y * 0.5);
    expect(EXPLODE_TARGETS.shell.y).toBeLessThan(0);

    scene.dispose();
  });

  it("procedural leaf planes explode from their own (non-zero) authored base pose", () => {
    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);

    // Leaves aren't part of the mocked can contract — the scene builds them
    // itself as children of the can group, so recover one from the scene
    // graph instead of the mock.
    let leaf: THREE.Mesh | undefined;
    ctx.scene.traverse((o) => {
      if (!leaf && o instanceof THREE.Mesh && o.geometry.type === "ShapeGeometry") leaf = o;
    });
    expect(leaf).toBeDefined();
    const found = leaf!;
    const baseY = found.position.y;
    const baseRotZ = found.rotation.z;

    scene.onProgress?.(0);
    expect(found.position.y).toBeCloseTo(baseY);
    expect(found.rotation.z).toBeCloseTo(baseRotZ);

    scene.onProgress?.(1);
    // One of the three leaves' target — whichever this one is, base+target
    // must land on exactly one of the three authored EXPLODE_TARGETS leaf
    // entries since every leaf uses the same y/rotZ additive scheme.
    const candidates = [EXPLODE_TARGETS.leaf0, EXPLODE_TARGETS.leaf1, EXPLODE_TARGETS.leaf2];
    const matched = candidates.some(
      (t) =>
        Math.abs(found.position.y - (baseY + t.y)) < 1e-6 &&
        Math.abs(found.rotation.z - (baseRotZ + t.rotZ)) < 1e-6
    );
    expect(matched).toBe(true);

    scene.dispose();
  });
});

describe("exploded scene — scrub both directions", () => {
  it("returns to the exact assembled (p=0) pose after scrubbing up then back down", () => {
    const scene = createExplodedScene();
    scene.init(makeCtx());
    const { lid, tab } = latestBuilt().parts;

    scene.onProgress?.(0);
    const initialLidY = lid.position.y;
    const initialTabRotZ = tab.rotation.z;
    expect(initialLidY).toBe(0);
    expect(initialTabRotZ).toBe(0);

    scene.onProgress?.(1);
    expect(lid.position.y).not.toBe(initialLidY);

    scene.onProgress?.(0.5);
    scene.onProgress?.(0);

    expect(lid.position.y).toBe(initialLidY);
    expect(tab.rotation.z).toBe(initialTabRotZ);

    scene.dispose();
  });
});

describe("exploded scene — leader lines (N7: windowed smoothstep fade-in)", () => {
  it("stays invisible before the fade-in window and fully on after it", () => {
    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const lines = ctx.scene.children.filter((o): o is THREE.Line => o instanceof THREE.Line);
    expect(lines.length).toBeGreaterThan(0);
    const material = lines[0]!.material as THREE.LineBasicMaterial;

    scene.onProgress?.(0);
    expect(material.opacity).toBeCloseTo(0);

    scene.onProgress?.(LEADER_LINE_FADE_IN_START);
    expect(material.opacity).toBeCloseTo(0);

    scene.onProgress?.(LEADER_LINE_FADE_IN_END);
    expect(material.opacity).toBeCloseTo(0.7);

    scene.onProgress?.(1);
    expect(material.opacity).toBeCloseTo(0.7);

    const positions = lines[0]!.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(positions.count).toBe(3); // 2-segment elbow == 3 points

    scene.dispose();
  });

  it("arrives as a deliberate beat AFTER the explosion is underway, not a straight-line fade across the whole span", () => {
    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const lines = ctx.scene.children.filter((o): o is THREE.Line => o instanceof THREE.Line);
    const material = lines[0]!.material as THREE.LineBasicMaterial;

    // Midpoint of the fade window: smoothstep(0.5) is exactly 0.5, so
    // opacity here is exactly half of the base 0.7 — unlike the old raw
    // `0.7 * p` behavior, which would already be well past that at p=0.475.
    const mid = (LEADER_LINE_FADE_IN_START + LEADER_LINE_FADE_IN_END) / 2;
    scene.onProgress?.(mid);
    expect(material.opacity).toBeCloseTo(0.35);

    // A point still inside the explosion's own dead zone (p=0.2, parts
    // haven't started separating yet) must show zero leader-line opacity —
    // confirms the lines don't preempt the explosion.
    scene.onProgress?.(0.2);
    expect(material.opacity).toBeCloseTo(0);

    scene.dispose();
  });
});

describe("exploded scene — legibility rig (F-002)", () => {
  it("builds the can with a real printed label texture, and owns disposing it", () => {
    // Regression (design-review F-002): without a labelTexture, buildCan's
    // label band falls back to solid `flavor.accent` — for mint a near-black
    // slab against this section's dark background.
    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const opts = vi.mocked(buildCan).mock.calls[0]![1] as { labelTexture?: THREE.Texture } | undefined;
    expect(opts?.labelTexture).toBeInstanceOf(THREE.Texture);

    // The scene created the texture, so its dispose() must be chained onto
    // the can's own — buildCan never disposes a caller-supplied texture.
    const textureDispose = vi.spyOn(opts!.labelTexture!, "dispose");
    scene.dispose();
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it("F3 regression: also disposes the previous instance's label texture on re-init (context-loss restore), not just on dispose()", () => {
    // init() re-runs by calling this.dispose() first (context-loss restore
    // contract — see this file's "is re-runnable" test below), which is
    // what should chain into the label texture's own dispose(). Only
    // BufferGeometry/Material disposal was ever spied in the "dispose
    // bookkeeping" suite below, so dropping the texture dispose from
    // canDispose would stay green there — this pins it directly, on the
    // re-init path specifically (dispose() alone is already covered by the
    // test just above).
    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const firstOpts = vi.mocked(buildCan).mock.calls[0]![1] as { labelTexture?: THREE.Texture };
    const firstTexture = firstOpts.labelTexture!;
    const firstTextureDispose = vi.spyOn(firstTexture, "dispose");

    scene.init(ctx); // simulate context-loss restore re-running init on the SAME instance

    expect(firstTextureDispose).toHaveBeenCalledTimes(1);

    scene.dispose();
  });

  it("H5 regression: sizes the label texture down from createLabelTexture's default (this can renders small and mostly disassembled)", () => {
    // Pre-fix, this called `createLabelTexture(flavor)` with no size options
    // — the full 1024x2048 default, byte-identical to hero-can's own
    // full-size texture for the same mint flavor (~8.4MB RGBA each, picker
    // adds five more full-size ones on top). This assertion would FAIL
    // against that pre-fix code: the canvas would be 1024x2048, not smaller.
    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const opts = vi.mocked(buildCan).mock.calls[0]![1] as { labelTexture?: THREE.Texture } | undefined;
    const canvas = opts?.labelTexture?.image as { width: number; height: number };
    expect(canvas.width).toBeLessThan(1024);
    expect(canvas.height).toBeLessThan(2048);
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(1024);

    scene.dispose();
  });

  it("lights the assembly with ambient + a camera-side key + a cool rim from behind-left, and removes all three on dispose", () => {
    // Regression (design-review F-002): at the old ambient 0.5 / key 1.0
    // from (1,1,1), mint's label sat too close in value to the forest
    // background and the assembly read as a black silhouette.
    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const lights = ctx.scene.children.filter((o): o is THREE.Light => o instanceof THREE.Light);
    expect(lights).toHaveLength(3);

    const ambient = lights.find((l) => l instanceof THREE.AmbientLight)!;
    expect(ambient.intensity).toBeCloseTo(0.75);

    const directionals = lights.filter(
      (l): l is THREE.DirectionalLight => l instanceof THREE.DirectionalLight
    );
    const key = directionals.find((l) => l.color.getHex() === 0xffffff)!;
    expect(key.intensity).toBeCloseTo(1.5);
    expect(key.position.z).toBeGreaterThan(0); // pulled toward the camera

    const rim = directionals.find((l) => l.color.getHex() !== 0xffffff)!;
    expect(rim.color.getHex()).toBe(0xcfe8dd); // cool, to cut the silhouette off the bg
    expect(rim.intensity).toBeCloseTo(0.9);
    expect(rim.position.x).toBeLessThan(0); // behind-left
    expect(rim.position.z).toBeLessThan(0);

    scene.dispose();
    expect(ctx.scene.children.filter((o) => o instanceof THREE.Light)).toHaveLength(0);
  });
});

describe("exploded scene — dispose bookkeeping", () => {
  it("frees every geometry/material it created and detaches everything from the scene", () => {
    const geometryDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDisposeSpy = vi.spyOn(THREE.Material.prototype, "dispose");
    geometryDisposeSpy.mockClear();
    materialDisposeSpy.mockClear();

    const scene = createExplodedScene();
    const ctx = makeCtx();
    scene.init(ctx);
    const built = latestBuilt();
    scene.onProgress?.(0.5);

    expect(ctx.scene.children).toContain(built.group);
    expect(ctx.scene.children.some((o) => o instanceof THREE.Line)).toBe(true);

    scene.dispose();

    // 1 shared leaf ShapeGeometry + 7 leader-line BufferGeometries (lid, tab,
    // shell, label, leaf0, leaf1, leaf2).
    expect(geometryDisposeSpy).toHaveBeenCalledTimes(8);
    // 3 leaf materials + 1 shared leader-line material.
    expect(materialDisposeSpy).toHaveBeenCalledTimes(4);

    expect(built.dispose).toHaveBeenCalledTimes(1);
    expect(ctx.scene.children).not.toContain(built.group);
    expect(ctx.scene.children.some((o) => o instanceof THREE.Line)).toBe(false);
    expect(ctx.scene.children.some((o) => o instanceof THREE.Light)).toBe(false);

    geometryDisposeSpy.mockRestore();
    materialDisposeSpy.mockRestore();
  });

  it("is re-runnable: calling init() again disposes the previous instance before rebuilding", () => {
    const scene = createExplodedScene();
    const ctx = makeCtx();

    scene.init(ctx);
    const firstBuilt = latestBuilt();
    scene.onProgress?.(1);

    scene.init(ctx); // simulate context-loss restore re-running init on the SAME instance
    const secondBuilt = latestBuilt();

    expect(firstBuilt.dispose).toHaveBeenCalledTimes(1);
    expect(secondBuilt).not.toBe(firstBuilt);
    expect(ctx.scene.children).toContain(secondBuilt.group);
    expect(ctx.scene.children).not.toContain(firstBuilt.group);

    // Fresh instance starts back at the assembled pose regardless of the
    // previous instance having been mid-explode.
    scene.onProgress?.(0);
    expect(secondBuilt.parts.lid.position.y).toBe(0);

    scene.dispose();
  });
});
