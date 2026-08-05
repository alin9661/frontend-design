// test/scenes/hero-can-headline.test.ts
//
// lib/scenes/hero-can/scene.ts's GL headline layer, specifically the F-001
// watermark treatment: the headline used to render at fontSize 64, full
// opacity, with its baseline INSIDE the can silhouette — the can occluded
// the middle of every glyph and the fragments poking out around the rim read
// as a z-fighting bug, while the DOM <h1> already carried the same words at
// full strength. It's now an intentional oversized, low-opacity backdrop
// pushed well behind the can.
//
// `@/lib/engine/gl/text` is mocked here (unlike test/scenes/hero-can.test.ts,
// which exercises the real module's degrade path): loadFont() can't succeed
// under jsdom — no MSDF atlas to fetch and no OffscreenCanvas for the SDF
// fallback — so the headline branch is otherwise unreachable in a unit test.

import { describe, expect, it, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { ViewContext } from "@/lib/engine/types";

const glTextInstances: Array<{ object3d: THREE.Object3D; dispose: ReturnType<typeof vi.fn> }> = [];

vi.mock("@/lib/engine/gl/text", () => ({
  loadFont: vi.fn(async () => ({ mode: "sdf" as const, texture: new THREE.Texture() })),
  GlText: vi.fn().mockImplementation(function GlText() {
    const instance = {
      object3d: new THREE.Object3D(),
      width: 400,
      height: 150,
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
import { getCanLayout } from "@/lib/scenes/hero-can/can-geometry";
import createHeroCanScene from "@/lib/scenes/hero-can/scene";

const CAN_X_OFFSET_FACTOR = 0.28;
const CAN_SCALE_FACTOR = 1.6;

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

/** Lets the dynamic `import()` + loadFont() promise chain in
 * loadHeadlineText() settle before assertions run. */
async function settleHeadline(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The Group the scene parents both headline lines under. */
function headlineGroupIn(ctx: ViewContext): THREE.Group {
  const group = ctx.scene.children.find(
    (o): o is THREE.Group =>
      o instanceof THREE.Group && glTextInstances.some((t) => o.children.includes(t.object3d))
  );
  if (!group) throw new Error("headline group was never added to the scene");
  return group;
}

beforeEach(() => {
  glTextInstances.length = 0;
  vi.mocked(GlText).mockClear();
});

describe("hero-can scene — GL headline watermark (F-001)", () => {
  it("renders both headline lines oversized and low-opacity, as texture rather than copy", async () => {
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    await settleHeadline();

    expect(glTextInstances).toHaveLength(2); // "SMOOTH LIFT." / "ZERO CRASH."

    const calls = vi.mocked(GlText).mock.calls;
    const texts = calls.map((call) => (call[1] as { text: string }).text);
    expect(texts).toEqual(["SMOOTH LIFT.", "ZERO CRASH."]);

    for (const call of calls) {
      const opts = call[1] as { fontSize: number; opacity?: number; glow?: number; color?: number };
      expect(opts.fontSize).toBe(150); // oversized backdrop, not a 64px headline
      expect(opts.opacity).toBeCloseTo(0.14); // the DOM <h1> is the full-strength copy
      expect(opts.glow).toBeCloseTo(0.25); // toned down from the old 1.4 accent glow
      expect(opts.color).toBe(0x1d423c); // brand.forest — must read against the cream bg
    }

    scene.dispose();
  });

  it("parks the watermark plane well behind the can, still paired with the can's x offset", async () => {
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    await settleHeadline();

    const group = headlineGroupIn(ctx);
    const canFrontZ = getCanLayout().bodyRadius * CAN_SCALE_FACTOR;

    // Regression: the plane used to sit at z = bodyRadius * 0.05, i.e.
    // inside the can silhouette, so glyphs intersected the can body.
    expect(group.position.z).toBe(-320);
    expect(group.position.z).toBeLessThan(-canFrontZ);
    // Paired with the can's own composition offset, not dead center.
    expect(group.position.x).toBeCloseTo(ctx.rect.width * CAN_X_OFFSET_FACTOR);
    // Two lines, stacked downward from the block's top.
    expect(group.children).toHaveLength(2);
    expect(group.children[1]!.position.y).toBeLessThan(group.children[0]!.position.y);

    scene.dispose();
  });

  it("detaches the watermark and disposes both lines on dispose", async () => {
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    await settleHeadline();

    const group = headlineGroupIn(ctx);
    expect(ctx.scene.children).toContain(group);

    scene.dispose();

    expect(ctx.scene.children).not.toContain(group);
    for (const instance of glTextInstances) {
      expect(instance.dispose).toHaveBeenCalledTimes(1);
    }
  });
});
