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

  it("keeps all four staggered items inside the one reveal container, in reading order", () => {
    // The per-element `delay: 0/0.08/0.16/0.24` stack was replaced with a
    // single parent running staggerChildren, so every revealed item now has
    // to be a child of that one container — an item left outside it would
    // never animate in, and reordering would silently resequence the stagger.
    const { container } = render(<Footer />);
    const heading = screen.getByRole("heading", { name: "FEEL THE LIFT" });
    const tagline = screen.getByText("Zero sugar. Organic. Fair trade forever.");
    const cta = screen.getByRole("link", { name: "SHOP MATEÍNA" });
    const disclaimer = screen.getByText(/unofficial fan advertisement/i);

    const reveal = heading.parentElement!;
    expect(reveal.contains(tagline)).toBe(true);
    expect(reveal.contains(cta)).toBe(true);
    expect(reveal.contains(disclaimer)).toBe(true);

    // The giant watermark is deliberately NOT in the stagger — it has its own
    // slower, later reveal.
    expect(reveal.contains(screen.getByText("MATEÍNA"))).toBe(false);

    const order = Array.from(reveal.children);
    expect(order.indexOf(heading)).toBeLessThan(order.indexOf(tagline));
    expect(order.indexOf(tagline)).toBeLessThan(order.indexOf(cta.parentElement!));
    expect(order.indexOf(cta.parentElement!)).toBeLessThan(order.indexOf(disclaimer));

    expect(container.querySelector("footer")).toContainElement(reveal);
  });

  it("marks the giant MATEÍNA watermark aria-hidden", () => {
    render(<Footer />);
    const watermark = screen.getByText("MATEÍNA");
    expect(watermark).toHaveAttribute("aria-hidden", "true");
  });

  it("E1 regression: the CTA exposes a focus-visible ring (cream, offset against forest-deep) for keyboard users", () => {
    // Same gap as Hero's identical CTA (framer whileHover/whileTap replaced
    // CSS hover/active classes, leaving only the UA default ring for
    // keyboard users) — this pill is cream-on-forest-deep, so the ring/
    // offset colors are the inverse of Hero's forest-on-cream pill. This
    // assertion would FAIL against the pre-fix className.
    render(<Footer />);
    const cta = screen.getByRole("link", { name: "SHOP MATEÍNA" });

    expect(cta.className).toMatch(/focus-visible:ring-2/);
    expect(cta.className).toMatch(/focus-visible:ring-cream\b/);
    expect(cta.className).toMatch(/focus-visible:ring-offset-forest-deep/);
    expect(cta.className).toMatch(/focus-visible:outline-none/);
  });
});
