import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "@/app/page";

describe("app/page", () => {
  it("every in-page anchor targets an id that exists in the document", () => {
    const { container } = render(<Home />);
    const anchors = container.querySelectorAll('a[href^="#"]');
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of Array.from(anchors)) {
      const id = anchor.getAttribute("href")!.slice(1);
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("renders all five sections' headings/landmarks", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(); // Hero
    expect(
      screen.getByRole("heading", { name: "FIVE FLAVORS. ONE LIFT." })
    ).toBeInTheDocument(); // FlavorShowcase
    expect(
      screen.getByRole("heading", { name: "BETTER ENERGY STARTS HERE" })
    ).toBeInTheDocument(); // Benefits
    expect(
      screen.getByRole("img", { name: "Five out of five stars" })
    ).toBeInTheDocument(); // SocialProof
    expect(screen.getByRole("heading", { name: "FEEL THE LIFT" })).toBeInTheDocument(); // Footer
  });
});
