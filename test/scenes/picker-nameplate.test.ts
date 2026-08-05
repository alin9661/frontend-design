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

function makeViewContext(overrides: Partial<ViewContext> = {}): ViewContext {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(45, 1, 0.1, 10000),
    rect: { top: 0, left: 0, width: 500, height: 500 },
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
    expect(nameplate.position.y).toBe(-300);
    expect(nameplate.position.y).toBeLessThan(CAN_BOTTOM_RIM_Y);
    expect(nameplate.position.z).toBe(40);

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
    expect(nameplate.position.y).toBeCloseTo(-resized.rect.height * 0.6);
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
