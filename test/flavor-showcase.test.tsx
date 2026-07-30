import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FlavorShowcase from "@/components/FlavorShowcase";
import { flavors } from "@/lib/flavors";
import { setReducedMotion } from "./setup";

const AUTO_ADVANCE_MS = 4000;

// The currently aria-pressed picker button's accessible name, i.e. the
// active flavor.
function pressedFlavorName(): string | null {
  return (
    screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-pressed") === "true")
      ?.getAttribute("aria-label") ?? null
  );
}

describe("components/FlavorShowcase", () => {
  beforeEach(() => {
    // Only fake setInterval/clearInterval, the timers FlavorShowcase's
    // auto-advance relies on. Faking setTimeout too (vi.useFakeTimers()'s
    // default) hangs every userEvent.click() forever — something in
    // React/framer-motion's scheduling depends on a real setTimeout to
    // flush, and userEvent never gets a chance to resolve.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a picker button for every flavor with an aria-label", () => {
    render(<FlavorShowcase />);
    for (const flavor of flavors) {
      expect(screen.getByRole("button", { name: flavor.name })).toBeInTheDocument();
    }
  });

  it("has exactly one picker pressed at a time, and moves the pressed state + live region on click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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

  it("auto-advances to the next flavor every 4000ms and wraps from last back to first", () => {
    render(<FlavorShowcase />);

    expect(pressedFlavorName()).toBe(flavors[0].name);

    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS);
    });
    expect(pressedFlavorName()).toBe(flavors[1].name);

    // Advance through the rest of the flavors so the index wraps from the
    // last flavor back to the first.
    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS * (flavors.length - 1));
    });
    expect(pressedFlavorName()).toBe(flavors[0].name);
  });

  it("pauses auto-advance while a mouse pointer hovers the section, and resumes on pointer leave", () => {
    const { container } = render(<FlavorShowcase />);
    const section = container.querySelector("section")!;

    fireEvent.pointerEnter(section, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS * 2);
    });
    expect(pressedFlavorName()).toBe(flavors[0].name);

    fireEvent.pointerLeave(section, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS);
    });
    expect(pressedFlavorName()).toBe(flavors[1].name);
  });

  it("resets the auto-advance interval when a dot is clicked manually", () => {
    render(<FlavorShowcase />);

    // NOTE: uses fireEvent.click rather than userEvent.click. userEvent's
    // realistic pointer choreography also fires pointerenter on the
    // <section> ancestor (moving "into" the button counts as moving into
    // the section), which sets isHovering=true and permanently suspends
    // auto-advance after any click — see the bug noted in the task report.
    // A plain click event isolates the interval-reset behavior from that.
    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS / 2);
    });
    fireEvent.click(screen.getByRole("button", { name: flavors[2].name }));
    expect(pressedFlavorName()).toBe(flavors[2].name);

    // The interval should have restarted from the click, so it must take a
    // full 4000ms from here, not just the remainder of the interrupted one.
    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS - 1);
    });
    expect(pressedFlavorName()).toBe(flavors[2].name);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(pressedFlavorName()).toBe(flavors[3].name);
  });

  it("disables auto-advance under reduced motion, but manual selection still works", async () => {
    setReducedMotion(true);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<FlavorShowcase />);

    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS * 2);
    });
    expect(pressedFlavorName()).toBe(flavors[0].name);

    await user.click(screen.getByRole("button", { name: flavors[3].name }));
    expect(pressedFlavorName()).toBe(flavors[3].name);
  });
});
