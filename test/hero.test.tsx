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

  it("drives the primary CTA's hover/tap feedback from motion, not CSS scale utilities", () => {
    // The CTA moved from a plain <a> with `transition-transform
    // hover:scale-105 active:scale-95` to a motion.a with whileHover/whileTap
    // + CTA_SPRING, so the spring owns the feedback. Leaving the utilities
    // behind would double up two competing transforms on the same element.
    render(<Hero />);
    const cta = screen.getByRole("link", { name: "SHOP THE FLAVORS" });

    expect(cta).toHaveAttribute("href", "#flavors"); // navigation is unchanged
    expect(cta.className).not.toMatch(/hover:scale-/);
    expect(cta.className).not.toMatch(/active:scale-/);
    expect(cta.className).not.toMatch(/transition-transform/);
    // The secondary link is a plain <a> and keeps its own colour transition.
    expect(
      screen.getByRole("link", { name: "WHAT IS YERBA MATE? ↓" }).className
    ).toMatch(/transition-colors/);
  });

  it("E1 regression: the primary CTA exposes a focus-visible ring for keyboard users", () => {
    // Switching from CSS hover/active classes to framer whileHover/whileTap
    // (the test just above) left keyboard users with only the UA default
    // ring on a `rounded-full` pill while pointer users got a spring — this
    // assertion would FAIL against that pre-fix className, which contained
    // none of these focus-visible utilities.
    render(<Hero />);
    const cta = screen.getByRole("link", { name: "SHOP THE FLAVORS" });

    expect(cta.className).toMatch(/focus-visible:ring-2/);
    expect(cta.className).toMatch(/focus-visible:ring-forest\b/);
    expect(cta.className).toMatch(/focus-visible:ring-offset-2/);
    expect(cta.className).toMatch(/focus-visible:outline-none/);
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
