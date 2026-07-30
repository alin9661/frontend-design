import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FlavorShowcase from "@/components/FlavorShowcase";
import { flavors } from "@/lib/flavors";

describe("components/FlavorShowcase", () => {
  it("renders a picker button for every flavor with an aria-label", () => {
    render(<FlavorShowcase />);
    for (const flavor of flavors) {
      expect(screen.getByRole("button", { name: flavor.name })).toBeInTheDocument();
    }
  });

  it("has exactly one picker pressed at a time, and moves the pressed state + live region on click", async () => {
    const user = userEvent.setup();
    render(<FlavorShowcase />);

    const buttons = flavors.map((f) => screen.getByRole("button", { name: f.name }));
    const pressed = () => buttons.filter((b) => b.getAttribute("aria-pressed") === "true");

    expect(pressed()).toHaveLength(1);
    expect(pressed()[0]).toHaveAccessibleName(flavors[0].name);
    expect(screen.getByText(`${flavors[0].name} selected`)).toBeInTheDocument();

    await user.click(buttons[2]);

    expect(pressed()).toHaveLength(1);
    expect(pressed()[0]).toHaveAccessibleName(flavors[2].name);
    expect(screen.getByText(`${flavors[2].name} selected`)).toBeInTheDocument();
  });
});
