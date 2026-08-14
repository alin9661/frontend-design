import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import ClearanceStep from "@/components/refer/ClearanceStep";
import { setReducedMotion } from "./setup";

const FIRST_LINE = /initializing REFERRAL ONTOLOGY/i;
const LAST_LINE = /escalating to operator/i;

// TerminalLog's per-line gap. Kept in sync by hand; if these drift the timed
// test fails loudly rather than silently passing for the wrong reason.
const LINE_DELAY_MS = 180;

afterEach(() => {
  vi.useRealTimers();
});

describe("components/refer/ClearanceStep", () => {
  it("renders the whole log immediately under reduced motion", () => {
    // Reduced-motion branch of useTimedLog, shared with PipelineStep. Without
    // it the terminal would start empty and stay empty, since the timers that
    // would have filled it are never scheduled.
    setReducedMotion(true);
    render(<ClearanceStep />);

    expect(screen.getByText(FIRST_LINE)).toBeInTheDocument();
    expect(screen.getByText(LAST_LINE)).toBeInTheDocument();
  });

  // Each revealed line re-renders, and only then does the effect schedule the
  // *next* timer. So a single large advanceTimersByTime() would fire one timer
  // and stop — ticks have to be pumped one at a time, each in its own act().
  function tick(times: number) {
    for (let i = 0; i < times; i += 1) {
      act(() => {
        vi.advanceTimersByTime(LINE_DELAY_MS);
      });
    }
  }

  it("types the log out one line at a time when motion is allowed", () => {
    vi.useFakeTimers();
    render(<ClearanceStep />);

    // Nothing has been typed on the first frame.
    expect(screen.queryByText(FIRST_LINE)).not.toBeInTheDocument();

    tick(1);
    expect(screen.getByText(FIRST_LINE)).toBeInTheDocument();
    expect(screen.queryByText(LAST_LINE)).not.toBeInTheDocument();

    // Comfortably more ticks than the log has lines; the reveal stops on its
    // own once it runs out.
    tick(30);
    expect(screen.getByText(LAST_LINE)).toBeInTheDocument();
  });

  it("announces the terminal as a single polite live region", () => {
    // Per-line live regions would make a screen reader stutter through a
    // twelve-line joke one fragment at a time.
    setReducedMotion(true);
    const { container } = render(<ClearanceStep />);
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });
});
