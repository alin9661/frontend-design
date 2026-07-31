import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";
import ParallaxScene, { useParallax } from "@/components/ParallaxScene";
import { setReducedMotion } from "./setup";

describe("components/ParallaxScene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("useParallax() outside any provider falls back to static 0 values without crashing", () => {
    const { result } = renderHook(() => useParallax());
    expect(result.current.mx.get()).toBe(0);
    expect(result.current.my.get()).toBe(0);
  });

  it("attaches a window pointermove listener on mount and removes it on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(
      <ParallaxScene>
        <span>content</span>
      </ParallaxScene>
    );

    expect(addSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));
    const [, handler] = addSpy.mock.calls.find(([type]) => type === "pointermove")!;

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("pointermove", handler);
  });

  it("does not attach a pointermove listener when reduced motion is preferred", () => {
    setReducedMotion(true);
    const addSpy = vi.spyOn(window, "addEventListener");

    render(
      <ParallaxScene>
        <span>content</span>
      </ParallaxScene>
    );

    expect(addSpy).not.toHaveBeenCalledWith("pointermove", expect.any(Function));
  });

  it("updates mx/my away from 0 when the window receives a pointermove", async () => {
    const { result } = renderHook(() => useParallax(), {
      wrapper: ({ children }) => <ParallaxScene>{children}</ParallaxScene>,
    });

    expect(result.current.mx.get()).toBe(0);
    expect(result.current.my.get()).toBe(0);

    // Move to the bottom-right quadrant of the (jsdom default) viewport so
    // both normalized offsets are clearly positive.
    window.dispatchEvent(
      new MouseEvent("pointermove", {
        clientX: window.innerWidth,
        clientY: window.innerHeight,
      })
    );

    // The raw target updates synchronously, but mx/my are springs animated
    // over real animation frames, so they only converge after real time
    // passes.
    await waitFor(
      () => {
        expect(result.current.mx.get()).not.toBe(0);
        expect(result.current.my.get()).not.toBe(0);
      },
      { timeout: 2000 }
    );
  });
});
