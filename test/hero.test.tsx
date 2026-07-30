import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Hero from "@/components/Hero";

describe("components/Hero", () => {
  it("renders an h1 containing SMOOTH LIFT and ZERO CRASH", () => {
    render(<Hero />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/SMOOTH LIFT\./);
    expect(heading).toHaveTextContent(/ZERO CRASH\./);
  });

  it("links the CTAs to #flavors and #benefits", () => {
    render(<Hero />);
    expect(screen.getByRole("link", { name: "SHOP THE FLAVORS" })).toHaveAttribute(
      "href",
      "#flavors"
    );
    expect(
      screen.getByRole("link", { name: "WHAT IS YERBA MATE? ↓" })
    ).toHaveAttribute("href", "#benefits");
  });

  it("renders both decor cans with their flavor aria-labels", () => {
    render(<Hero />);
    // The decor cans live inside FloatingItem, which is aria-hidden (it's
    // pure decoration), so they're excluded from the accessibility tree by
    // default — pass `hidden: true` to look past that and confirm the SVGs
    // themselves are still labeled correctly.
    expect(
      screen.getByRole("img", { name: "Mint Limeade can", hidden: true })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Raspberry Yuzu can", hidden: true })
    ).toBeInTheDocument();
  });
});
