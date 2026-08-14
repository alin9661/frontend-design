import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SocialProof from "@/components/SocialProof";

describe("components/SocialProof", () => {
  it("keeps a single accessible label for the decorative marquee", () => {
    render(<SocialProof />);
    expect(
      screen.getByText("Join the #MateinaFamilia")
    ).toBeInTheDocument();
  });

  it("identifies the page as an unaffiliated fan-made concept", () => {
    const { container } = render(<SocialProof />);

    expect(
      screen.getByRole("heading", {
        name: "An unofficial fan advertisement for Mateína.",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/It is fan-made, not a brand campaign\./)
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("Huberman");
  });
});
