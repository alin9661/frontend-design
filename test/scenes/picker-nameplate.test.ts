// test/scenes/picker-nameplate.test.ts
//
// lib/scenes/picker/scene.ts's GL flavor nameplate, specifically the F-001
// placement fix: the name used to float at view center, where it duplicated
// SectionPicker's DOM flavor heading in the copy column. It's now parked
// under the carousel column, below the settled can's bottom rim.
//
// `@/lib/engine/gl/text` is mocked here (test/scenes/picker.test.ts runs
// against the real module): under jsdom loadFont() rejects — no MSDF atlas
// to fetch, no OffscreenCanvas for the SDF fallback — and scene.ts treats
// that as a decorative-only degrade, so the nameplate is otherwise
// unreachable in a unit test.

import { describe, expect, it, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { AssetManager, ViewContext } from "@/lib/engine/types";

const glTextInstances: Array<{ object3d: THREE.Object3D; dispose: ReturnType<typeof vi.fn> }> = [];

vi.mock("@/lib/engine/gl/text", () => ({
  loadFont: vi.fn(async () => ({ mode: "sdf" as const, texture: new THREE.Texture() })),
  GlText: vi.fn().mockImplementation(function GlText() {
    const instance = {
      object3d: new THREE.Object3D(),
      width: 300,
      height: 36,
      setText: vi.fn(),
      setColor: vi.fn(),
      setOpacity: vi.fn(),
      dispose: vi.fn(),
    };
    glTextInstances.push(instance);
    return instance;
  }),
}));

import { GlText } from "@/lib/engine/gl/text";
import createPickerScene from "@/lib/scenes/picker/scene";
import { cameraDistanceForHeight } from "@/lib/engine/gl/view";
import { flavors } from "@/lib/flavors";

const RING_X_OFFSET_FACTOR = 0.3;
/** buildCan's default can height (480) centered on y=0 -> bottom rim at -240. */
const CAN_BOTTOM_RIM_Y = -240;

function makeFakeAssets(): AssetManager {
  return {
    add: () => {},
    get: () => {
      throw new Error("makeFakeAssets: nothing loaded");
    },
    start: async () => {},
    onProgress: () => () => {},
  };
}

/** World-z the nameplate sits at (mirrors NAMEPLATE_Z in the scene). */
const NAMEPLATE_Z = 40;

/** Visible half-height at `z`, the same frustum math the scene uses. The
 * frustum narrows toward the camera, so this is always LESS than
 * `rect.height / 2` for a z in front of the z=0 plane. */
function visibleHalfHeightAt(camera: THREE.PerspectiveCamera, z: number): number {
  return Math.tan((camera.fov * Math.PI) / 360) * Math.max(1, camera.position.z - z);
}

/** Where the nameplate should land for a given context. */
function expectedNameplateY(ctx: ViewContext): number {
  return -visibleHalfHeightAt(ctx.camera, NAMEPLATE_Z) * 0.68;
}

function makeViewContext(overrides: Partial<ViewContext> = {}): ViewContext {
  const rect = overrides.rect ?? { top: 0, left: 0, width: 500, height: 500 };
  const camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 10000);
  // Production's View always does this (gl/view.ts: `camera.position.z =
  // cameraDistanceForHeight(rect.height)`), which is what makes 1 world unit
  // == 1 CSS px at z=0. Leaving it at the THREE default of 0 gave this
  // fixture a degenerate frustum that no real view ever has.
  camera.position.z = cameraDistanceForHeight(rect.height);
  return {
    scene: new THREE.Scene(),
    camera,
    rect,
    scroll: { target: 0, current: 0, velocity: 0, progress: 0, limit: 1000 },
    pointer: { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false },
    assets: makeFakeAssets(),
    size: { width: 500, height: 500, dpr: 1 },
    quality: "high",
    reducedMotion: false,
    ...overrides,
  };
}

beforeEach(() => {
  glTextInstances.length = 0;
  vi.mocked(GlText).mockClear();
});

describe("picker scene — GL flavor nameplate placement (F-001)", () => {
  it("parks the nameplate under the carousel column, below the settled can's bottom rim", async () => {
    const scene = createPickerScene();
    const ctx = makeViewContext();
    await scene.init(ctx);

    expect(glTextInstances).toHaveLength(1);
    const nameplate = glTextInstances[0]!.object3d;

    // Regression: this used to be `position.set(0, -160, 40)` — dead center
    // horizontally, where it collided with the DOM flavor heading.
    expect(nameplate.position.x).not.toBe(0);
    expect(nameplate.position.x).toBeCloseTo(ctx.rect.width * RING_X_OFFSET_FACTOR);
    expect(nameplate.position.y).toBeCloseTo(expectedNameplateY(ctx));
    expect(nameplate.position.z).toBe(NAMEPLATE_Z);

    // The placement must be INSIDE the frustum at its own depth. A flat
    // `-0.6 * rect.height` (the previous formula) is not: the frustum
    // narrows toward the camera, so 0.6 of the full height overshoots the
    // bottom edge on every view — on a real 900px viewport by ~90px, i.e.
    // the nameplate rendered off-screen entirely.
    const halfHeight = visibleHalfHeightAt(ctx.camera, NAMEPLATE_Z);
    expect(Math.abs(nameplate.position.y)).toBeLessThan(halfHeight);
    expect(ctx.rect.height * 0.6).toBeGreaterThan(halfHeight);

    scene.dispose();
  });

  it("H3 regression: after a resize, the nameplate's x/y track the live ctx, same as the ring group's own x", async () => {
    // Pre-fix, the nameplate's position was set ONCE inside
    // loadFont().then()'s init-time ctx closure and never revisited, while
    // ringGroup's own x IS recomputed from the live ctx every applyFrame()
    // call (scene.ts's update()) — so a resize moved the ring but left the
    // nameplate parked at its stale x/y. This assertion would FAIL against
    // that pre-fix code: the nameplate would still read the ORIGINAL
    // (500-width/500-height-derived) position after the resize + a frame.
    const scene = createPickerScene();
    const ctx = makeViewContext();
    await scene.init(ctx);
    const nameplate = glTextInstances[0]!.object3d;

    const resized = makeViewContext({ rect: { top: 0, left: 0, width: 900, height: 700 } });
    scene.update(1 / 60, resized);

    expect(nameplate.position.x).toBeCloseTo(resized.rect.width * RING_X_OFFSET_FACTOR);
    expect(nameplate.position.y).toBeCloseTo(expectedNameplateY(resized));
    expect(Math.abs(nameplate.position.y)).toBeLessThan(
      visibleHalfHeightAt(resized.camera, NAMEPLATE_Z)
    );
    // Still tracks the ring group's own x exactly, per this file's own
    // "same x offset as ringGroup" placement comment.
    const root = ctx.scene.children[0] as THREE.Group;
    const ringGroup = root.children.find(
      (c) => c instanceof THREE.Group && c !== nameplate
    ) as THREE.Group;
    expect(nameplate.position.x).toBeCloseTo(ringGroup.position.x);

    scene.dispose();
  });

  it("names the currently selected flavor and hangs off the non-rotating root, not the ring", async () => {
    const scene = createPickerScene();
    const ctx = makeViewContext();
    await scene.init(ctx);

    // The nameplate must stay screen-facing regardless of carousel rotation,
    // so it's a child of root rather than of the rotating ring group.
    const root = ctx.scene.children[0] as THREE.Group;
    const nameplate = glTextInstances[0]!.object3d;
    expect(root.children).toContain(nameplate);

    const opts = vi.mocked(GlText).mock.calls[0]![1] as { text: string; align?: string };
    expect(opts.text).toBe(flavors[0]!.name);
    expect(opts.align).toBe("center");

    scene.dispose();
  });
});

describe("picker nameplate — frustum bounds across viewport heights", () => {
  it("clears the settled can on a desktop-height view, and stays on-screen on a short one", async () => {
    // Two regimes, both real:
    //  - Tall (900px, the desktop case): the 480-unit can fits, so the
    //    nameplate should sit BELOW its bottom rim as the F-001 placement
    //    intends, and still inside the frustum.
    //  - Short (500px): the can is taller than the visible half-height, so
    //    "below the rim" is geometrically unsatisfiable — staying inside the
    //    frustum wins. The old `-0.6 * rect.height` satisfied NEITHER: it
    //    was outside the bottom edge in both regimes.
    for (const height of [900, 500]) {
      const scene = createPickerScene();
      const ctx = makeViewContext({
        rect: { top: 0, left: 0, width: 1440, height },
      });
      await scene.init(ctx);

      const nameplate = glTextInstances[glTextInstances.length - 1]!.object3d;
      const halfHeight = visibleHalfHeightAt(ctx.camera, NAMEPLATE_Z);

      expect(nameplate.position.y).toBeLessThan(0);
      expect(Math.abs(nameplate.position.y)).toBeLessThan(halfHeight);
      // The formula this replaced would have been off-screen at both heights.
      expect(height * 0.6).toBeGreaterThan(halfHeight);

      if (height === 900) {
        expect(nameplate.position.y).toBeLessThan(CAN_BOTTOM_RIM_Y);
      }

      scene.dispose();
    }
  });
});
