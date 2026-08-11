// test/engine/gl/post.test.ts
//
// gl/post.ts: the pure enable policy, and the `Post` chain itself.
//
// The chain IS testable in jsdom, contrary to what this module's header used
// to assume: `postprocessing`'s EffectComposer only reads
// `getSize`/`getDrawingBufferSize`/`getContext().getContextAttributes()` off
// the renderer while it is being built, and does not touch GL until
// `render()` — so a recording fake renderer covers construction, pass
// composition, the scene/camera swap, resize, policy changes and disposal.
// What still cannot be covered here is a real `composer.render()` (it
// rasterizes), so that call is asserted through the one branch that is
// observable: enabled => composer, disabled => the caller's fallback.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Post, shouldEnablePost, type PostLike, type PostOptions } from "@/lib/engine/gl/post";
import { RisoGrainEffect } from "@/lib/engine/gl/shaders/riso";

interface FakeRenderer {
  size: { width: number; height: number };
  setSizeCalls: { width: number; height: number; updateStyle: unknown }[];
}

/**
 * Everything EffectComposer/addPass reads before GL is involved. It tracks its
 * own size the way a real renderer does (this repo never calls
 * `setPixelRatio`, so drawing-buffer size == the size it was handed).
 */
function fakeRenderer(width = 800, height = 600): THREE.WebGLRenderer & FakeRenderer {
  const state: FakeRenderer = { size: { width, height }, setSizeCalls: [] };
  return {
    ...state,
    autoClear: true,
    outputColorSpace: THREE.SRGBColorSpace,
    getSize: (target: THREE.Vector2) => target.set(state.size.width, state.size.height),
    getDrawingBufferSize: (target: THREE.Vector2) => target.set(state.size.width, state.size.height),
    getContext: () => ({ getContextAttributes: () => ({ alpha: true }) }),
    setSize: (w: number, h: number, updateStyle?: boolean) => {
      state.setSizeCalls.push({ width: w, height: h, updateStyle });
      state.size = { width: w, height: h };
    },
  } as unknown as THREE.WebGLRenderer & FakeRenderer;
}

function passesOf(post: Post): unknown[] {
  return (post.composer as unknown as { passes: unknown[] }).passes;
}

function makePost(opts: PostOptions = {}): Post {
  return new Post(fakeRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera(45, 1, 0.1, 1000), opts);
}

describe("shouldEnablePost", () => {
  it("is enabled on high/medium tier with motion allowed", () => {
    expect(shouldEnablePost("high", false)).toBe(true);
    expect(shouldEnablePost("medium", false)).toBe(true);
  });

  it("is disabled on the low tier regardless of reduced motion", () => {
    expect(shouldEnablePost("low", false)).toBe(false);
    expect(shouldEnablePost("low", true)).toBe(false);
  });

  it("is disabled under reduced motion regardless of tier", () => {
    expect(shouldEnablePost("high", true)).toBe(false);
    expect(shouldEnablePost("medium", true)).toBe(false);
  });

  it("is enabled only when both conditions are favorable", () => {
    expect(shouldEnablePost("medium", false)).toBe(true);
  });
});

describe("Post — chain composition", () => {
  it("builds RenderPass + bloom/SMAA pass, and adds the riso pass last on the riso route", () => {
    const post = makePost({ quality: "high", reducedMotion: false, route: "/" });

    expect(post.grain).toBeInstanceOf(RisoGrainEffect);
    const passes = passesOf(post);
    expect(passes).toHaveLength(3);
    // Grain must land AFTER antialiasing or SMAA smooths the ink cells away.
    const grainPass = passes[2] as { effects?: unknown[] };
    expect(grainPass.effects).toEqual([post.grain]);
    // …and in its own pass: postprocessing merges co-passed effects into one
    // global scope, where riso's simplex3d/fbm would collide with anything
    // else concatenating gl/shaders/noise.ts.
    expect(grainPass.effects).toHaveLength(1);

    post.dispose();
  });

  it("omits the riso pass entirely off the riso route", () => {
    const post = makePost({ quality: "high", reducedMotion: false, route: "/deep-wave" });

    expect(post.grain).toBeNull();
    expect(passesOf(post)).toHaveLength(2);

    post.dispose();
  });

  it("omits the riso pass on the low tier, where the DOM fallback takes over", () => {
    const post = makePost({ quality: "low", reducedMotion: false, route: "/" });

    expect(post.grain).toBeNull();
    expect(passesOf(post)).toHaveLength(2);

    post.dispose();
  });

  it("builds no grain at all when the caller cannot name its route", () => {
    // Deliberately distinct from passing `""`: riso.ts normalises an empty
    // path to "/", so an "unknown route" default of "" would silently grain
    // every page. Omission has to mean nothing, not everything.
    const unknown = makePost({ quality: "high", reducedMotion: false });
    const empty = makePost({ quality: "high", reducedMotion: false, route: "" });

    expect(unknown.grain).toBeNull();
    expect(empty.grain).toBeInstanceOf(RisoGrainEffect);

    unknown.dispose();
    empty.dispose();
  });

  it("builds the grain with a frozen clock under reduced motion and a running one otherwise", () => {
    const still = makePost({ quality: "high", reducedMotion: true, route: "/" });
    const moving = makePost({ quality: "high", reducedMotion: false, route: "/" });

    expect(still.grain!.animated).toBe(false);
    expect(moving.grain!.animated).toBe(true);

    still.dispose();
    moving.dispose();
  });

  it("forwards grain tuning to the effect", () => {
    const post = makePost({ route: "/", grain: { intensity: 0.9, speed: 3 } });
    const uniforms = post.grain!.uniforms;

    expect((uniforms.get("uIntensity") as { value: number }).value).toBeCloseTo(0.9, 6);
    expect((uniforms.get("uSpeed") as { value: number }).value).toBeCloseTo(3, 6);

    post.dispose();
  });
});

describe("Post — enable policy", () => {
  it("starts enabled on a high tier with motion allowed and disabled on the low tier", () => {
    const high = makePost({ quality: "high", reducedMotion: false });
    const low = makePost({ quality: "low", reducedMotion: false });

    expect(high.isEnabled).toBe(true);
    expect(low.isEnabled).toBe(false);

    high.dispose();
    low.dispose();
  });

  it("render() delegates to the composer when enabled and to the caller's fallback when not", () => {
    const post = makePost({ quality: "high", reducedMotion: false });
    const composerRender = vi.spyOn(post.composer, "render").mockImplementation(() => {});
    const fallback = vi.fn();

    post.render(0.016, fallback);
    expect(composerRender).toHaveBeenCalledWith(0.016);
    expect(fallback).not.toHaveBeenCalled();

    post.disable();
    post.render(0.016, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(composerRender).toHaveBeenCalledTimes(1); // unchanged

    post.enable();
    post.render(0.02, fallback);
    expect(composerRender).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);

    post.dispose();
  });

  it("setPolicy re-applies both gates: the chain goes dark under reduced motion and the grain clock freezes with it", () => {
    const post = makePost({ quality: "high", reducedMotion: false, route: "/" });
    expect(post.isEnabled).toBe(true);
    expect(post.grain!.animated).toBe(true);

    post.setPolicy("high", true);
    expect(post.isEnabled).toBe(false);
    expect(post.grain!.animated).toBe(false);

    post.setPolicy("high", false);
    expect(post.isEnabled).toBe(true);
    expect(post.grain!.animated).toBe(true);

    // A tier drop disables the chain even with motion allowed.
    post.setPolicy("low", false);
    expect(post.isEnabled).toBe(false);

    post.dispose();
  });

  it("setPolicy cannot conjure a grain pass that was never built (a rebuild is required)", () => {
    // Built on the low tier: the policy said "DOM fallback", so there is no
    // GPU pass to re-enable when the tier is later re-reported as high.
    const post = makePost({ quality: "low", reducedMotion: false, route: "/" });
    expect(post.grain).toBeNull();

    post.setPolicy("high", false);
    expect(post.grain).toBeNull();
    expect(passesOf(post)).toHaveLength(2);
    expect(post.isEnabled).toBe(true); // bloom/SMAA do come back

    post.dispose();
  });
});

describe("Post — per-frame view retargeting", () => {
  it("re-points every pass at another view's scene/camera", () => {
    const post = makePost({ route: "/" });
    const setMainScene = vi.spyOn(post.composer, "setMainScene");
    const setMainCamera = vi.spyOn(post.composer, "setMainCamera");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 1000);

    post.setSceneCamera(scene, camera);

    expect(setMainScene).toHaveBeenCalledWith(scene);
    expect(setMainCamera).toHaveBeenCalledWith(camera);
    expect(post.target).toEqual({ scene, camera });

    post.dispose();
  });

  it("is a no-op when nothing changed, so Stage can call it every frame", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const post = new Post(fakeRenderer(), scene, camera, { route: "/" });
    const setMainScene = vi.spyOn(post.composer, "setMainScene");

    post.setSceneCamera(scene, camera);
    expect(setMainScene).not.toHaveBeenCalled();

    post.setSceneCamera(new THREE.Scene(), camera);
    expect(setMainScene).toHaveBeenCalledTimes(1);

    post.dispose();
  });
});

describe("Post — size and disposal", () => {
  it("setSize resizes the composer's buffers", () => {
    const post = makePost();
    post.setSize(1280, 720);

    expect(post.composer.inputBuffer.width).toBe(1280);
    expect(post.composer.inputBuffer.height).toBe(720);
    expect(post.composer.outputBuffer.width).toBe(1280);

    post.dispose();
  });

  it("never asks the renderer to restyle the canvas — that would throw on the worker's OffscreenCanvas", () => {
    const renderer = fakeRenderer(800, 600);
    const post = new Post(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), {});

    post.setSize(1280, 720);

    // The composer forwards to renderer.setSize whenever its own size
    // disagrees; three.js writes canvas.style.width/height unless told not to,
    // and an OffscreenCanvas has no `.style`.
    expect(renderer.setSizeCalls.length).toBeGreaterThan(0);
    for (const call of renderer.setSizeCalls) expect(call.updateStyle).toBe(false);

    post.dispose();
  });

  it("dispose() disposes every pass, including the riso pass, through the composer", () => {
    const post = makePost({ route: "/" });
    const passDisposals = passesOf(post).map((pass) =>
      vi.spyOn(pass as { dispose: () => void }, "dispose")
    );
    expect(passDisposals).toHaveLength(3);

    post.dispose();

    for (const spy of passDisposals) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("setBloom updates the live bloom effect rather than rebuilding the pass", () => {
    const post = makePost();
    const before = [...passesOf(post)];

    post.setBloom(2.5, 0.25);

    expect(post.bloom.intensity).toBeCloseTo(2.5, 6);
    expect(post.bloom.luminanceMaterial.threshold).toBeCloseTo(0.25, 6);
    expect(passesOf(post)).toEqual(before); // same pass objects, no rebuild

    post.dispose();
  });
});

describe("PostLike — the seam Stage depends on", () => {
  it("is satisfied by the real Post, so Stage's mock and its production chain cannot diverge", () => {
    const post = makePost({ route: "/" });
    const asSeam: PostLike = post;

    expect(asSeam.isEnabled).toBe(post.isEnabled);
    asSeam.setPolicy("high", false);
    asSeam.setSize(640, 480);
    expect(post.composer.inputBuffer.width).toBe(640);

    asSeam.dispose();
  });
});
