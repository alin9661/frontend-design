import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SubmitReferralStep from "@/components/refer/SubmitReferralStep";
import { buildReferralBlurb, referral } from "@/lib/referral";

// jsdom has no clipboard, so every test here installs its own. `fireEvent` is
// used rather than `userEvent` on purpose: userEvent.setup() installs its own
// clipboard stub, which would silently shadow the one under test.
function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

const submitButton = () =>
  screen.getByRole("button", { name: /^submit referral$/i });

afterEach(() => {
  stubClipboard(undefined);
});

describe("components/refer/SubmitReferralStep", () => {
  it("copies the built referral blurb, verbatim, to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    render(<SubmitReferralStep />);

    fireEvent.click(submitButton());

    expect(await screen.findByText(/1 link resolved/i)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(buildReferralBlurb(referral));
  });

  it("reports a failure instead of silently doing nothing when there is no clipboard", async () => {
    // The clipboard IS the delivery mechanism for this page, so a no-op
    // button that still looks successful would lose the entire point.
    stubClipboard(undefined);
    render(<SubmitReferralStep />);

    fireEvent.click(submitButton());

    expect(await screen.findByText(/clipboard unavailable/i)).toBeInTheDocument();
  });

  it("reports a failure when the clipboard write is rejected", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    render(<SubmitReferralStep />);

    fireEvent.click(submitButton());

    expect(await screen.findByText(/clipboard unavailable/i)).toBeInTheDocument();
  });

  it("shows the payload on screen so it can be copied by hand as a fallback", () => {
    stubClipboard(undefined);
    render(<SubmitReferralStep />);
    // `normalizer: (s) => s` disables Testing Library's default whitespace
    // collapsing — the blurb's blank lines between paragraphs are part of what
    // gets pasted, so the assertion has to compare them literally.
    expect(
      screen.getByText(buildReferralBlurb(referral), { normalizer: (s) => s }),
    ).toBeInTheDocument();
  });

  it("gives the friend an explicit way to say no", () => {
    // The social point of the page. If this line ever gets edited out, the
    // ask stops being a favor and starts being pressure.
    stubClipboard(undefined);
    render(<SubmitReferralStep />);
    expect(
      screen.getByText(/completely fine answer/i),
    ).toBeInTheDocument();
  });
});
