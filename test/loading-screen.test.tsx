// test/loading-screen.test.tsx
//
// components/deep-wave/LoadingScreen.tsx — the boot overlay's progress bar.
// Motion-audit fix P1 regression: the fill used to be a `width: %` with no
// transition (a layout-affecting property, animated via discrete style
// snaps on every ASSET_PROGRESS tick — steps/thrash, not a glide). Fixed to
// a `transform: scaleX()` (compositor-only) with a real `transition`.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EngineContext, type EngineContextValue } from "@/lib/engine/react/engine-context";
import LoadingScreen from "@/components/deep-wave/LoadingScreen";
import { EASE_OUT, PROGRESS_TRANSITION_CSS } from "@/lib/motion";
import { setReducedMotion } from "./setup";

function makeEngine(overrides: Partial<EngineContextValue> = {}): EngineContextValue {
  return {
    status: "loading",
    progress: 40,
    hostMode: null,
    quality: null,
    stats: null,
    registerView: () => 1,
    unregisterView: () => {},
    invoke: () => {},
    onScrollProgress: () => () => {},
    ...overrides,
  };
}

function renderWithEngine(engine: EngineContextValue) {
  return render(
    <EngineContext.Provider value={engine}>
      <LoadingScreen />
    </EngineContext.Provider>
  );
}

/** The fill bar is the only child of the `aria-hidden` track div. */
function getFillEl(container: HTMLElement): HTMLElement {
  const track = container.querySelector('[aria-hidden="true"]') as HTMLElement;
  return track.firstElementChild as HTMLElement;
}

describe("LoadingScreen — progress bar fill (P1: transform scaleX, not width)", () => {
  it("scales the fill via transform: scaleX(progress/100), not width", () => {
    const { container } = renderWithEngine(makeEngine({ status: "loading", progress: 40 }));
    const fill = getFillEl(container);

    expect(fill.style.width).toBe(""); // no longer a width-driven fill
    expect(fill.style.transform).toBe("scaleX(0.4)");
  });

  it("sets a real CSS transition on the transform (no more discrete width snaps)", () => {
    const { container } = renderWithEngine(makeEngine({ progress: 10 }));
    const fill = getFillEl(container);

    expect(fill.style.transition).toBe(PROGRESS_TRANSITION_CSS);
  });

  it("takes its transition from the shared motion tokens, not an inline curve", () => {
    // The bar animates via a raw style.transition (compositor-only transform
    // on a plain <div>, where framer-motion would add nothing), which is
    // exactly the case that can silently drift away from the shared easing.
    // Pinning it to the token — and pinning the token to EASE_OUT — means a
    // retune of the site's curve reaches the loading bar too. Pre-fix this
    // read a hardcoded "ease-out", framer's flatter built-in, not EASE_OUT.
    const { container } = renderWithEngine(makeEngine({ progress: 10 }));
    const fill = getFillEl(container);

    expect(PROGRESS_TRANSITION_CSS).toContain(`cubic-bezier(${EASE_OUT.join(",")})`);
    expect(fill.style.transition).toContain("transform");
    expect(fill.style.transition).not.toContain("ease-out");
  });

  it("A1 regression: disables the raw CSS transition under reduced motion", () => {
    // A1: this is a plain inline style on a `<div>`, not a framer-motion
    // animation, so `<MotionConfig reducedMotion="user">` (which only
    // governs framer-motion) can't suppress it on its own — it must gate on
    // `reduceMotion` explicitly, the way the exit fade a few lines below
    // already does. Pre-fix, this assertion would fail: the transition was
    // unconditionally "transform 200ms ease-out" regardless of
    // useReducedMotion()'s value.
    setReducedMotion(true);
    const { container } = renderWithEngine(makeEngine({ progress: 10 }));
    const fill = getFillEl(container);

    expect(fill.style.transition).toBe("none");
  });

  it("keeps the fill's own transform-origin at the left so it scales outward from the start", () => {
    const { container } = renderWithEngine(makeEngine({ progress: 75 }));
    const fill = getFillEl(container);

    expect(fill.className).toContain("origin-left");
  });

  it("clamps progress below 0 to scaleX(0) and above 100 to scaleX(1)", () => {
    const under = renderWithEngine(makeEngine({ progress: -20 }));
    expect(getFillEl(under.container).style.transform).toBe("scaleX(0)");
    under.unmount();

    const over = renderWithEngine(makeEngine({ progress: 250 }));
    expect(getFillEl(over.container).style.transform).toBe("scaleX(1)");
    over.unmount();
  });

  it("is not rendered once the engine is ready (visible only for boot/loading)", () => {
    renderWithEngine(makeEngine({ status: "ready", progress: 100 }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is not rendered once the engine falls back (GL-less degrade, per §6 a11y)", () => {
    renderWithEngine(makeEngine({ status: "fallback", progress: 0 }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
