// test/scenes/hero-can.test.ts
//
// hero-can workstream (CAN CONTRACT owner): can-geometry.ts's pure
// createCanParts/getCanLayout/buildCan, label-texture.ts's createLabelTexture
// (OffscreenCanvas path + the document-canvas/null-2d-context fallback), and
// scene.ts's SceneModule lifecycle against a mock ViewContext (init/update
// idle-spin + pointer-tilt springs + scroll camera pull, reduced-motion
// static-frame branch, dispose bookkeeping, re-runnable init, and the
// "@/lib/engine/gl/text" / AssetManager-job guards degrading silently since
// neither is reachable under the current engine wiring — see the
// workstream report for why).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { ViewContext } from "@/lib/engine/types";
import { AssetManager } from "@/lib/engine/gl/assets";
import { flavorById } from "@/lib/flavors";
import {
  buildCan,
  createCanParts,
  getCanLayout,
  type CanPartsOptions,
} from "@/lib/scenes/hero-can/can-geometry";
import { createLabelTexture } from "@/lib/scenes/hero-can/label-texture";
import createHeroCanScene from "@/lib/scenes/hero-can/scene";
import { easeOutExpo, mapRange } from "@/lib/engine/core/math";
import { computeProgress } from "@/lib/engine/gl/view";

/** Mirrors scene.ts's H1 camera-pull formula exactly, so these tests assert
 * the real eased/windowed shape instead of duplicating a weakened linear
 * approximation of it. `restProgress` is this view's OWN progress at
 * scrollY=0 (~0.5 for a top-pinned, full-viewport-height section like the
 * default `makeCtx()` fixture below — see H1: the hero is the document's
 * first section, so it never actually sees progress 0). */
const SCROLL_CAMERA_PULL = 220;
const PULL_SPAN = 0.25;
function expectedCameraPull(viewProgress: number, restProgress: number): number {
  const t = mapRange(viewProgress, restProgress, Math.min(1, restProgress + PULL_SPAN), 0, 1, true);
  return easeOutExpo(t) * SCROLL_CAMERA_PULL;
}

/** The default `makeCtx()` fixture below is a top-pinned, full-viewport
 * section (rect.top=0, rect.height === size.height), so its rest progress
 * is exactly what `computeProgress` returns at scrollY=0 for that shape. */
const DEFAULT_REST_PROGRESS = computeProgress({ top: 0, left: 0, width: 800, height: 600 }, 0, 600);

const MINT = flavorById("mint");

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

function bbox(geo: THREE.BufferGeometry): THREE.Box3 {
  geo.computeBoundingBox();
  return geo.boundingBox!.clone();
}

// ---------------------------------------------------------------------------
// createCanParts — geometry invariants
// ---------------------------------------------------------------------------

describe("createCanParts — geometry invariants", () => {
  it("returns non-empty BufferGeometry for every part at defaults", () => {
    const parts = createCanParts();
    for (const geo of [parts.shell, parts.lid, parts.tab, parts.labelCylinder]) {
      expect(geo).toBeInstanceOf(THREE.BufferGeometry);
      expect(geo.getAttribute("position").count).toBeGreaterThan(0);
    }
  });

  it("shell's bounding box diameter/height track opts.radius/opts.height", () => {
    const opts: CanPartsOptions = { radius: 50, height: 300, segments: 16 };
    const parts = createCanParts(opts);
    const box = bbox(parts.shell);
    const diameterX = box.max.x - box.min.x;
    const diameterZ = box.max.z - box.min.z;

    // widest profile ring hits exactly opts.radius (sx = radius/82 applied
    // to the widest svg radius, 82) -> full diameter == 2*radius.
    expect(diameterX).toBeCloseTo(opts.radius! * 2, 0);
    expect(diameterZ).toBeCloseTo(opts.radius! * 2, 0);

    const worldHeight = box.max.y - box.min.y;
    // the lathe profile doesn't span the full svg 0..480 range (apex sits
    // at svgY 472, opening at 18) so it's somewhat shorter than opts.height,
    // but well within a reasonable band of it.
    expect(worldHeight).toBeLessThanOrEqual(opts.height!);
    expect(worldHeight).toBeGreaterThan(opts.height! * 0.8);
  });

  it("scaling radius/height independently scales the geometry independently (non-uniform)", () => {
    const wide = createCanParts({ radius: 100, height: 200 });
    const tall = createCanParts({ radius: 20, height: 400 });

    const wideBox = bbox(wide.shell);
    const tallBox = bbox(tall.shell);

    expect(wideBox.max.x - wideBox.min.x).toBeGreaterThan(tallBox.max.x - tallBox.min.x);
    expect(tallBox.max.y - tallBox.min.y).toBeGreaterThan(wideBox.max.y - wideBox.min.y);
  });

  it("lid is a flat disc (near-zero Y extent) with radius matching the top opening", () => {
    const parts = createCanParts({ radius: 82, height: 480 });
    const box = bbox(parts.lid);
    expect(box.max.y - box.min.y).toBeLessThan(1e-4);
    expect((box.max.x - box.min.x) / 2).toBeCloseTo(60, 0); // topDisc rx=60 at default scale
  });

  it("labelCylinder is open-ended (no cap attribute groups) and sits proud of the shell radius", () => {
    const parts = createCanParts({ radius: 82, height: 480 });
    const shellBox = bbox(parts.shell);
    const labelBox = bbox(parts.labelCylinder);
    const shellRadius = (shellBox.max.x - shellBox.min.x) / 2;
    const labelRadius = (labelBox.max.x - labelBox.min.x) / 2;
    expect(labelRadius).toBeGreaterThan(shellRadius * 0.9); // roughly body-radius scale
    expect(labelBox.max.y).toBeGreaterThan(labelBox.min.y); // has real height
  });

  it("segments controls tessellation (more segments -> more vertices)", () => {
    const low = createCanParts({ segments: 6 });
    const high = createCanParts({ segments: 64 });
    expect(high.shell.getAttribute("position").count).toBeGreaterThan(low.shell.getAttribute("position").count);
  });

  it("clamps degenerate/absurd segment counts instead of throwing", () => {
    expect(() => createCanParts({ segments: 0 })).not.toThrow();
    expect(() => createCanParts({ segments: -5 })).not.toThrow();
  });
});

describe("getCanLayout", () => {
  it("matches the SVG-derived defaults (body radius 82, top opening radius 60) at radius=82,height=480", () => {
    const layout = getCanLayout({ radius: 82, height: 480 });
    expect(layout.bodyRadius).toBeCloseTo(82, 5);
    expect(layout.topOpeningRadius).toBeCloseTo(60, 5);
    expect(layout.topOpeningY).toBeGreaterThan(layout.labelTopY);
    expect(layout.labelTopY).toBeGreaterThan(layout.labelBottomY);
  });

  it("scales proportionally with a custom radius", () => {
    const base = getCanLayout({ radius: 82, height: 480 });
    const doubled = getCanLayout({ radius: 164, height: 960 });
    expect(doubled.bodyRadius).toBeCloseTo(base.bodyRadius * 2, 5);
    expect(doubled.topOpeningRadius).toBeCloseTo(base.topOpeningRadius * 2, 5);
  });
});

// ---------------------------------------------------------------------------
// buildCan — group structure + dispose
// ---------------------------------------------------------------------------

describe("buildCan — group structure", () => {
  it("assembles shell/lid/tab/label as a named group", () => {
    const built = buildCan(MINT);
    expect(built.group.name).toBe(`can-${MINT.id}`);
    expect(built.group.children).toEqual([
      built.parts.shell,
      built.parts.lid,
      built.parts.tab,
      built.parts.label,
    ]);
    built.dispose();
  });

  it("uses the passed labelTexture as the label mesh's map when provided", () => {
    const texture = new THREE.Texture();
    const built = buildCan(MINT, { labelTexture: texture });
    const mat = built.parts.label.material as THREE.MeshStandardMaterial;
    expect(mat.map).toBe(texture);
    built.dispose();
    texture.dispose();
  });

  it("keeps every part's metalness token-low, since no envMap is ever wired (F-005 regression)", () => {
    // Regression (design-review F-005): MeshStandardMaterial scales diffuse
    // by (1 - metalness) and expects an environment map to give that energy
    // back as reflections. Every consumer of buildCan lights these cans
    // WITHOUT one (the PMREM job is a documented no-op), so the old values
    // (shell 0.35, lid 0.75, tab 0.85) silently discarded 35-85% of each
    // part's authored color — the "muddy olive cans" finding.
    const built = buildCan(MINT);
    const shell = built.parts.shell.material as THREE.MeshStandardMaterial;
    const lid = built.parts.lid.material as THREE.MeshStandardMaterial;
    const tab = built.parts.tab.material as THREE.MeshStandardMaterial;

    expect(shell.metalness).toBeCloseTo(0.1);
    expect(lid.metalness).toBeCloseTo(0.4);
    expect(tab.metalness).toBeCloseTo(0.45);

    for (const material of [shell, lid, tab]) {
      // The premise of the budget: nothing hands these materials an envMap,
      // so the metalness ceiling has to stay low until one ships.
      expect(material.envMap).toBeNull();
      expect(material.metalness).toBeLessThanOrEqual(0.5);
    }

    built.dispose();
  });

  it("falls back to a flat flavor.accent color when no labelTexture is passed", () => {
    const built = buildCan(MINT);
    const mat = built.parts.label.material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeNull();
    expect(mat.color.getHexString()).toBe(new THREE.Color(MINT.accent).getHexString());
    built.dispose();
  });
});

describe("buildCan — dispose", () => {
  it("frees every geometry and material it created, and detaches all parts from the group", () => {
    const geometryDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDisposeSpy = vi.spyOn(THREE.Material.prototype, "dispose");
    geometryDisposeSpy.mockClear();
    materialDisposeSpy.mockClear();

    const built = buildCan(MINT);
    built.dispose();

    // shell, lid, tab, labelCylinder
    expect(geometryDisposeSpy).toHaveBeenCalledTimes(4);
    // shell, lid, tab, label materials
    expect(materialDisposeSpy).toHaveBeenCalledTimes(4);
    expect(built.group.children.length).toBe(0);

    geometryDisposeSpy.mockRestore();
    materialDisposeSpy.mockRestore();
  });

  it("never disposes a caller-supplied labelTexture — texture ownership stays with the caller", () => {
    const texture = new THREE.Texture();
    const disposeSpy = vi.spyOn(texture, "dispose");
    const built = buildCan(MINT, { labelTexture: texture });

    built.dispose();

    expect(disposeSpy).not.toHaveBeenCalled();
    texture.dispose();
  });
});

// ---------------------------------------------------------------------------
// createLabelTexture
// ---------------------------------------------------------------------------

class FakeCtx2D {
  calls: string[] = [];
  fillStyle = "";
  font = "";
  textAlign = "";
  textBaseline = "";
  globalAlpha = 1;
  fillRect(): void {
    this.calls.push("fillRect");
  }
  fillText(text: string): void {
    this.calls.push(`fillText:${text}`);
  }
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => {} };
  }
  save(): void {}
  restore(): void {}
  translate(): void {}
  scale(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  bezierCurveTo(): void {}
  closePath(): void {}
  fill(): void {}
  stroke(): void {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  private readonly ctx = new FakeCtx2D();
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext(kind: string): FakeCtx2D | null {
    return kind === "2d" ? this.ctx : null;
  }
}

describe("createLabelTexture — document-canvas fallback (default jsdom environment)", () => {
  it("never throws even though jsdom's canvas has no 2D context, and still returns a usable texture", () => {
    expect(typeof OffscreenCanvas).toBe("undefined"); // sanity: confirms this test exercises the fallback path
    let texture: THREE.Texture | undefined;
    expect(() => {
      texture = createLabelTexture(MINT);
    }).not.toThrow();
    expect(texture).toBeInstanceOf(THREE.Texture);
    // `needsUpdate` is a write-only setter on THREE.Texture (reading it back
    // is always `undefined`) — `version` is what actually records the bump.
    expect(texture!.version).toBeGreaterThan(0);
    texture!.dispose();
  });

  it("defaults to a 1024x2048 canvas, overridable via opts", () => {
    const t1 = createLabelTexture(MINT);
    expect((t1.image as HTMLCanvasElement).width).toBe(1024);
    expect((t1.image as HTMLCanvasElement).height).toBe(2048);
    t1.dispose();

    const t2 = createLabelTexture(MINT, { width: 256, height: 512 });
    expect((t2.image as HTMLCanvasElement).width).toBe(256);
    expect((t2.image as HTMLCanvasElement).height).toBe(512);
    t2.dispose();
  });
});

describe("createLabelTexture — OffscreenCanvas path", () => {
  const original = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;

  beforeEach(() => {
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeOffscreenCanvas;
  });

  afterEach(() => {
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = original;
  });

  it("uses `new OffscreenCanvas(w,h)` when available and actually draws into it", () => {
    const texture = createLabelTexture(MINT, { width: 300, height: 600 });
    const canvas = texture.image as FakeOffscreenCanvas;
    expect(canvas).toBeInstanceOf(FakeOffscreenCanvas);
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(600);

    const ctx2d = canvas.getContext("2d") as FakeCtx2D;
    expect(ctx2d.calls).toContain("fillRect"); // background painted
    expect(ctx2d.calls.some((c) => c.startsWith("fillText"))).toBe(true); // wordmark/name/band text drawn
    expect(ctx2d.calls.some((c) => c === `fillText:${MINT.name.toUpperCase()}`)).toBe(true);

    texture.dispose();
  });
});

// ---------------------------------------------------------------------------
// scene.ts — SceneModule lifecycle
// ---------------------------------------------------------------------------

describe("hero-can scene — factory + init", () => {
  it("default export is a factory producing a fresh instance per call", () => {
    const a = createHeroCanScene();
    const b = createHeroCanScene();
    expect(a).not.toBe(b);
  });

  it("adds the can group + ambient + key light to the scene", () => {
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);

    expect(ctx.scene.children.some((o) => o instanceof THREE.Group)).toBe(true);
    expect(ctx.scene.children.filter((o) => o instanceof THREE.Light).length).toBe(2);

    const group = ctx.scene.children.find((o) => o instanceof THREE.Group) as THREE.Group;
    // shell, lid, tab, label (buildCan) + the emissive rim mesh
    expect(group.children.length).toBe(5);

    scene.dispose();
  });

  it("is re-runnable: calling init() again disposes the previous build first, no duplicate children", () => {
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    const firstCount = ctx.scene.children.length;

    scene.init(ctx);
    expect(ctx.scene.children.length).toBe(firstCount);

    scene.dispose();
  });

  it("never throws even when ctx.assets is already start()-ed (AssetManager.add() rejects post-start — PMREM degrade path)", async () => {
    const assets = new AssetManager();
    await assets.start();
    const ctx = makeCtx({ assets });

    const scene = createHeroCanScene();
    expect(() => scene.init(ctx)).not.toThrow();
    scene.dispose();
  });
});

describe("hero-can scene — update: idle spin + pointer tilt + scroll camera pull", () => {
  it("advances idle rotation over time when motion is not reduced", () => {
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    const group = ctx.scene.children.find((o) => o instanceof THREE.Group) as THREE.Group;

    scene.update(1 / 60, ctx);
    const afterOneFrame = group.rotation.y;
    expect(afterOneFrame).toBeGreaterThan(0);

    scene.update(1 / 60, ctx);
    expect(group.rotation.y).toBeGreaterThan(afterOneFrame);

    scene.dispose();
  });

  it("springs the tilt toward the pointer position over repeated updates", () => {
    const scene = createHeroCanScene();
    const ctx = makeCtx({ pointer: { x: 1, y: -1, vx: 0, vy: 0, down: false, inside: true } });
    scene.init(ctx);
    const group = ctx.scene.children.find((o) => o instanceof THREE.Group) as THREE.Group;

    for (let i = 0; i < 240; i++) scene.update(1 / 60, ctx);

    // pointer.x=1 -> targetTiltZ = -TILT_MAX; pointer.y=-1 -> targetTiltX = -TILT_MAX
    expect(group.rotation.z).toBeLessThan(0);
    expect(group.rotation.x).toBeLessThan(0);
    expect(Math.abs(group.rotation.z)).toBeGreaterThan(0.15); // converged close to TILT_MAX (0.22)
    expect(Math.abs(group.rotation.x)).toBeGreaterThan(0.15);

    scene.dispose();
  });

  it("F1 fix: reduced motion — no idle spin, no pointer tilt (static frame)", () => {
    // F1: this used to also assert a camera-pull value at onProgress(0.5),
    // certifying a state production can never reach — Stage only calls
    // update() (which is what drives onProgress downstream) when
    // !reducedMotion (see worker/host.ts, worker/render.worker.ts), so under
    // real reduced motion this scene's update()/onProgress() are never
    // invoked at all. The camera-pull math itself is covered by the
    // non-reduced-motion tests below, where it's actually reachable.
    const scene = createHeroCanScene();
    const ctx = makeCtx({
      reducedMotion: true,
      pointer: { x: 1, y: 1, vx: 0, vy: 0, down: false, inside: true },
    });
    scene.init(ctx);
    const group = ctx.scene.children.find((o) => o instanceof THREE.Group) as THREE.Group;

    scene.update(1 / 60, ctx);
    scene.update(1 / 60, ctx);

    expect(group.rotation.y).toBe(0);
    expect(group.rotation.x).toBe(0);
    expect(group.rotation.z).toBe(0);

    scene.dispose();
  });

  it("BUG C2 regression: camera pull is driven by onProgress()'s per-view progress, NOT ctx.scroll.progress (the global document fraction)", () => {
    // Before the C2 fix, `update()` read `ctx.scroll.progress` directly. The
    // hero view is culled from view (and its OWN progress pegged near 1)
    // after roughly 1/6 of the full page's scroll, so a global progress
    // this small (0.05) would never move the camera at all under the old
    // code even though the hero's own span is well past its rest point.
    const scene = createHeroCanScene();
    const ctx = makeCtx({ scroll: { target: 0, current: 0, velocity: 0, progress: 0.05, limit: 1000 } });
    scene.init(ctx);
    const baseZ = ctx.camera.position.z;
    const p = DEFAULT_REST_PROGRESS + PULL_SPAN * 0.5; // reachable: partway through this view's own pull band

    scene.onProgress?.(p); // this view's own progress, independent of ctx.scroll.progress
    scene.update(1 / 60, ctx);

    expect(ctx.camera.position.z).toBeCloseTo(baseZ + expectedCameraPull(p, DEFAULT_REST_PROGRESS), 5);
    expect(ctx.camera.position.z).not.toBeCloseTo(baseZ + ctx.scroll.progress * 220, 2);

    scene.dispose();
  });

  it("H1 regression: at this view's own rest progress (its progress at scrollY=0) the pull is exactly 0", () => {
    // The hero is the document's FIRST section, so at scrollY=0 its OWN
    // per-view progress is ~0.5, not 0 (see gl/view.ts's computeProgress).
    // Pre-fix, `clamp(p*2,0,1)` assumed progress started at 0, so
    // onProgress(~0.5) already read `clamp(1,0,1)=1` -> the camera sat
    // FULLY pulled back (baseZ+220) on the very first frame, before any
    // scroll happened at all. This assertion (pull===0 at rest) would FAIL
    // against that pre-fix code, which produced baseZ+220 here instead.
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    const baseZ = ctx.camera.position.z;

    scene.onProgress?.(DEFAULT_REST_PROGRESS);
    scene.update(1 / 60, ctx);
    expect(ctx.camera.position.z).toBe(baseZ);

    scene.dispose();
  });

  it("H1: pull increases monotonically above rest progress, reaching the full 220 within PULL_SPAN, then holds", () => {
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    const baseZ = ctx.camera.position.z;

    const samples = [
      DEFAULT_REST_PROGRESS,
      DEFAULT_REST_PROGRESS + PULL_SPAN * 0.25,
      DEFAULT_REST_PROGRESS + PULL_SPAN * 0.5,
      DEFAULT_REST_PROGRESS + PULL_SPAN * 0.75,
      DEFAULT_REST_PROGRESS + PULL_SPAN,
    ];
    const zs = samples.map((p) => {
      scene.onProgress?.(p);
      scene.update(1 / 60, ctx);
      return ctx.camera.position.z;
    });

    for (let i = 1; i < zs.length; i++) {
      expect(zs[i]).toBeGreaterThan(zs[i - 1]);
    }
    expect(zs[0]).toBe(baseZ);
    expect(zs[zs.length - 1]).toBeCloseTo(baseZ + 220, 5);

    // Past the full-pull point, it holds at the max instead of continuing
    // to push the camera further back.
    scene.onProgress?.(1);
    scene.update(1 / 60, ctx);
    expect(ctx.camera.position.z).toBeCloseTo(baseZ + 220, 5);

    scene.dispose();
  });

  it("H1: a top-pinned, full-viewport section (rect.top 0, height === viewportH) has rest progress ≈ 0.5, not 0", () => {
    // Locks the 0.5-vs-0 assumption down so it can't silently regress: with
    // the default fixture's rect (top:0, height:600) and viewport
    // (size.height:600), progress just BELOW 0.5 must still read as fully
    // at-rest (pull 0) and progress just ABOVE 0.5 must already show
    // measurable pull — which only holds if restProgress is actually ~0.5
    // here, not 0.
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    const baseZ = ctx.camera.position.z;

    expect(DEFAULT_REST_PROGRESS).toBeCloseTo(0.5, 5);

    scene.onProgress?.(0.4);
    scene.update(1 / 60, ctx);
    expect(ctx.camera.position.z).toBe(baseZ); // still below rest -> no pull

    scene.onProgress?.(0.5);
    scene.update(1 / 60, ctx);
    expect(ctx.camera.position.z).toBe(baseZ); // exactly at rest -> no pull

    scene.onProgress?.(0.51);
    scene.update(1 / 60, ctx);
    expect(ctx.camera.position.z).toBeGreaterThan(baseZ); // just above rest -> pull begins

    scene.dispose();
  });

  it("update() is a no-op before init()", () => {
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    expect(() => scene.update(1 / 60, ctx)).not.toThrow();
  });
});

describe("hero-can scene — dispose", () => {
  it("frees every geometry/material and detaches the group + lights from the scene", () => {
    const geometryDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDisposeSpy = vi.spyOn(THREE.Material.prototype, "dispose");
    geometryDisposeSpy.mockClear();
    materialDisposeSpy.mockClear();

    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    expect(ctx.scene.children.length).toBeGreaterThan(0);

    scene.dispose();

    // buildCan: shell, lid, tab, labelCylinder (4) + rim torus (1) = 5
    expect(geometryDisposeSpy).toHaveBeenCalledTimes(5);
    // buildCan: shell, lid, tab, label materials (4) + rim material (1) = 5
    expect(materialDisposeSpy).toHaveBeenCalledTimes(5);
    expect(ctx.scene.children.length).toBe(0);

    geometryDisposeSpy.mockRestore();
    materialDisposeSpy.mockRestore();
  });

  it("disposes its own createLabelTexture()-created texture", () => {
    const disposeSpy = vi.spyOn(THREE.Texture.prototype, "dispose");
    disposeSpy.mockClear();

    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    scene.dispose();

    expect(disposeSpy).toHaveBeenCalled();
    disposeSpy.mockRestore();
  });

  it("is safe to call twice, and safe to call without a prior init()", () => {
    const scene = createHeroCanScene();
    expect(() => scene.dispose()).not.toThrow();

    const ctx = makeCtx();
    scene.init(ctx);
    scene.dispose();
    expect(() => scene.dispose()).not.toThrow();
  });
});

describe("hero-can scene — GL headline degrade path (@/lib/engine/gl/text not implemented yet)", () => {
  it("does not throw and adds no extra scene children once the missing-module import settles", async () => {
    const scene = createHeroCanScene();
    const ctx = makeCtx();
    scene.init(ctx);
    const countBeforeSettle = ctx.scene.children.length;

    // Let the dynamic import's rejection (module not found) and the
    // catch block inside loadHeadlineText() settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.scene.children.length).toBe(countBeforeSettle);

    scene.dispose();
  });
});
