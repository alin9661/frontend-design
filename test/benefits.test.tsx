import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Benefits from "@/components/Benefits";
import { setReducedMotion } from "./setup";

const benefitHeadings = [
  "ANTIOXIDANTS & NUTRIENTS",
  "MENTAL CLARITY & FOCUS",
  "SMOOTH, SUSTAINED LIFT",
];

const benefitBodies = [
  "More than caffeine — yerba mate brings antioxidants, vitamins, and minerals to the pour.",
  "Naturally supports alertness, concentration, and a calm, focused state of mind.",
  "A clean, balanced boost — without the jitters or crash of coffee and energy drinks.",
];

afterEach(() => {
  cleanup();
  setReducedMotion(false);
});

function expectFullBenefitContent() {
  for (const heading of benefitHeadings) {
    expect(screen.getByRole("heading", { level: 3, name: heading })).toBeInTheDocument();
  }

  for (const body of benefitBodies) {
    expect(screen.getByText(body)).toBeInTheDocument();
  }
}

describe("components/Benefits", () => {
  it("keeps the benefits anchor and renders all three benefit headings", () => {
    const { container } = render(<Benefits />);

    expect(container.querySelector("section#benefits")).toBeInTheDocument();
    expectFullBenefitContent();
  });

  it("marks each oversized ingredient illustration as decorative", () => {
    const { container } = render(<Benefits />);
    const art = container.querySelectorAll("[data-benefit-art]");

    expect(art).toHaveLength(3);
    for (const illustration of art) {
      expect(illustration).toHaveAttribute("aria-hidden", "true");
      expect(illustration.querySelector("svg")).toBeInTheDocument();
    }
  });

  it("renders the complete asymmetric composition without motion", () => {
    setReducedMotion(true);
    const { container } = render(<Benefits />);

    expect(container.querySelector('[data-benefits-mode="static"]')).toBeInTheDocument();
    expectFullBenefitContent();
  });

  it("renders the complete scroll-reveal composition when motion is allowed", () => {
    setReducedMotion(false);
    const { container } = render(<Benefits />);

    expect(container.querySelector('[data-benefits-mode="animated"]')).toBeInTheDocument();
    expectFullBenefitContent();
  });
});
