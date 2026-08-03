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
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SceneId } from "@/lib/engine/types";
import { setReducedMotion } from "@/test/setup";
import {
  createFakeEngineDeps,
  getFakeEngineCounts,
  resetFakeEngineCounts,
} from "./test-utils/fake-engine";

const createEngineDepsMock = vi.fn((_reducedMotion: boolean) => createFakeEngineDeps());

vi.mock("@/lib/engine/react/create-engine", () => ({
  createEngineDeps: (reducedMotion: boolean) => createEngineDepsMock(reducedMotion),
}));

// Imported AFTER the mock so EngineProvider picks it up.
import EngineProvider from "@/lib/engine/react/EngineProvider";
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

function latestDeps() {
  const result = createEngineDepsMock.mock.results.at(-1);
  if (!result || result.type !== "return") throw new Error("createEngineDeps was not called");
  return result.value as ReturnType<typeof createFakeEngineDeps>;
}

beforeEach(() => {
  resetFakeEngineCounts();
  createEngineDepsMock.mockClear();
});

describe("EngineProvider — mount", () => {
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
});

describe("EngineProvider — symmetric destroy", () => {
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

  it("is StrictMode-safe: the dev-mode double-invoke's extra engine is fully destroyed before settling, and the final unmount destroys the last one", () => {
    const { unmount } = render(
      <React.StrictMode>
        <EngineProvider>
          <p>hello</p>
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

    unmount();

    const afterUnmount = getFakeEngineCounts();
    expect(afterUnmount.created).toBe(2);
    expect(afterUnmount.tickerStop).toBe(2);
    expect(afterUnmount.scrollDestroy).toBe(2);
    expect(afterUnmount.pointerDestroy).toBe(2);
    expect(afterUnmount.hostDestroy).toBe(2);
  });
});

describe("EngineProvider — registerView/unregisterView via useView()", () => {
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
      expect.objectContaining({ top: 0, left: 0, width: 300, height: 300 })
    );
    const [viewId] = deps.host.addView.mock.calls[0]!;

    rerender(<Wrapper showView={false} />);
    expect(deps.host.removeView).toHaveBeenCalledWith(viewId);
  });
});
