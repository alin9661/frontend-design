import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SocialProof from "@/components/SocialProof";

describe("components/SocialProof", () => {
  it("exposes the star rating as an accessible role=img with a label", () => {
    render(<SocialProof />);
    expect(
      screen.getByRole("img", { name: "Five out of five stars" })
    ).toBeInTheDocument();
  });

  it("shows the Huberman attribution text", () => {
    render(<SocialProof />);
    expect(screen.getByText("Dr. Andrew Huberman")).toBeInTheDocument();
    expect(screen.getByText(/Host of Huberman Lab/)).toBeInTheDocument();
  });
});
