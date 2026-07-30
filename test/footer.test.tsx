import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Footer from "@/components/Footer";

describe("components/Footer", () => {
  it("links SHOP MATEÍNA to the external store, opened in a new tab safely", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: "SHOP MATEÍNA" });
    expect(link).toHaveAttribute("href", "https://drinkmateina.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the fan-advertisement disclaimer", () => {
    render(<Footer />);
    expect(screen.getByText(/unofficial fan advertisement/i)).toBeInTheDocument();
  });

  it("marks the giant MATEÍNA watermark aria-hidden", () => {
    render(<Footer />);
    const watermark = screen.getByText("MATEÍNA");
    expect(watermark).toHaveAttribute("aria-hidden", "true");
  });
});
