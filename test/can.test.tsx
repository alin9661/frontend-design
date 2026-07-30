import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Can from "@/components/svg/Can";

describe("components/svg/Can", () => {
  it("renders with body/accent/label props and shows the label text", () => {
    render(<Can body="#F7E27A" accent="#B98A12" label="Lemon Original" />);
    expect(screen.getByText("LEMON ORIGINAL")).toBeInTheDocument();
  });

  it("exposes role=img and an aria-label of '<label> can' when label is given", () => {
    render(<Can body="#F7E27A" accent="#B98A12" label="Lemon Original" />);
    const svg = screen.getByRole("img", { name: "Lemon Original can" });
    expect(svg).toBeInTheDocument();
  });

  it("has no img role when label is omitted", () => {
    const { container } = render(<Can body="#F7E27A" accent="#B98A12" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const svg = container.querySelector("svg");
    expect(svg).not.toHaveAttribute("role");
    expect(svg).not.toHaveAttribute("aria-label");
  });
});
