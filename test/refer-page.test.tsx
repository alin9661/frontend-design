import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReferPage from "@/app/refer/page";
// Route tests render through the real provider stack (strict LazyMotion), so
// a stray full `motion.*` element on /refer throws here instead of only in
// the browser. See test/test-utils/render-in-app.tsx.
import { renderInApp as render } from "./test-utils/render-in-app";
import { setReducedMotion } from "./setup";

const stepHeading = () => screen.getByRole("heading", { level: 1 });

describe("app/refer/page", () => {
  beforeEach(() => {
    // Pins both fake terminals to their instant, no-timer branch so this suite
    // exercises the step machine without racing setTimeout against userEvent.
    // The timed branch has its own coverage in refer-clearance-step.test.tsx.
    setReducedMotion(true);
  });

  it("opens on step 01, CLEARANCE, with Back disabled", () => {
    render(<ReferPage />);
    expect(stepHeading()).toHaveTextContent(/step 01 \/ 05/i);
    expect(stepHeading()).toHaveTextContent(/clearance/i);
    expect(screen.getByRole("button", { name: /back/i })).toBeDisabled();
  });

  it("walks all five steps through to the referral action", async () => {
    const user = userEvent.setup();
    render(<ReferPage />);

    await user.click(screen.getByRole("button", { name: /begin analysis/i }));
    expect(stepHeading()).toHaveTextContent(/link analysis/i);

    await user.click(screen.getByRole("button", { name: /resolve link/i }));
    expect(stepHeading()).toHaveTextContent(/entity resolution/i);

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /commit object/i }));
    expect(stepHeading()).toHaveTextContent(/pipeline build/i);

    await user.click(screen.getByRole("button", { name: /deploy artifact/i }));
    expect(stepHeading()).toHaveTextContent(/step 05 \/ 05/i);
    expect(
      screen.getByRole("button", { name: /^submit referral$/i }),
    ).toBeInTheDocument();
  });

  it("blocks entity resolution until the acknowledgement is checked", async () => {
    const user = userEvent.setup();
    render(<ReferPage />);

    await user.click(screen.getByRole("button", { name: /begin analysis/i }));
    await user.click(screen.getByRole("button", { name: /resolve link/i }));

    const gated = screen.getByRole("button", { name: /acknowledge to continue/i });
    expect(gated).toBeDisabled();

    await user.click(gated);
    expect(stepHeading()).toHaveTextContent(/entity resolution/i);

    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: /commit object/i }),
    ).toBeEnabled();
  });

  it("steps back to the previous step", async () => {
    const user = userEvent.setup();
    render(<ReferPage />);

    await user.click(screen.getByRole("button", { name: /begin analysis/i }));
    expect(stepHeading()).toHaveTextContent(/link analysis/i);

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(stepHeading()).toHaveTextContent(/clearance/i);
  });

  it("describes the link-analysis graph for screen readers", async () => {
    // The unresolved link is the whole premise, and it exists only as SVG
    // geometry — without this label the step is empty to a screen reader.
    const user = userEvent.setup();
    render(<ReferPage />);
    await user.click(screen.getByRole("button", { name: /begin analysis/i }));

    const graph = screen.getByRole("img");
    expect(graph).toHaveAccessibleName(/unresolved/i);
    expect(graph).toHaveAccessibleName(/confidence 0\.94/i);
  });

  it("carries the unaffiliated-parody disclaimer on every step", () => {
    render(<ReferPage />);
    expect(screen.getByText(/unaffiliated parody/i)).toBeInTheDocument();
  });
});
