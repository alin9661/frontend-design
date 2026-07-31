import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import FloatingItem from "@/components/FloatingItem";
import { setReducedMotion } from "./setup";

describe("components/FloatingItem", () => {
  it("renders its children", () => {
    render(
      <FloatingItem x="10%" y="20%">
        <span>floating child</span>
      </FloatingItem>
    );
    expect(screen.getByText("floating child")).toBeInTheDocument();
  });

  it("marks the outer wrapper aria-hidden and pointer-events none", () => {
    const { container } = render(
      <FloatingItem x="10%" y="20%">
        <span>floating child</span>
      </FloatingItem>
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveAttribute("aria-hidden", "true");
    expect(outer).toHaveStyle({ pointerEvents: "none" });
  });

  it("positions the outer wrapper at the given x/y", () => {
    const { container } = render(
      <FloatingItem x="42%" y="17%">
        <span>floating child</span>
      </FloatingItem>
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveStyle({ position: "absolute", left: "42%", top: "17%" });
  });

  it("zeroes out the parallax offset and disables the idle bob under reduced motion", () => {
    setReducedMotion(true);
    const { container } = render(
      <FloatingItem x="10%" y="20%" depth={1}>
        <span>floating child</span>
      </FloatingItem>
    );
    const outer = container.firstElementChild as HTMLElement;
    // x/y are hard-pinned to 0 under reduced motion, which framer-motion
    // renders as no transform at all rather than translate(0px, 0px).
    expect(outer).toHaveStyle({ transform: "none" });

    // The inner wrapper only gets an animate-driven inline style when the
    // idle bob animation is active; under reduced motion `animate` is
    // undefined, so no style attribute is rendered at all.
    const inner = outer.firstElementChild as HTMLElement;
    expect(inner).not.toHaveAttribute("style");
  });
});
