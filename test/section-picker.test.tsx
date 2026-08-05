// test/section-picker.test.tsx
//
// components/deep-wave/SectionPicker.tsx — DOM ink-color transition timing.
// Motion-audit fix P2 regression: the section's `color` transition used to
// be `300ms ease` while claiming (in a comment) to match the GL background's
// BG_LAMBDA=6 damp — it didn't; that damp settles ~500ms in. Fixed to
// `450ms cubic-bezier(0.33, 1, 0.68, 1)`, applied consistently to both the
// section root's ink color and the sub-copy's muted ink color.

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EngineContext, type EngineContextValue } from "@/lib/engine/react/engine-context";
import { flavors } from "@/lib/flavors";
import SectionPicker from "@/components/deep-wave/SectionPicker";

const EXPECTED_TRANSITION = "color 450ms cubic-bezier(0.33, 1, 0.68, 1)";

/** jsdom normalizes an inline `color: "#rrggbb"` style to `rgb(r, g, b)` on
 * readback — convert a flavor's hex ink token the same way for comparison. */
function hexToRgbString(hex: string): string {
  const clean = hex.replace(/^#/, "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function makeEngine(): EngineContextValue {
  return {
    status: "ready",
    progress: 100,
    hostMode: "main",
    quality: "high",
    stats: null,
    registerView: () => 1,
    unregisterView: () => {},
    invoke: () => {},
    onScrollProgress: () => () => {},
  };
}

function renderPicker() {
  return render(
    <EngineContext.Provider value={makeEngine()}>
      <SectionPicker />
    </EngineContext.Provider>
  );
}

describe("SectionPicker — ink color transition (P2: matches the GL bg's settle time)", () => {
  it("sets the new 450ms cubic-bezier transition on the section root's ink color", () => {
    const { container } = renderPicker();
    const section = container.querySelector("#picker") as HTMLElement;
    expect(section.style.transition).toBe(EXPECTED_TRANSITION);
  });

  it("applies the same transition to the muted sub-copy ink color", () => {
    renderPicker();
    const subCopy = screen.getByText(/Five flavors\./);
    expect((subCopy as HTMLElement).style.transition).toBe(EXPECTED_TRANSITION);
  });

  it("no longer uses the old (mismatched) 300ms transition", () => {
    const { container } = renderPicker();
    const section = container.querySelector("#picker") as HTMLElement;
    expect(section.style.transition).not.toBe("color 300ms ease");
  });

  it("selecting a different flavor still updates the section's ink color (behavior unchanged by the timing fix)", () => {
    const { container } = renderPicker();
    const section = container.querySelector("#picker") as HTMLElement;
    const initialColor = section.style.color;

    // mint (index 2) has a different `ink` token (#F9F9EE) than the default
    // flavor[0] (lemon, #1D423C), so this exercises a real color change.
    const otherFlavor = flavors[2]!;
    const button = screen.getByRole("button", { name: new RegExp(otherFlavor.name, "i") });
    act(() => {
      button.click();
    });

    expect(section.style.color).not.toBe(initialColor);
    expect(section.style.color).toBe(hexToRgbString(otherFlavor.ink));
  });
});
