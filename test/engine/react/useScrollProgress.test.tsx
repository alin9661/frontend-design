// test/engine/react/useScrollProgress.test.tsx
//
// useScrollProgress (raw callback subscription) and useScrollProgressValue
// (throttled state) tested against a hand-built EngineContextValue whose
// `onScrollProgress` we fully control — never touches core/gl/worker.

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EngineContext, type EngineContextValue } from "@/lib/engine/react/engine-context";
import { useScrollProgress, useScrollProgressValue } from "@/lib/engine/react/useScrollProgress";

type ProgressListener = (p: number) => void;

function makeControllableEngine(): {
  engine: EngineContextValue;
  emit: (p: number) => void;
  subscriberCount: () => number;
} {
  const listeners = new Set<ProgressListener>();
  const unsubscribe = vi.fn();
  const onScrollProgress = vi.fn((cb: ProgressListener) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
      unsubscribe();
    };
  });

  const engine: EngineContextValue = {
    status: "ready",
    progress: 100,
    hostMode: "main",
    quality: "high",
    stats: null,
    registerView: vi.fn(() => 1),
    unregisterView: vi.fn(),
    invoke: vi.fn(),
    onScrollProgress,
  };

  return {
    engine,
    emit: (p: number) => {
      for (const cb of listeners) cb(p);
    },
    subscriberCount: () => listeners.size,
  };
}

describe("useScrollProgress (callback subscription)", () => {
  it("calls the latest callback on every emission, without causing the calling component to re-render", () => {
    const { engine, emit } = makeControllableEngine();
    const seen: number[] = [];
    let renderCount = 0;

    function Consumer() {
      renderCount += 1;
      useScrollProgress((p) => seen.push(p));
      return <div data-testid="renders">{renderCount}</div>;
    }

    render(
      <EngineContext.Provider value={engine}>
        <Consumer />
      </EngineContext.Provider>
    );
    expect(screen.getByTestId("renders")).toHaveTextContent("1");

    act(() => {
      emit(0.25);
      emit(0.5);
    });

    expect(seen).toEqual([0.25, 0.5]);
    // Purely imperative — no re-render from the subscription firing.
    expect(screen.getByTestId("renders")).toHaveTextContent("1");
  });

  it("unsubscribes on unmount", () => {
    const { engine, subscriberCount } = makeControllableEngine();
    function Consumer() {
      useScrollProgress(() => {});
      return null;
    }

    const { unmount } = render(
      <EngineContext.Provider value={engine}>
        <Consumer />
      </EngineContext.Provider>
    );
    expect(subscriberCount()).toBe(1);
    unmount();
    expect(subscriberCount()).toBe(0);
  });

  it("always invokes the latest callback passed in, even across re-renders that don't change engine identity", () => {
    const { engine, emit } = makeControllableEngine();
    const calls: string[] = [];

    function Consumer({ tag }: { tag: string }) {
      useScrollProgress((p) => calls.push(`${tag}:${p}`));
      return null;
    }

    const { rerender } = render(
      <EngineContext.Provider value={engine}>
        <Consumer tag="first" />
      </EngineContext.Provider>
    );
    rerender(
      <EngineContext.Provider value={engine}>
        <Consumer tag="second" />
      </EngineContext.Provider>
    );

    act(() => emit(0.9));
    expect(calls).toEqual(["second:0.9"]);
  });
});

describe("useScrollProgressValue (throttled state)", () => {
  it("updates state immediately for the first emission, then throttles subsequent ones within the window", () => {
    const { engine, emit } = makeControllableEngine();
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    function Consumer() {
      const p = useScrollProgressValue(100);
      return <div data-testid="value">{p}</div>;
    }

    render(
      <EngineContext.Provider value={engine}>
        <Consumer />
      </EngineContext.Provider>
    );
    expect(screen.getByTestId("value")).toHaveTextContent("0");

    act(() => emit(0.2));
    expect(screen.getByTestId("value")).toHaveTextContent("0.2");

    now += 40; // inside the 100ms throttle window
    act(() => emit(0.4));
    expect(screen.getByTestId("value")).toHaveTextContent("0.2"); // unchanged — throttled

    now += 80; // now 120ms after the first emission — window has elapsed
    act(() => emit(0.6));
    expect(screen.getByTestId("value")).toHaveTextContent("0.6");

    vi.restoreAllMocks();
  });

  it("defaults to a 100ms throttle when no argument is passed", () => {
    const { engine, emit } = makeControllableEngine();
    let now = 5_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    function Consumer() {
      const p = useScrollProgressValue();
      return <div data-testid="value">{p}</div>;
    }

    render(
      <EngineContext.Provider value={engine}>
        <Consumer />
      </EngineContext.Provider>
    );

    act(() => emit(0.1));
    expect(screen.getByTestId("value")).toHaveTextContent("0.1");

    now += 50;
    act(() => emit(0.9));
    expect(screen.getByTestId("value")).toHaveTextContent("0.1"); // still throttled at 50ms < 100ms

    vi.restoreAllMocks();
  });
});
