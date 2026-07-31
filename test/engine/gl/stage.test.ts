// test/engine/gl/stage.test.ts
//
// gl/stage.ts against the RendererLike mock (types.ts): addView/removeView
// lifecycle, render-order (insertion order) and culling (off-screen views
// never reach renderer.render), and dispose bookkeeping — every view's
// SceneModule.dispose() is called, freeing whatever THREE resources it
// tracked.

import { describe, expect, it, vi } from "vitest";
import { Stage, type StageFrameInput } from "@/lib/engine/gl/stage";
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
