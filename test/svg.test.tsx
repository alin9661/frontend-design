import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import Leaf from "@/components/svg/Leaf";
import Citrus from "@/components/svg/Citrus";
import Berry from "@/components/svg/Berry";
import Can from "@/components/svg/Can";

describe("components/svg decorative icons", () => {
  it("Leaf renders an svg and applies the color prop to its fill", () => {
    const { container } = render(<Leaf color="#123456" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(container.querySelector('path[fill="#123456"]')).toBeInTheDocument();
  });

  it("Citrus renders an svg and applies the color prop", () => {
    const { container } = render(<Citrus color="#abcdef" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(container.querySelector('circle[fill="#abcdef"]')).toBeInTheDocument();
  });

  it("Berry renders an svg and applies the color prop to its drupelets", () => {
    const { container } = render(<Berry color="#fedcba" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(container.querySelector('circle[fill="#fedcba"]')).toBeInTheDocument();
  });

  it("smoke-tests two Cans with the same colors rendered on one page (note: they mint duplicate gradient/clip ids)", () => {
    // Can builds SVG def ids from the body/accent hex values, so two Can
    // instances sharing a flavor's colors emit duplicate id="..." defs in
    // the document. That's a pre-existing correctness issue (not something
    // this test enforces or fixes) — just confirm both still render.
    const { container } = render(
      <div>
        <Can body="#7CC9B5" accent="#14574A" label="Mint Limeade" />
        <Can body="#7CC9B5" accent="#14574A" label="Mint Limeade" />
      </div>
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
  });
});
