import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import Home from "@/app/page";
// Route tests render through the real provider stack (strict LazyMotion), so
// a stray full `motion.*` element anywhere on "/" throws here instead of only
// in the browser. See test/test-utils/render-in-app.tsx.
import { renderInApp as render } from "./test-utils/render-in-app";

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
    expect(screen.getByRole("heading", { level: 1, name: /ENERGY HAS ROOTS/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "FIVE FLAVORS. ONE LIFT." })
    ).toBeInTheDocument(); // FlavorShowcase
    expect(
      screen.getByRole("heading", { name: "Yerba mate carries more than caffeine." })
    ).toBeInTheDocument(); // Benefits
    expect(
      screen.getByRole("heading", { name: /unofficial fan advertisement/i })
    ).toBeInTheDocument(); // SocialProof
    expect(screen.getByRole("heading", { name: "FEEL THE LIFT" })).toBeInTheDocument(); // Footer
  });
});
