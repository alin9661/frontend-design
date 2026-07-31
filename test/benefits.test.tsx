import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Benefits from "@/components/Benefits";

describe("components/Benefits", () => {
  it("renders all three benefit card titles", () => {
    render(<Benefits />);
    expect(screen.getByText("ANTIOXIDANTS & NUTRIENTS")).toBeInTheDocument();
    expect(screen.getByText("MENTAL CLARITY & FOCUS")).toBeInTheDocument();
    expect(screen.getByText("SMOOTH, SUSTAINED LIFT")).toBeInTheDocument();
  });

  it("marks the decorative floating leaf wrappers aria-hidden", () => {
    const { container } = render(<Benefits />);
    const decorativeLeaves = container.querySelectorAll(
      '[aria-hidden="true"] svg'
    );
    expect(decorativeLeaves.length).toBe(3);
    for (const leaf of Array.from(decorativeLeaves)) {
      expect(leaf.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
