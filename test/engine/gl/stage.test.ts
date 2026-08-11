// test/engine/gl/stage.test.ts
//
// gl/stage.ts against the RendererLike mock (types.ts): addView/removeView
// lifecycle, render-order (insertion order) and culling (off-screen views
// never reach renderer.render), and dispose bookkeeping — every view's
// SceneModule.dispose() is called, freeing whatever THREE resources it
// tracked.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Stage, type StageFrameInput } from "@/lib/engine/gl/stage";
import type { PostLike } from "@/lib/engine/gl/post";
import type { RectData, RendererLike, SceneModule, ViewContext } from "@/lib/engine/types";

function mockRenderer(): RendererLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setSize: () => calls.push("setSize"),
    setScissor: (x, y, w, h) => calls.push(`setScissor(${x},${y},${w},${h})`),
    setScissorTest: (on) => calls.push(`setScissorTest(${on})`),
    setViewport: (x, y, w, h) => calls.push(`setViewport(${x},${y},${w},${h})`),
    render: () => calls.push("render"),
    dispose: () => calls.push("dispose"),
  };
}

function baseFrame(overrides: Partial<StageFrameInput> = {}): StageFrameInput {
  return {
    scroll: { target: 0, current: 0, velocity: 0, progress: 0, limit: 1000 },
    pointer: { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false },
    size: { width: 800, height: 800, dpr: 1 },
    quality: "high",
    reducedMotion: false,
    assets: { add: () => {}, get: () => { throw new Error("n/a"); }, start: async () => {}, onProgress: () => () => {} },
    ...overrides,
  };
}

/** A SceneModule that tracks its own resource bookkeeping like a real one would. */
function trackedScene(): SceneModule & { disposed: boolean; initCount: number; updateCalls: number } {
  const state = { disposed: false, initCount: 0, updateCalls: 0 };
  return {
    ...state,
    get disposed() { return state.disposed; },
    get initCount() { return state.initCount; },
    get updateCalls() { return state.updateCalls; },
    init: () => { state.initCount++; },
    update: () => { state.updateCalls++; },
    dispose: () => { state.disposed = true; },
  } as SceneModule & { disposed: boolean; initCount: number; updateCalls: number };
}

async function flush(): Promise<void> {
  // Stage.addView's init() promise resolution is queued on a microtask.
  await Promise.resolve();
  await Promise.resolve();
}

describe("Stage.addView / removeView", () => {
  it("reports a view ready exactly once after successful init and never reports a rejecting init", async () => {
    const onViewReady = vi.fn();
    const onError = vi.fn();
    const stage = new Stage(mockRenderer(), baseFrame(), { onViewReady, onError });
    const readyScene: SceneModule = {
      init: async () => {},
      update: () => {},
      dispose: () => {},
    };
    const rejected = new Error("scene init failed");
    const rejectedScene: SceneModule = {
      init: () => Promise.reject(rejected),
      update: () => {},
      dispose: () => {},
    };

    stage.addView(7, { top: 0, left: 0, width: 100, height: 100 }, readyScene);
    stage.addView(8, { top: 0, left: 0, width: 100, height: 100 }, rejectedScene);
    await flush();

    expect(onViewReady).toHaveBeenCalledTimes(1);
    expect(onViewReady).toHaveBeenCalledWith(7);
    expect(onError).toHaveBeenCalledWith(rejected, 8);
  });

  it("does not report ready for a view removed while its init was still in flight", async () => {
    // The readiness signal is what tells the main thread it may drop its 2D
    // fallback art. A view that has been torn down mid-init will never draw a
    // pixel, so announcing it would hide the fallback over nothing.
    const onViewReady = vi.fn();
    const stage = new Stage(mockRenderer(), baseFrame(), { onViewReady });
    let resolveInit: () => void = () => {};
    const slowScene: SceneModule = {
      init: () => new Promise<void>((resolve) => { resolveInit = resolve; }),
      update: () => {},
      dispose: () => {},
    };

    stage.addView(9, { top: 0, left: 0, width: 100, height: 100 }, slowScene);
    stage.removeView(9);
    resolveInit();
    await flush();

    expect(onViewReady).not.toHaveBeenCalled();
  });

  it("re-announces readiness after a context-restore reinit, and stays silent for one that throws", async () => {
    const onViewReady = vi.fn();
    const onError = vi.fn();
    const stage = new Stage(mockRenderer(), baseFrame(), { onViewReady, onError });
    let initCalls = 0;
    const flaky: SceneModule = {
      init: () => {
        initCalls++;
        // First init (addView) and the first reinit succeed; the second
        // reinit throws, as a shader recompile can on a downgraded context.
        if (initCalls === 3) throw new Error("shader recompile failed");
      },
      update: () => {},
      dispose: () => {},
    };

    stage.addView(3, { top: 0, left: 0, width: 100, height: 100 }, flaky);
    await flush();
    expect(onViewReady).toHaveBeenCalledTimes(1);

    await stage.reinit();
    expect(onViewReady).toHaveBeenCalledTimes(2);
    expect(onViewReady).toHaveBeenLastCalledWith(3);

    await stage.reinit();
    expect(onViewReady).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports ready for the surviving re-add when a viewId is recycled mid-init", async () => {
    // Same guard, opposite branch: the stale promise must stay silent but the
    // live instance registered under the recycled id must still be announced.
    const onViewReady = vi.fn();
    const stage = new Stage(mockRenderer(), baseFrame(), { onViewReady });
    let resolveStale: () => void = () => {};
    const staleScene: SceneModule = {
      init: () => new Promise<void>((resolve) => { resolveStale = resolve; }),
      update: () => {},
      dispose: () => {},
    };

    stage.addView(9, { top: 0, left: 0, width: 100, height: 100 }, staleScene);
    stage.removeView(9);
    stage.addView(9, { top: 0, left: 0, width: 100, height: 100 }, trackedScene());
    await flush();
    resolveStale();
    await flush();

    expect(onViewReady).toHaveBeenCalledTimes(1);
    expect(onViewReady).toHaveBeenCalledWith(9);
  });

  it("addView calls module.init with a ViewContext built from the current frame", async () => {
    const renderer = mockRenderer();
    const frame = baseFrame();
    const stage = new Stage(renderer, frame);
    let seenCtx: ViewContext | null = null;
    const scene: SceneModule = {
      init: (ctx) => { seenCtx = ctx; },
      update: () => {},
      dispose: () => {},
    };
    const rect: RectData = { top: 0, left: 0, width: 300, height: 300 };

    stage.addView(1, rect, scene);
    await flush();

    expect(seenCtx).not.toBeNull();
    expect(seenCtx!.rect).toEqual(rect);
    expect(seenCtx!.quality).toBe("high");
    expect(seenCtx!.size).toEqual(frame.size);
  });

  it("throws when adding a duplicate viewId", () => {
    const stage = new Stage(mockRenderer(), baseFrame());
    stage.addView(1, { top: 0, left: 0, width: 10, height: 10 }, trackedScene());
    expect(() => stage.addView(1, { top: 0, left: 0, width: 10, height: 10 }, trackedScene())).toThrow();
  });

  it("removeView disposes the module and drops it from the render set", async () => {
    const renderer = mockRenderer();
    const stage = new Stage(renderer, baseFrame());
    const scene = trackedScene();
    stage.addView(1, { top: 0, left: 0, width: 100, height: 100 }, scene);
    await flush();
    expect(stage.size).toBe(1);

    stage.removeView(1);
    expect(scene.disposed).toBe(true);
    expect(stage.size).toBe(0);
  });

  it("removeView on an unknown viewId is a no-op (does not throw)", () => {
    const stage = new Stage(mockRenderer(), baseFrame());
    expect(() => stage.removeView(999)).not.toThrow();
  });

  it("updateRect re-runs the view's camera math without re-initing the module", async () => {
    const renderer = mockRenderer();
    const stage = new Stage(renderer, baseFrame());
    const scene = trackedScene();
    stage.addView(1, { top: 0, left: 0, width: 100, height: 100 }, scene);
    await flush();
    expect(scene.initCount).toBe(1);

    stage.updateRect(1, { top: 0, left: 0, width: 400, height: 400 });
    expect(scene.initCount).toBe(1); // unchanged — updateRect isn't a re-init
  });

  it("forwards a main-thread progress to onProgress instead of the rect-derived value", async () => {
    const seen: number[] = [];
    const scene: SceneModule = {
      init: () => {},
      update: () => {},
      dispose: () => {},
      onProgress: (p) => seen.push(p),
    };
    const stage = new Stage(mockRenderer(), baseFrame());
    // A pinned, viewport-tall rect: rect-derived progress is a constant 0.5
    // no matter how far the page has scrolled, which is exactly the sticky
    // failure the override exists to fix.
    const pinned: RectData = { top: 0, left: 0, width: 800, height: 800 };
    stage.addView(1, pinned, scene);
    await flush();

    stage.updateRect(1, pinned);
    stage.update(0.016);
    expect(seen.at(-1)).toBeCloseTo(0.5, 6);

    stage.updateRect(1, pinned, 0.83);
    stage.update(0.016);
    expect(seen.at(-1)).toBe(0.83);

    // Omitting it again drops back to the rect.
    stage.updateRect(1, pinned);
    stage.update(0.016);
    expect(seen.at(-1)).toBeCloseTo(0.5, 6);
  });
});

describe("Stage.render — culling + render order", () => {
  it("renders only in-view views, skipping off-screen ones entirely", async () => {
    const renderer = mockRenderer();
    const frame = baseFrame({ size: { width: 800, height: 800, dpr: 1 } });
    const stage = new Stage(renderer, frame);

    stage.addView(1, { top: 0, left: 0, width: 100, height: 100 }, trackedScene()); // in view
    stage.addView(2, { top: 5000, left: 0, width: 100, height: 100 }, trackedScene()); // far off-screen
    await flush();

    renderer.calls.length = 0; // ignore setup noise
    stage.render();

    const renderCalls = renderer.calls.filter((c) => c === "render");
    expect(renderCalls).toHaveLength(1); // only the in-view one rendered
  });

  it("renders in view insertion order", async () => {
    const makeScene = (): SceneModule => ({
      init: () => {},
      update: () => {},
      dispose: () => {},
    });

    // Distinct `left` per view + a spy on setScissor's x arg reveals render order.
    const scissorXs: number[] = [];
    const spyRenderer: RendererLike = {
      ...mockRenderer(),
      setScissor: (x) => scissorXs.push(x),
    };
    const stage = new Stage(spyRenderer, baseFrame());
    stage.addView(3, { top: 0, left: 0, width: 100, height: 100 }, makeScene());
    stage.addView(1, { top: 0, left: 200, width: 100, height: 100 }, makeScene());
    stage.addView(2, { top: 0, left: 400, width: 100, height: 100 }, makeScene());
    await flush();
    stage.render();

    // Insertion order was 3, 1, 2 -> lefts 0, 200, 400 in that order.
    expect(scissorXs).toEqual([0, 200, 400]);
  });

  it("resets renderer.info once per render() call when present, so a real THREE draw-call count accumulates across every view instead of reflecting only the last one (BUG B3 stats fix)", async () => {
    const renderer = mockRenderer();
    let resetCalls = 0;
    (renderer as RendererLike).info = {
      autoReset: true,
      reset: () => {
        resetCalls++;
      },
      render: { calls: 0 },
    };
    const stage = new Stage(renderer, baseFrame());
    stage.addView(1, { top: 0, left: 0, width: 100, height: 100 }, trackedScene());
    stage.addView(2, { top: 0, left: 200, width: 100, height: 100 }, trackedScene());
    await flush();

    stage.render();
    expect(resetCalls).toBe(1); // once per Stage.render(), not once per view
  });

  it("does not throw when renderer.info is absent (plain RendererLike mocks, the common test double)", async () => {
    const renderer = mockRenderer(); // no .info set
    const stage = new Stage(renderer, baseFrame());
    stage.addView(1, { top: 0, left: 0, width: 100, height: 100 }, trackedScene());
    await flush();

    expect(() => stage.render()).not.toThrow();
  });

  it("skips a view whose module has not finished init() yet", () => {
    const renderer = mockRenderer();
    const stage = new Stage(renderer, baseFrame());
    let resolveInit!: () => void;
    const scene: SceneModule = {
      init: () => new Promise<void>((resolve) => { resolveInit = resolve; }),
      update: () => {},
      dispose: () => {},
    };
    stage.addView(1, { top: 0, left: 0, width: 100, height: 100 }, scene);
    // Deliberately do NOT await — init hasn't resolved yet.
    stage.render();
    expect(renderer.calls).not.toContain("render");
    resolveInit();
  });
});

describe("Stage.update", () => {
  it("calls module.update and onProgress only for in-view, ready views", async () => {
    const stage = new Stage(mockRenderer(), baseFrame());
    const onProgress = vi.fn();
    let updateCalls = 0;
    const inViewScene: SceneModule = {
      init: () => {},
      update: () => { updateCalls++; },
      onProgress,
      dispose: () => {},
    };
    let offscreenUpdateCalls = 0;
    const offscreenScene: SceneModule = {
      init: () => {},
      update: () => { offscreenUpdateCalls++; },
      dispose: () => {},
    };

    stage.addView(1, { top: 0, left: 0, width: 100, height: 100 }, inViewScene);
    stage.addView(2, { top: 9000, left: 0, width: 100, height: 100 }, offscreenScene);
    await flush();

    stage.update(0.016);

    expect(updateCalls).toBe(1);
    expect(offscreenUpdateCalls).toBe(0);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });
});

describe("Stage.dispose — bookkeeping", () => {
  it("disposes every remaining view's module and clears the view set", async () => {
    const stage = new Stage(mockRenderer(), baseFrame());
    const a = trackedScene();
    const b = trackedScene();
    stage.addView(1, { top: 0, left: 0, width: 10, height: 10 }, a);
    stage.addView(2, { top: 0, left: 0, width: 10, height: 10 }, b);
    await flush();

    stage.dispose();

    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(true);
    expect(stage.size).toBe(0);
  });
});

describe("Stage.raycastCandidates — registerInteractive wiring", () => {
  it("returns no candidates for a view that never calls registerInteractive", async () => {
    const stage = new Stage(mockRenderer(), baseFrame());
    stage.addView(1, { top: 0, left: 0, width: 100, height: 100 }, trackedScene());
    await flush();

    expect(stage.raycastCandidates()).toEqual([]);
  });

  it("returns a candidate for a view that registers interactive objects via its ViewContext, in view", async () => {
    const stage = new Stage(mockRenderer(), baseFrame());
    let registered: unknown[] = [];
    const scene: SceneModule = {
      init: (ctx) => {
        registered = [{}, {}];
        ctx.registerInteractive?.(registered as never);
      },
      update: () => {},
      dispose: () => {},
    };
    stage.addView(1, { top: 0, left: 0, width: 100, height: 100 }, scene);
    await flush();

    const candidates = stage.raycastCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.viewId).toBe(1);
    expect(candidates[0]!.targets).toEqual(registered);
    expect(candidates[0]!.module).toBe(scene);
  });

  it("excludes a registered view that is currently off-screen", async () => {
    const stage = new Stage(mockRenderer(), baseFrame({ size: { width: 800, height: 800, dpr: 1 } }));
    const scene: SceneModule = {
      init: (ctx) => ctx.registerInteractive?.([{} as never]),
      update: () => {},
      dispose: () => {},
    };
    stage.addView(1, { top: 9000, left: 0, width: 100, height: 100 }, scene); // far off-screen
    await flush();

    expect(stage.raycastCandidates()).toEqual([]);
  });

  it("excludes a registered view that hasn't finished init() yet", () => {
    const stage = new Stage(mockRenderer(), baseFrame());
    let resolveInit!: () => void;
    const scene: SceneModule = {
      init: (ctx) =>
        new Promise<void>((resolve) => {
          ctx.registerInteractive?.([{} as never]);
          resolveInit = resolve;
        }),
      update: () => {},
      dispose: () => {},
    };
    stage.addView(1, { top: 0, left: 0, width: 100, height: 100 }, scene);
    // Not awaited — init() hasn't resolved, so `managed.ready` is still false.
    expect(stage.raycastCandidates()).toEqual([]);
    resolveInit();
  });
});

describe("Stage.currentFrame", () => {
  it("reflects the frame most recently passed to setFrame()", () => {
    const stage = new Stage(mockRenderer(), baseFrame());
    const nextFrame = baseFrame({ pointer: { x: 0.5, y: -0.5, vx: 1, vy: 2, down: true, inside: true } });
    stage.setFrame(nextFrame);
    expect(stage.currentFrame).toEqual(nextFrame);
  });
});

describe("Stage.reinit — context-loss restore contract", () => {
  it("re-runs init() on every tracked view (re-runnable per SceneModule contract)", async () => {
    const stage = new Stage(mockRenderer(), baseFrame());
    const scene = trackedScene();
    stage.addView(1, { top: 0, left: 0, width: 10, height: 10 }, scene);
    await flush();
    expect(scene.initCount).toBe(1);

    await stage.reinit();
    expect(scene.initCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Additive post-M0-freeze seams: the GPGPU renderer + FloatSupport handed to
// scenes through ViewContext, and the post chain Stage now actually drives.
// ---------------------------------------------------------------------------

/** A RendererLike that also answers the render-to-texture calls Gpgpu.compute() makes. */
function gpgpuCapableRenderer(): RendererLike & { targets: unknown[] } {
  const targets: unknown[] = [];
  return {
    ...mockRenderer(),
    targets,
    setRenderTarget: (target: unknown) => targets.push(target),
  } as RendererLike & { targets: unknown[] };
}

/** A fake WebGL context whose extension list decides the FloatSupport verdict. */
function fakeGlContext(extensions: string[], webgl2 = true): WebGL2RenderingContext {
  const ctx: Record<string, unknown> = {
    getExtension: (name: string) => (extensions.includes(name) ? {} : null),
  };
  if (webgl2) ctx.texStorage2D = () => {};
  return ctx as unknown as WebGL2RenderingContext;
}

function recordingPost(overrides: Partial<PostLike> = {}) {
  const calls: string[] = [];
  const state = { enabled: true };
  const post = {
    calls,
    state,
    get isEnabled() {
      return state.enabled;
    },
    setSceneCamera: (scene: THREE.Scene, camera: THREE.Camera) => {
      calls.push(`setSceneCamera(${scene.uuid === camera.uuid ? "same" : "pair"})`);
      post.lastTarget = { scene, camera };
    },
    setPolicy: (quality: string, reducedMotion: boolean) => calls.push(`setPolicy(${quality},${reducedMotion})`),
    setSize: (w: number, h: number) => calls.push(`setSize(${w},${h})`),
    render: (dt: number, fallback: () => void) => {
      calls.push(`render(${dt})`);
      if (!state.enabled) fallback();
    },
    dispose: () => calls.push("dispose"),
    lastTarget: null as { scene: THREE.Scene; camera: THREE.Camera } | null,
    ...overrides,
  };
  return post;
}

const FULL_RECT: RectData = { top: 0, left: 0, width: 800, height: 800 };

describe("Stage — ViewContext GPGPU seam (types.ts ViewContext.renderer / .floatSupport)", () => {
  it("hands a scene the narrow render-to-texture seam when the renderer has one", async () => {
    const renderer = gpgpuCapableRenderer();
    const stage = new Stage(renderer, baseFrame());
    let seen: ViewContext | null = null;
    stage.addView(1, FULL_RECT, {
      init: (ctx) => {
        seen = ctx;
      },
      update: () => {},
      dispose: () => {},
    });
    await flush();

    // Narrow on purpose: it is the Gpgpu seam, not the whole renderer, but it
    // must be the SAME object so a compute pass targets the live context.
    expect(seen!.renderer).toBe(renderer);
    seen!.renderer!.setRenderTarget(null);
    expect(renderer.targets).toEqual([null]);
  });

  it("omits the seam for a plain RendererLike mock, so a scene knows to hold its pose", async () => {
    const stage = new Stage(mockRenderer(), baseFrame()); // no setRenderTarget
    let seen: ViewContext | null = null;
    stage.addView(1, FULL_RECT, {
      init: (ctx) => {
        seen = ctx;
      },
      update: () => {},
      dispose: () => {},
    });
    await flush();

    expect(seen!.renderer).toBeUndefined();
  });

  it("probes the float verdict off the renderer's context, once, and shares it with every view", async () => {
    let probes = 0;
    const renderer: RendererLike = {
      ...mockRenderer(),
      getContext: () => {
        probes++;
        return fakeGlContext(["EXT_color_buffer_float"]);
      },
    };
    const stage = new Stage(renderer, baseFrame());
    const seen: (string | undefined)[] = [];
    const spy = (): SceneModule => ({
      init: (ctx) => {
        seen.push(ctx.floatSupport);
      },
      update: (_dt, ctx) => {
        seen.push(ctx.floatSupport);
      },
      dispose: () => {},
    });

    stage.addView(1, FULL_RECT, spy());
    stage.addView(2, { top: 0, left: 0, width: 100, height: 100 }, spy());
    await flush();
    stage.update(0.016);

    expect(seen).toEqual(["float", "float", "float", "float"]);
    expect(probes).toBe(1); // memoized — a capability of the context, not of a view
  });

  it("reports half-float when only half-float targets are renderable", async () => {
    const renderer: RendererLike = {
      ...mockRenderer(),
      getContext: () => fakeGlContext(["EXT_color_buffer_half_float"]),
    };
    const stage = new Stage(renderer, baseFrame());
    expect(stage.floatSupport).toBe("half-float");
  });

  it("reports 'none' — never a hopeful 'float' — when the renderer cannot hand over a context", () => {
    const stage = new Stage(mockRenderer(), baseFrame()); // no getContext
    expect(stage.floatSupport).toBe("none");
  });

  it("reports 'none' for a context with no renderability extensions at all", () => {
    const renderer: RendererLike = { ...mockRenderer(), getContext: () => fakeGlContext([]) };
    expect(new Stage(renderer, baseFrame()).floatSupport).toBe("none");
  });

  it("prefers an explicitly injected verdict over probing", () => {
    let probes = 0;
    const renderer: RendererLike = {
      ...mockRenderer(),
      getContext: () => {
        probes++;
        return fakeGlContext(["EXT_color_buffer_float"]);
      },
    };
    const stage = new Stage(renderer, baseFrame(), { floatSupport: "none" });

    expect(stage.floatSupport).toBe("none");
    expect(probes).toBe(0);
  });

  it("re-probes after a context restore, because a downgraded context can lose float targets", async () => {
    let extensions = ["EXT_color_buffer_float"];
    const renderer: RendererLike = { ...mockRenderer(), getContext: () => fakeGlContext(extensions) };
    const stage = new Stage(renderer, baseFrame());
    stage.addView(1, FULL_RECT, trackedScene());
    await flush();
    expect(stage.floatSupport).toBe("float");

    extensions = []; // software fallback context after the loss
    await stage.reinit();

    expect(stage.floatSupport).toBe("none");
  });
});

describe("Stage.render — post chain gating (a shared composer cannot serve N scissored views)", () => {
  function postStage(opts: { views: number; post?: boolean; rect?: RectData } = { views: 1 }) {
    const renderer = mockRenderer();
    const post = recordingPost();
    const created: unknown[] = [];
    const stage = new Stage(renderer, baseFrame(), {
      route: "/",
      createPost: (input) => {
        created.push(input);
        return post as unknown as PostLike;
      },
    });
    return { renderer, post, created, stage };
  }

  it("runs a single full-canvas opted-in view through the composer instead of the scissored path", async () => {
    const { renderer, post, created, stage } = postStage();
    stage.addView(1, FULL_RECT, trackedScene(), { post: true });
    await flush();

    renderer.calls.length = 0;
    stage.update(0.02);
    stage.render();

    expect(created).toHaveLength(1);
    expect(post.calls).toContain("render(0.02)"); // dt carried over from update()
    // The composer owns the whole buffer: scissoring would clip its fullscreen
    // quads and clears, and a stale per-view viewport would squeeze its output.
    expect(renderer.calls).toContain("setScissorTest(false)");
    expect(renderer.calls).toContain("setViewport(0,0,800,800)");
    expect(renderer.calls).not.toContain("render"); // no direct per-view draw
  });

  it("points the composer at the view actually being rendered", async () => {
    const { post, stage } = postStage();
    stage.addView(1, FULL_RECT, trackedScene(), { post: true });
    await flush();
    stage.render();

    expect(post.lastTarget).not.toBeNull();
    expect(post.lastTarget!.scene).toBeInstanceOf(THREE.Scene);
    expect(post.lastTarget!.camera).toBeInstanceOf(THREE.PerspectiveCamera);
  });

  it("refuses post when a second view is also on screen, and draws both scissored instead", async () => {
    const { renderer, post, created, stage } = postStage();
    stage.addView(1, FULL_RECT, trackedScene(), { post: true });
    stage.addView(2, { top: 0, left: 0, width: 200, height: 200 }, trackedScene());
    await flush();

    renderer.calls.length = 0;
    stage.render();

    expect(created).toHaveLength(0); // the chain is never even built
    expect(post.calls).toEqual([]);
    expect(renderer.calls.filter((c) => c === "render")).toHaveLength(2);
    expect(renderer.calls).toContain("setScissorTest(true)");
  });

  it("refuses post for a view that never opted in", async () => {
    const { renderer, created, stage } = postStage();
    stage.addView(1, FULL_RECT, trackedScene()); // no { post: true }
    await flush();

    renderer.calls.length = 0;
    stage.render();

    expect(created).toHaveLength(0);
    expect(renderer.calls.filter((c) => c === "render")).toHaveLength(1);
  });

  it("refuses post for an opted-in view that does not cover the canvas", async () => {
    const { renderer, created, stage } = postStage();
    // Half-height rect: a composer would stretch it over the whole canvas.
    stage.addView(1, { top: 0, left: 0, width: 800, height: 400 }, trackedScene(), { post: true });
    await flush();

    renderer.calls.length = 0;
    stage.render();

    expect(created).toHaveLength(0);
    expect(renderer.calls).toContain("setScissorTest(true)");
    expect(renderer.calls.filter((c) => c === "render")).toHaveLength(1);
  });

  it("falls back to the scissored path when the chain reports itself disabled (low tier / reduced motion)", async () => {
    const { renderer, post, stage } = postStage();
    post.state.enabled = false;
    stage.addView(1, FULL_RECT, trackedScene(), { post: true });
    await flush();

    renderer.calls.length = 0;
    stage.render();

    // isEnabled is consulted BEFORE handing the frame over, so the composer's
    // own fallback never even runs — the view is drawn scissored as usual.
    expect(post.calls).not.toContain("render(0)");
    expect(renderer.calls).toContain("setScissorTest(true)");
    expect(renderer.calls.filter((c) => c === "render")).toHaveLength(1);
  });

  it("re-applies the live quality/reduced-motion policy every frame", async () => {
    const { post, stage } = postStage();
    stage.addView(1, FULL_RECT, trackedScene(), { post: true });
    await flush();

    stage.render();
    stage.setFrame(baseFrame({ quality: "low", reducedMotion: true }));
    stage.render();

    expect(post.calls.filter((c) => c.startsWith("setPolicy"))).toEqual([
      "setPolicy(high,false)",
      "setPolicy(low,true)",
    ]);
  });

  it("sizes the chain in device pixels, once per size change", async () => {
    const { post, stage } = postStage();
    stage.addView(1, FULL_RECT, trackedScene(), { post: true });
    await flush();

    stage.render();
    stage.render(); // same size — must not re-size
    stage.setFrame(baseFrame({ size: { width: 800, height: 800, dpr: 2 } }));
    stage.render();

    expect(post.calls.filter((c) => c.startsWith("setSize"))).toEqual(["setSize(800,800)", "setSize(1600,1600)"]);
  });

  it("clamps DPR the same way gl/renderer.ts's setSize does, so the composer matches the drawing buffer", async () => {
    const { post, stage } = postStage();
    stage.addView(1, FULL_RECT, trackedScene(), { post: true });
    await flush();
    // dpr 3 on a high tier is clamped to 2; on the low tier it would be 1.5.
    stage.setFrame(baseFrame({ size: { width: 400, height: 400, dpr: 3 } }));
    stage.render();

    expect(post.calls.filter((c) => c.startsWith("setSize"))).toEqual(["setSize(800,800)"]);
  });

  it("builds the chain at most once and never retries a factory that declined", async () => {
    let calls = 0;
    const renderer = mockRenderer();
    const stage = new Stage(renderer, baseFrame(), {
      route: "/",
      createPost: () => {
        calls++;
        return null; // e.g. the renderer cannot back an EffectComposer
      },
    });
    stage.addView(1, FULL_RECT, trackedScene(), { post: true });
    await flush();

    stage.render();
    stage.render();
    stage.render();

    expect(calls).toBe(1);
    expect(renderer.calls.filter((c) => c === "render")).toHaveLength(3); // still drawn, scissored
  });

  it("reports a throwing factory through onError and keeps rendering without post", async () => {
    const boom = new Error("EffectComposer needs a real WebGLRenderer");
    const onError = vi.fn();
    const renderer = mockRenderer();
    const stage = new Stage(renderer, baseFrame(), {
      route: "/",
      onError,
      createPost: () => {
        throw boom;
      },
    });
    stage.addView(4, FULL_RECT, trackedScene(), { post: true });
    await flush();

    expect(() => stage.render()).not.toThrow();
    expect(onError).toHaveBeenCalledWith(boom, 4);
    expect(renderer.calls.filter((c) => c === "render")).toHaveLength(1);
  });

  it("declines post entirely for a plain RendererLike mock under the DEFAULT factory", async () => {
    // The default factory must not hand a mock to postprocessing — that throws
    // on the first eligible frame. This is the path every existing test takes.
    const renderer = mockRenderer();
    const stage = new Stage(renderer, baseFrame(), { route: "/" });
    stage.addView(1, FULL_RECT, trackedScene(), { post: true });
    await flush();

    expect(() => stage.render()).not.toThrow();
    expect(stage.postChain).toBeNull();
    expect(renderer.calls.filter((c) => c === "render")).toHaveLength(1);
  });

  it("disposes the chain with the Stage, and does not rebuild it afterwards", async () => {
    const { post, created, stage } = postStage();
    stage.addView(1, FULL_RECT, trackedScene(), { post: true });
    await flush();
    stage.render();
    expect(stage.postChain).not.toBeNull();

    stage.dispose();

    expect(post.calls).toContain("dispose");
    expect(stage.postChain).toBeNull();
    stage.render();
    expect(created).toHaveLength(1); // not rebuilt after disposal
  });
});
