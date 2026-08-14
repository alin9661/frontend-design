// test/engine/react/EngineProvider.test.tsx
//
// EngineProvider's mount/unmount lifecycle under a mocked engine (see
// test-utils/fake-engine.ts): symmetric destroy, StrictMode mount→unmount→
// mount safety, status transitions off real WorkerToMain messages, the
// init()-rejects → "fallback" branch, and registerView/unregisterView
// end-to-end through a child using the real useView() hook.
//
// `create-engine.ts` is mocked (not core/gl/worker directly) so this suite
// never needs a real WebGL context or Worker — see that module's header.

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import type { SceneId } from "@/lib/engine/types";
import { computeInView } from "@/lib/engine/gl/view";
import { unpackFrameState } from "@/lib/engine/worker/protocol";
import { setReducedMotion } from "@/test/setup";
import {
  createFakeEngineDeps,
  getFakeEngineCounts,
  resetFakeEngineCounts,
} from "./test-utils/fake-engine";

const createEngineDepsMock = vi.fn((_reducedMotion: boolean) => createFakeEngineDeps());
const { warmOriginFilm } = vi.hoisted(() => ({ warmOriginFilm: vi.fn() }));

vi.mock("@/lib/engine/react/create-engine", () => ({
  createEngineDeps: (reducedMotion: boolean) => createEngineDepsMock(reducedMotion),
}));
vi.mock("@/lib/engine/worker/scene-registry", () => ({
  sceneRegistry: { "origin-film": warmOriginFilm },
}));

// Imported AFTER the mock so EngineProvider picks it up.
import EngineProvider, { stickyFrame } from "@/lib/engine/react/EngineProvider";
import { useEngine } from "@/lib/engine/react/useEngine";
import { useView } from "@/lib/engine/react/useView";

function StatusProbe() {
  const { status, progress, hostMode } = useEngine();
  return (
    <div data-testid="status-probe">
      {status}|{progress}|{hostMode ?? "null"}
    </div>
  );
}

function ViewProbe({ sceneId }: { sceneId: SceneId }) {
  const ref = useView(sceneId);
  return <div ref={ref} data-testid="view-probe" />;
}

function PostViewProbe() {
  const ref = useView("origin-film", { sticky: true, post: true });
  return (
    <div data-testid="range" data-rect-top={0} data-rect-height={12000}>
      <div ref={ref} data-testid="post-view" data-rect-top={0} data-rect-height={1000} />
    </div>
  );
}

function latestDeps() {
  const result = createEngineDepsMock.mock.results.at(-1);
  if (!result || result.type !== "return") throw new Error("createEngineDeps was not called");
  return result.value as ReturnType<typeof createFakeEngineDeps>;
}

beforeEach(() => {
  resetFakeEngineCounts();
  createEngineDepsMock.mockReset().mockImplementation(
    (_reducedMotion: boolean) => createFakeEngineDeps(),
  );
  warmOriginFilm.mockReset().mockResolvedValue({ dispose: vi.fn() });
});

describe("@/lib/engine/react/EngineProvider — mount", () => {
  it("renders an aria-hidden fixed canvas plus children, and boots one engine", () => {
    render(
      <EngineProvider>
        <p>hello</p>
      </EngineProvider>
    );

    expect(screen.getByText("hello")).toBeInTheDocument();
    const canvas = document.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("aria-hidden", "true");

    expect(createEngineDepsMock).toHaveBeenCalledTimes(1);
    const deps = latestDeps();
    expect(deps.ticker.start).toHaveBeenCalledTimes(1);
    expect(deps.host.init).toHaveBeenCalledTimes(1);
    expect(deps.host.init).toHaveBeenCalledWith(canvas, expect.objectContaining({ reducedMotion: false }));
  });

  it("detects prefers-reduced-motion and threads it into both createEngineDeps and RenderHost.init()", () => {
    setReducedMotion(true);

    render(
      <EngineProvider>
        <p>hello</p>
      </EngineProvider>
    );

    expect(createEngineDepsMock).toHaveBeenCalledWith(true);
    const deps = latestDeps();
    expect(deps.host.init).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reducedMotion: true })
    );
  });

  it("starts in loading status and moves to ready once ASSETS_DONE arrives, tracking ASSET_PROGRESS along the way", async () => {
    render(
      <EngineProvider>
        <StatusProbe />
      </EngineProvider>
    );

    expect(screen.getByTestId("status-probe")).toHaveTextContent("loading|0|main");

    const deps = latestDeps();
    act(() => {
      deps.host.__emit({ type: "ASSET_PROGRESS", p: 0.5, id: "font" });
    });
    expect(screen.getByTestId("status-probe")).toHaveTextContent("loading|50|main");

    act(() => {
      deps.host.__emit({ type: "ASSETS_DONE" });
    });
    expect(screen.getByTestId("status-probe")).toHaveTextContent("ready|100|main");
  });

  it("falls back to status 'fallback' when RenderHost.init() rejects, without leaving the page stuck loading", async () => {
    createEngineDepsMock.mockImplementationOnce(() => createFakeEngineDeps({ initResolves: false }));

    render(
      <EngineProvider>
        <StatusProbe />
      </EngineProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("status-probe")).toHaveTextContent(/^fallback\|/);
    });
  });

  it("starts the origin-film cache warm before host.init begins waiting for readiness", () => {
    const calls: string[] = [];
    warmOriginFilm.mockImplementationOnce(() => {
      calls.push("warm");
      return Promise.resolve({ dispose: vi.fn() });
    });
    createEngineDepsMock.mockImplementationOnce(() => {
      const deps = createFakeEngineDeps();
      deps.host.init.mockImplementationOnce(() => {
        calls.push("init");
        return new Promise<void>(() => {});
      });
      return deps;
    });

    render(
      <EngineProvider>
        <StatusProbe />
      </EngineProvider>
    );

    expect(calls).toEqual(["warm", "init"]);
    expect(screen.getByTestId("status-probe")).toHaveTextContent("loading|0|main");
  });

  it("contains a rejected scene warm-up without rejecting init or changing provider status", async () => {
    warmOriginFilm.mockRejectedValueOnce(new Error("cache warm failed"));

    render(
      <EngineProvider>
        <StatusProbe />
      </EngineProvider>
    );
    const deps = latestDeps();

    await act(async () => {
      await Promise.resolve();
    });
    expect(deps.host.init).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status-probe")).toHaveTextContent("loading|0|main");

    act(() => {
      deps.host.__emit({ type: "ASSETS_DONE" });
    });
    expect(screen.getByTestId("status-probe")).toHaveTextContent("ready|100|main");
  });

});

describe("@/lib/engine/react/EngineProvider — symmetric destroy", () => {
  it("unmount calls ticker.stop/scroll.destroy/pointer.destroy/host.destroy exactly once each", () => {
    const { unmount } = render(
      <EngineProvider>
        <p>hello</p>
      </EngineProvider>
    );

    expect(getFakeEngineCounts()).toMatchObject({
      created: 1,
      tickerStop: 0,
      scrollDestroy: 0,
      pointerDestroy: 0,
      hostDestroy: 0,
    });

    unmount();

    expect(getFakeEngineCounts()).toMatchObject({
      created: 1,
      tickerStop: 1,
      scrollDestroy: 1,
      pointerDestroy: 1,
      hostDestroy: 1,
    });
  });

  it("mount→unmount→mount→unmount leaves every create matched by exactly one destroy (no cross-cycle leaks)", () => {
    const first = render(
      <EngineProvider>
        <p>one</p>
      </EngineProvider>
    );
    first.unmount();

    const second = render(
      <EngineProvider>
        <p>two</p>
      </EngineProvider>
    );
    second.unmount();

    const counts = getFakeEngineCounts();
    expect(counts.created).toBe(2);
    expect(counts.tickerStop).toBe(2);
    expect(counts.scrollDestroy).toBe(2);
    expect(counts.pointerDestroy).toBe(2);
    expect(counts.hostDestroy).toBe(2);
  });

  it("is StrictMode-safe: each effect setup initializes with a distinct, never-transferred canvas", async () => {
    const transferred = new WeakSet<HTMLCanvasElement>();
    const initializedCanvases: HTMLCanvasElement[] = [];
    createEngineDepsMock.mockImplementation(() => {
      const deps = createFakeEngineDeps();
      deps.host.init.mockImplementation(async (canvas: HTMLCanvasElement) => {
        initializedCanvases.push(canvas);
        if (transferred.has(canvas)) {
          throw new DOMException("Canvas has already been transferred", "InvalidStateError");
        }
        transferred.add(canvas);
      });
      return deps;
    });

    const { unmount } = render(
      <React.StrictMode>
        <EngineProvider>
          <StatusProbe />
        </EngineProvider>
      </React.StrictMode>
    );

    // StrictMode double-invokes the effect (mount -> cleanup -> mount) once
    // on initial mount: two engines get created, and the first is already
    // torn down by the time we get here.
    const afterMount = getFakeEngineCounts();
    expect(afterMount.created).toBe(2);
    expect(afterMount.tickerStop).toBe(1);
    expect(afterMount.scrollDestroy).toBe(1);
    expect(afterMount.pointerDestroy).toBe(1);
    expect(afterMount.hostDestroy).toBe(1);
    expect(initializedCanvases).toHaveLength(2);
    expect(new Set(initializedCanvases).size).toBe(2);

    // Flush both init promise chains. Reusing the first canvas would reject
    // the second init and move this probe to fallback on the pre-fix code.
    await act(async () => {});
    expect(screen.getByTestId("status-probe")).not.toHaveTextContent(/^fallback\|/);

    unmount();

    const afterUnmount = getFakeEngineCounts();
    expect(afterUnmount.created).toBe(2);
    expect(afterUnmount.tickerStop).toBe(2);
    expect(afterUnmount.scrollDestroy).toBe(2);
    expect(afterUnmount.pointerDestroy).toBe(2);
    expect(afterUnmount.hostDestroy).toBe(2);
  });
});

describe("@/lib/engine/react/EngineProvider — registerView/unregisterView via useView()", () => {
  it("registers a child's view once the host is ready, and removes it on unmount", async () => {
    function Wrapper({ showView }: { showView: boolean }) {
      return (
        <EngineProvider>
          {showView ? <ViewProbe sceneId="placeholder" /> : null}
        </EngineProvider>
      );
    }

    const { rerender } = render(<Wrapper showView={true} />);
    const deps = latestDeps();

    await waitFor(() => {
      expect(deps.host.addView).toHaveBeenCalledTimes(1);
    });
    expect(deps.host.addView).toHaveBeenCalledWith(
      expect.any(Number),
      "placeholder",
      expect.objectContaining({ top: 0, left: 0, width: 300, height: 300 }),
      // A view that did not ask for the post chain must say so explicitly:
      // `undefined` would leave Stage to guess, and a composer that guesses
      // wrong paints over every other view on the canvas.
      { post: false }
    );
    const [viewId] = deps.host.addView.mock.calls[0]!;

    rerender(<Wrapper showView={false} />);
    expect(deps.host.removeView).toHaveBeenCalledWith(viewId);
  });

  it("carries a view's post opt-in all the way to the host", async () => {
    // `useView({ post: true })` is the ONLY way a view can reach gl/post.ts:
    // Stage refuses the composer for any view whose `post` is false, so a
    // broken link anywhere along this chain makes the entire bloom/SMAA/riso
    // chain unreachable in the running app while its own unit tests — which
    // construct views with `{ post: true }` by hand — stay green.
    render(
      <EngineProvider>
        <PostViewProbe />
      </EngineProvider>,
    );
    const deps = latestDeps();

    await waitFor(() => expect(deps.host.addView).toHaveBeenCalledTimes(1));
    expect(deps.host.addView).toHaveBeenCalledWith(
      expect.any(Number),
      "origin-film",
      expect.any(Object),
      { post: true },
    );
  });

  it("names the page's route on host.init, which is where the riso grain's route gate reads from", () => {
    render(<EngineProvider>{null}</EngineProvider>);
    const deps = latestDeps();

    expect(deps.host.init).toHaveBeenCalledWith(
      expect.anything(),
      // jsdom serves the suite from "/", the same route the grain claims.
      expect.objectContaining({ route: location.pathname }),
    );
    // Specifically not the empty string: gl/shaders/riso.ts normalises `""`
    // to `"/"`, so passing it would grant grain to a caller that never said
    // where it was.
    const init = deps.host.init.mock.calls[0]![1] as { route?: string };
    expect(init.route).not.toBe("");
    expect(typeof init.route).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Sticky views.
//
// RectTracker measures a STATIC document rect, only on track()/resize — never
// on scroll. For a `position: sticky` stage that measurement is its UNSTUCK
// position, which silently breaks two things at once: Stage culls the view as
// soon as the page scrolls one viewport past the section top, and the
// rect-derived progress reads 0.5 at the section's start instead of 0. On a
// long sticky film that means GL is dead for most of the scroll and plays its
// second half first. These cases pin the arithmetic that fixes it.
// ---------------------------------------------------------------------------

/** Rects come off data-* attributes so a test can lay out a fake document
 * without jsdom ever computing layout (jsdom reports 0x0 for everything). */
function trackFromDataAttrs(el: Element) {
  const num = (name: string, fallback: number) => {
    const raw = el.getAttribute(name);
    return raw === null ? fallback : Number(raw);
  };
  const top = num("data-rect-top", 0);
  const height = num("data-rect-height", 300);
  return {
    top,
    left: 0,
    width: 800,
    height,
    inView: vi.fn(() => true),
    viewportY: vi.fn(() => 0),
    progress: vi.fn(() => 0),
  };
}

function StickyViewProbe() {
  const ref = useView("origin-film", { sticky: true });
  return (
    // A deliberately long 12000px sticky range; the math is independent of
    // OriginStory's current responsive section height.
    <div data-testid="range" data-rect-top={1000} data-rect-height={12000}>
      {/* One viewport tall, pinned. Measured unstuck at the range's top. */}
      <div ref={ref} data-testid="sticky-view" data-rect-top={1000} data-rect-height={1000} />
    </div>
  );
}

/** Runs the RENDER tick and returns the per-view FRAME_STATE the host got. */
function tickAndReadView(deps: ReturnType<typeof createFakeEngineDeps>, scrollY: number) {
  deps.scroll.state.current = scrollY;
  const tickCb = deps.ticker.add.mock.calls[0]![0];
  act(() => {
    tickCb(0.016, 0);
  });
  const packed = deps.host.frame.mock.calls.at(-1)![0] as Float32Array;
  const view = unpackFrameState(packed).views[0];
  if (!view) throw new Error("no view in FRAME_STATE");
  return view;
}

describe("@/lib/engine/react/EngineProvider — sticky views", () => {
  const VIEWPORT_H = 1000;
  let originalInnerHeight: number;

  beforeEach(() => {
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: VIEWPORT_H, configurable: true });
    createEngineDepsMock.mockImplementation(() => {
      const deps = createFakeEngineDeps();
      deps.rectTracker.track = vi.fn(trackFromDataAttrs);
      return deps;
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
    createEngineDepsMock.mockImplementation(() => createFakeEngineDeps());
  });

  it("pins the rect to the scroll position and runs progress 0..1 across the whole range", async () => {
    render(
      <EngineProvider>
        <StickyViewProbe />
      </EngineProvider>
    );
    const deps = latestDeps();
    await waitFor(() => expect(deps.host.addView).toHaveBeenCalledTimes(1));

    // travel = range 12000 - sticky 1000 = 11000, starting at range top 1000.
    const atStart = tickAndReadView(deps, 1000);
    expect(atStart.top).toBe(1000);
    expect(atStart.progress).toBeCloseTo(0, 6);

    const midway = tickAndReadView(deps, 6500);
    expect(midway.top).toBe(6500); // pinned: document top === scrollY
    expect(midway.progress).toBeCloseTo(0.5, 6);

    const atEnd = tickAndReadView(deps, 12000);
    expect(atEnd.top).toBe(12000);
    expect(atEnd.progress).toBeCloseTo(1, 6);

    // Height/width still come from the sticky element, not the tall range —
    // they drive the scissor box and the camera's z-distance.
    expect(midway.height).toBe(1000);
    expect(midway.width).toBe(800);
  });

  it("clamps outside its travel instead of running away with the page", async () => {
    render(
      <EngineProvider>
        <StickyViewProbe />
      </EngineProvider>
    );
    const deps = latestDeps();
    await waitFor(() => expect(deps.host.addView).toHaveBeenCalledTimes(1));

    const above = tickAndReadView(deps, 0); // section still below the fold
    expect(above.top).toBe(1000);
    expect(above.progress).toBe(0);

    const below = tickAndReadView(deps, 20000); // scrolled far past the section
    expect(below.top).toBe(12000);
    expect(below.progress).toBe(1);
  });

  it("keeps the view uncullable through the section — the bug a static rect causes", async () => {
    render(
      <EngineProvider>
        <StickyViewProbe />
      </EngineProvider>
    );
    const deps = latestDeps();
    await waitFor(() => expect(deps.host.addView).toHaveBeenCalledTimes(1));

    const staticRect = { top: 1000, left: 0, width: 800, height: 1000 };
    for (const scrollY of [1000, 3750, 6500, 9250, 12000]) {
      const v = tickAndReadView(deps, scrollY);
      expect(computeInView({ top: v.top, left: v.left, width: v.width, height: v.height }, scrollY, VIEWPORT_H)).toBe(true);
    }
    // The unstuck measurement Stage would otherwise cull against: dead from
    // one viewport in.
    expect(computeInView(staticRect, 2500, VIEWPORT_H)).toBe(false);
  });

  it("adds the view with its pinned rect, so init() sees the box the first frame draws", async () => {
    Object.defineProperty(window, "scrollY", { value: 6500, configurable: true });
    render(
      <EngineProvider>
        <StickyViewProbe />
      </EngineProvider>
    );
    const deps = latestDeps();
    await waitFor(() => expect(deps.host.addView).toHaveBeenCalledTimes(1));

    expect(deps.host.addView).toHaveBeenCalledWith(
      expect.any(Number),
      "origin-film",
      expect.objectContaining({ top: 6500, height: 1000 }),
      { post: false }
    );
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  it("leaves a non-sticky view's rect and progress exactly as measured", async () => {
    render(
      <EngineProvider>
        <ViewProbe sceneId="placeholder" />
      </EngineProvider>
    );
    const deps = latestDeps();
    await waitFor(() => expect(deps.host.addView).toHaveBeenCalledTimes(1));

    const v = tickAndReadView(deps, 4000);
    expect(v.top).toBe(0); // the tracked rect, untouched by scroll
    expect(v.height).toBe(300);
    expect(v.progress).toBe(0); // the TrackedRect.progress stub, not stickyFrame's
  });

  it("untracks the scroll range as well as the sticky element on unmount", async () => {
    const { rerender } = render(
      <EngineProvider>
        <StickyViewProbe />
      </EngineProvider>
    );
    const deps = latestDeps();
    await waitFor(() => expect(deps.host.addView).toHaveBeenCalledTimes(1));
    expect(deps.rectTracker.track).toHaveBeenCalledTimes(2); // sticky element + its range

    rerender(<EngineProvider>{null}</EngineProvider>);
    expect(deps.rectTracker.untrack).toHaveBeenCalledTimes(2);
  });
});

describe("@/lib/engine/react/EngineProvider — stickyFrame", () => {
  const range = { top: 1000, left: 0, width: 800, height: 12000 };
  const sticky = { top: 1000, left: 0, width: 800, height: 1000 };

  it("matches useScroll({ offset: ['start start', 'end end'] }) over the same range", () => {
    // framer's start-start/end-end: 0 when the range's top reaches the
    // viewport top, 1 when its bottom reaches the viewport bottom — i.e. over
    // exactly (rangeHeight - viewportHeight) px of travel.
    expect(stickyFrame(sticky, range, 1000).progress).toBeCloseTo(0, 6);
    expect(stickyFrame(sticky, range, 1000 + 11000).progress).toBeCloseTo(1, 6);
    expect(stickyFrame(sticky, range, 1000 + 2750).progress).toBeCloseTo(0.25, 6);
  });

  it("degrades to a still frame when the range is no taller than the sticky box", () => {
    const flat = { top: 1000, left: 0, width: 800, height: 1000 };
    const out = stickyFrame(sticky, flat, 4000);
    expect(out.progress).toBe(0);
    expect(out.rect.top).toBe(1000);
  });
});
