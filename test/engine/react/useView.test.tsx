// test/engine/react/useView.test.tsx
//
// useView(sceneId) tested against a hand-built EngineContextValue (not a
// real <EngineProvider>) — it only needs the context *shape*
// (registerView/unregisterView), so this suite never touches core/gl/worker
// or create-engine.ts at all.

import { useRef } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SceneId } from "@/lib/engine/types";
import { EngineContext, type EngineContextValue } from "@/lib/engine/react/engine-context";
import { useView } from "@/lib/engine/react/useView";

function makeEngine(overrides: Partial<EngineContextValue> = {}): EngineContextValue {
  return {
    status: "ready",
    progress: 100,
    hostMode: "main",
    quality: "high",
    stats: null,
    registerView: vi.fn(() => 1),
    unregisterView: vi.fn(),
    invoke: vi.fn(),
    onScrollProgress: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

function Probe() {
  const ref = useView("placeholder");
  return <div ref={ref} data-testid="probe" />;
}

describe("useView", () => {
  it("registers the element with the engine on mount, passing the sceneId", () => {
    const registerView = vi.fn((_el: HTMLElement, _sceneId: SceneId) => 42);
    const engine = makeEngine({ registerView });

    render(
      <EngineContext.Provider value={engine}>
        <Probe />
      </EngineContext.Provider>
    );

    expect(registerView).toHaveBeenCalledTimes(1);
    const [el, sceneId] = registerView.mock.calls[0]!;
    expect(el).toBeInstanceOf(HTMLDivElement);
    expect(sceneId).toBe("placeholder");
  });

  it("unregisters with the viewId returned by registerView on unmount", () => {
    const registerView = vi.fn(() => 42);
    const unregisterView = vi.fn();
    const engine = makeEngine({ registerView, unregisterView });

    const { unmount } = render(
      <EngineContext.Provider value={engine}>
        <Probe />
      </EngineContext.Provider>
    );

    expect(unregisterView).not.toHaveBeenCalled();
    unmount();
    expect(unregisterView).toHaveBeenCalledTimes(1);
    expect(unregisterView).toHaveBeenCalledWith(42);
  });

  it("re-registers under a new viewId when the ref moves to a different element, unregistering the old one first", () => {
    let nextId = 1;
    const registerView = vi.fn((_el: HTMLElement, _sceneId: SceneId) => nextId++);
    const unregisterView = vi.fn();
    const engine = makeEngine({ registerView, unregisterView });

    function Swappable({ which }: { which: "a" | "b" }) {
      const ref = useView("placeholder");
      return which === "a" ? <div ref={ref} data-testid="a" /> : <span ref={ref} data-testid="b" />;
    }

    const { rerender } = render(
      <EngineContext.Provider value={engine}>
        <Swappable which="a" />
      </EngineContext.Provider>
    );
    expect(registerView).toHaveBeenCalledTimes(1);

    rerender(
      <EngineContext.Provider value={engine}>
        <Swappable which="b" />
      </EngineContext.Provider>
    );

    expect(unregisterView).toHaveBeenCalledWith(1);
    expect(registerView).toHaveBeenCalledTimes(2);
    const [, secondSceneId] = registerView.mock.calls[1]!;
    expect(secondSceneId).toBe("placeholder");
  });

  it("throws outside an EngineProvider (no EngineContext)", () => {
    // Swallow the expected React error-boundary console.error noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/must be called within an <EngineProvider>/);
    spy.mockRestore();
  });
});

// `opts.onReady` (M2 addition, picker workstream — see useView.ts's header):
// the only way a caller can learn the viewId EngineProvider assigned it,
// needed by SectionPicker.tsx to drive `useEngine().invoke(viewId, ...)`.
describe("useView — onReady option", () => {
  it("calls onReady with the assigned viewId on attach", () => {
    const registerView = vi.fn(() => 7);
    const engine = makeEngine({ registerView });
    const onReady = vi.fn();

    function ProbeWithOnReady() {
      const ref = useView("picker", { onReady });
      return <div ref={ref} data-testid="probe" />;
    }

    render(
      <EngineContext.Provider value={engine}>
        <ProbeWithOnReady />
      </EngineContext.Provider>
    );

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(7);
  });

  it("calls onReady with null on detach (unmount)", () => {
    const registerView = vi.fn(() => 7);
    const engine = makeEngine({ registerView });
    const onReady = vi.fn();

    function ProbeWithOnReady() {
      const ref = useView("picker", { onReady });
      return <div ref={ref} data-testid="probe" />;
    }

    const { unmount } = render(
      <EngineContext.Provider value={engine}>
        <ProbeWithOnReady />
      </EngineContext.Provider>
    );
    onReady.mockClear();

    unmount();

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(null);
  });

  it("is optional — omitting it doesn't throw", () => {
    const engine = makeEngine({ registerView: vi.fn(() => 3) });
    function ProbeNoOnReady() {
      const ref = useView("picker");
      return <div ref={ref} data-testid="probe" />;
    }
    expect(() =>
      render(
        <EngineContext.Provider value={engine}>
          <ProbeNoOnReady />
        </EngineContext.Provider>
      )
    ).not.toThrow();
  });

  it("always calls the latest onReady without re-registering the view on every render", () => {
    const registerView = vi.fn(() => 9);
    const unregisterView = vi.fn();
    const engine = makeEngine({ registerView, unregisterView });
    const seen: Array<number | null> = [];

    function ProbeInlineOnReady({ tag }: { tag: string }) {
      const ref = useView("picker", { onReady: (id) => seen.push(id !== null ? id : -1), });
      return <div ref={ref} data-testid={tag} />;
    }

    const { rerender } = render(
      <EngineContext.Provider value={engine}>
        <ProbeInlineOnReady tag="a" />
      </EngineContext.Provider>
    );
    expect(registerView).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([9]);

    // A brand-new inline `onReady` closure every render must not re-run the
    // attach/detach cycle (ref's own deps don't include onReady).
    rerender(
      <EngineContext.Provider value={engine}>
        <ProbeInlineOnReady tag="a" />
      </EngineContext.Provider>
    );
    expect(registerView).toHaveBeenCalledTimes(1);
    expect(unregisterView).not.toHaveBeenCalled();
  });
});

// Sanity check that useView really does return a ref *callback* (design doc
// §4: `useView(sceneId): RefCallback<HTMLElement>`), not some other shape —
// e.g. it must compose fine with a caller that also wants a plain ref to the
// same node via useRef + a merging pattern.
describe("useView — return shape", () => {
  it("returns a function usable directly as a ref prop", () => {
    const engine = makeEngine();
    function WithLocalRef() {
      const localRef = useRef<HTMLDivElement | null>(null);
      const viewRef = useView("placeholder");
      return (
        <div
          ref={(el) => {
            localRef.current = el;
            viewRef(el);
          }}
          data-testid="merged"
        />
      );
    }

    const { getByTestId } = render(
      <EngineContext.Provider value={engine}>
        <WithLocalRef />
      </EngineContext.Provider>
    );
    expect(getByTestId("merged")).toBeInTheDocument();
  });
});
