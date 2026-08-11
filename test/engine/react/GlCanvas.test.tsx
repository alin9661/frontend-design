// test/engine/react/GlCanvas.test.tsx
//
// GlCanvas is the engine's *surface slot*, not a surface: because
// `transferControlToOffscreen()` permanently consumes a canvas node, every
// RenderHost.init() attempt needs a node that has never been transferred.
// These cases pin the imperative `mint()` contract that guarantee rests on —
// a distinct node per call, the previous one detached, the decorative
// styling/a11y attributes carried over from the old inline <canvas>, a
// zero-layout wrapper, and the not-attached failure branch.

import { createRef } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GlCanvas, { type GlCanvasHandle } from "@/lib/engine/react/GlCanvas";

function renderSlot() {
  const ref = createRef<GlCanvasHandle>();
  const view = render(<GlCanvas ref={ref} />);
  if (!ref.current) throw new Error("GlCanvas did not expose its handle");
  return { handle: ref.current, ...view };
}

describe("@/lib/engine/react/GlCanvas — mint()", () => {
  it("renders no canvas until minted, so nothing can be transferred by accident", () => {
    const { container } = renderSlot();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("mints a decorative, full-viewport canvas attached inside the slot", () => {
    const { handle, container } = renderSlot();

    const canvas = handle.mint();

    expect(canvas.tagName).toBe("CANVAS");
    expect(container.querySelector("canvas")).toBe(canvas);
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    // Decorative + never intercepts clicks + painted behind all DOM content.
    expect(canvas.className).toContain("pointer-events-none");
    expect(canvas.className).toContain("fixed");
    expect(canvas.className).toContain("inset-0");
    expect(canvas.className).toContain("z-0");
  });

  it("returns a DISTINCT node per call and detaches the previous one", () => {
    const { handle, container } = renderSlot();

    const first = handle.mint();
    const second = handle.mint();

    expect(second).not.toBe(first);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelector("canvas")).toBe(second);
    expect(first.isConnected).toBe(false);
  });

  it("throws once the slot is detached, rather than silently minting an orphan", () => {
    const { handle, unmount } = renderSlot();

    // Sanity: the attached branch works before we take the slot away.
    expect(() => handle.mint()).not.toThrow();

    unmount();

    expect(() => handle.mint()).toThrow(/slot is not attached/);
  });

  it("wraps the surface in a zero-layout, aria-hidden slot", () => {
    const { container } = renderSlot();
    const slot = container.querySelector("[data-gl-canvas-slot]") as HTMLElement;

    expect(slot).not.toBeNull();
    // `display: contents` keeps the wrapper out of flex/grid layout entirely —
    // the pre-slot code rendered the fixed canvas with no wrapper at all.
    expect(slot.style.display).toBe("contents");
    expect(slot.getAttribute("aria-hidden")).toBe("true");
  });
});
