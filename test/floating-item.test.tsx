import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import FloatingItem from "@/components/FloatingItem";

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
});
