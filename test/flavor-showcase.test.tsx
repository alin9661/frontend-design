import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { motionValue, type MotionValue } from "framer-motion";
import Providers from "@/app/providers";
import FlavorShowcase from "@/components/FlavorShowcase";
import { flavors } from "@/lib/flavors";
import { EASE_OUT_CSS } from "@/lib/motion";
import {
  activeCanIndex,
  createShelfHandoff,
  handoffLayerOpacities,
  handoffProgress,
} from "@/lib/visuals/shelf-to-showcase";
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

// NOTE ON ORDER: the handoff suite runs FIRST, on purpose. Faking setInterval
// (which the auto-advance suite below must do) permanently kills jsdom's
// requestAnimationFrame for the rest of the file, and framer resolves a derived
// motion value on a frame — so every frame-dependent assertion has to run
// before the first vi.useFakeTimers() call in this file.

/**
 * The showcase's leg of the handoff. `filmProgress: 1` is what the component
 * itself passes: by the time this section's top has entered the viewport the
 * film below it has necessarily finished.
 */
function showcaseHandoff(model: ReturnType<typeof createShelfHandoff>, entrance: number) {
  return handoffProgress(model, { filmProgress: 1, showcaseProgress: entrance });
}

describe("components/FlavorShowcase — shelf-to-showcase handoff (C11)", () => {
  // Deliberately REAL timers, unlike the suite below: faking setInterval
  // freezes framer's frame loop, and a useTransform chain only resolves on a
  // frame — every assertion here would read the first render forever.
  beforeEach(() => {
    vi.useRealTimers();
  });

  /**
   * `m.*` only binds motion values under <LazyMotion>, which app/providers.tsx
   * supplies in production. Rendering the showcase bare (as the suite below
   * does, since it never reads an animated style) leaves the crossfade frozen
   * at its first-render value.
   */
  function renderShowcase(entrance?: MotionValue<number>) {
    return render(
      <Providers>
        <FlavorShowcase showcaseProgress={entrance} />
      </Providers>,
    );
  }

  /** Moves the entrance and lets framer recompute, render, and React commit. */
  async function enter(progress: MotionValue<number>, value: number) {
    await act(async () => {
      progress.set(value);
      // Two frames, not one: framer schedules the style write on the frame
      // after the value settles.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
  }

  function layerOpacity(container: HTMLElement): number {
    const layer = container.querySelector<HTMLElement>("[data-showcase-handoff]");
    if (!layer) throw new Error("No showcase handoff layer rendered");
    return Number(layer.style.opacity);
  }

  it("takes its active flavor from the shared model at every point of the entrance", async () => {
    const model = createShelfHandoff({ reducedMotion: false });
    const entrance = motionValue(0);
    renderShowcase(entrance);

    // Deliberately not starting at 0: the component opens on flavor 0 and a
    // set(0) on a value already at 0 emits no change, so a sweep that began
    // there would assert the default rather than the wiring.
    for (const sample of [0.2, 0.45, 0.7, 0.9, 1, 0]) {
      await enter(entrance, sample);
      const expected = flavors[activeCanIndex(model, showcaseHandoff(model, sample))];
      expect(pressedFlavorName()).toBe(expected.name);
    }
  });

  it("does not swap flavors just because the section came into view", async () => {
    // Regression: the handoff already reads `seam` (0.5 at the default
    // weights) the moment this section's top touches the bottom of the
    // viewport, so an active index taken from the raw handoff started at
    // `round(0.5 * 5) === 3`. Simply scrolling the section into view then
    // strobed 3 -> 4 -> 0, firing a full can entrance/exit, a section-wide
    // background lerp, a backdrop-name crossfade and a tagline swap twice
    // before the visitor had scrolled into the section at all.
    const entrance = motionValue(0);
    renderShowcase(entrance);

    expect(pressedFlavorName()).toBe(flavors[0].name);

    // Nudge the entrance the way a scroll actually does — still the first
    // flavor, because the sweep belongs to this section's own leg.
    for (const sample of [0.001, 0.01, 0.05]) {
      await enter(entrance, sample);
      expect(pressedFlavorName()).toBe(flavors[0].name);
    }
  });

  it("rotates the ring one can at a time and delivers the first flavor to the front", async () => {
    const entrance = motionValue(0);
    renderShowcase(entrance);

    const names = flavors.map((flavor) => flavor.name);
    // Seeded from the first SAMPLE, not from the component's pre-scroll
    // default: the handoff has not spoken yet at that point, so including it
    // would measure the default rather than the rotation.
    const seenOrder: number[] = [];
    for (let step = 1; step <= 40; step += 1) {
      await enter(entrance, step / 40);
      const index = names.indexOf(pressedFlavorName()!);
      if (index !== seenOrder[seenOrder.length - 1]) seenOrder.push(index);
    }

    // The showcase leg is the back half of one revolution (the film owns the
    // front half), so it must pass through more than one can...
    expect(seenOrder.length).toBeGreaterThan(2);
    // ...never skip one — a skipped can is the carousel cutting rather than
    // rotating...
    for (let i = 1; i < seenOrder.length; i += 1) {
      const step = (seenOrder[i] - seenOrder[i - 1] + flavors.length) % flavors.length;
      expect(step).toBe(1);
    }
    // ...and settle on the flavor the showcase itself opens with.
    expect(pressedFlavorName()).toBe(flavors[0].name);
  });

  it("crossfades its layer on the model's own track, complementing the film's", async () => {
    const model = createShelfHandoff({ reducedMotion: false });
    const entrance = motionValue(0);
    const { container } = renderShowcase(entrance);

    for (const sample of [0.1, 0.5, 1]) {
      await enter(entrance, sample);
      const { film, showcase } = handoffLayerOpacities(model, showcaseHandoff(model, sample));
      expect(layerOpacity(container)).toBeCloseTo(showcase, 6);
      // The film's shelf row is fading out on exactly the complement, so the
      // boundary never shows a hole or a double-exposure.
      expect(film + showcase).toBeCloseTo(1, 10);
    }

    expect(layerOpacity(container)).toBe(1);
  });

  it("lets a manual pick outrank the handoff for good", async () => {
    const entrance = motionValue(0);
    renderShowcase(entrance);

    fireEvent.click(screen.getByRole("button", { name: flavors[2].name }));
    expect(pressedFlavorName()).toBe(flavors[2].name);

    await enter(entrance, 0.6);
    await enter(entrance, 1);
    expect(pressedFlavorName()).toBe(flavors[2].name);
  });

  it("never moves the flavor under reduced motion, but still swaps the layers", async () => {
    setReducedMotion(true);
    const model = createShelfHandoff({ reducedMotion: true });
    const entrance = motionValue(0);
    const { container } = renderShowcase(entrance);

    for (const sample of [0.3, 0.7, 1]) {
      await enter(entrance, sample);
      expect(pressedFlavorName()).toBe(flavors[0].name);
    }

    // The travel is gone; the crossfade is not, because a layer swap is not
    // motion the visitor asked to be spared.
    expect(layerOpacity(container)).toBeCloseTo(
      handoffLayerOpacities(model, showcaseHandoff(model, 1)).showcase,
      6,
    );
  });

  it("suspends the auto-advance timer while the handoff travels, and re-arms it once it lands", async () => {
    // Asserted through the scheduler rather than by advancing a fake clock:
    // faking setInterval is exactly what would freeze the frames this test
    // needs to move the handoff at all.
    const scheduled = vi.spyOn(window, "setInterval");
    const armings = () =>
      scheduled.mock.calls.filter(([, ms]) => ms === AUTO_ADVANCE_MS).length;

    const entrance = motionValue(0);
    renderShowcase(entrance);

    // Armed on mount: an untouched carousel rotates itself.
    expect(armings()).toBeGreaterThan(0);
    scheduled.mockClear();

    // Mid-handoff the visitor's scroll owns the flavor, so no tick may be
    // waiting to land on top of it.
    await enter(entrance, 0.5);
    expect(armings()).toBe(0);

    // Handoff over, the carousel is the showcase's own again.
    await enter(entrance, 1);
    expect(armings()).toBeGreaterThan(0);

    scheduled.mockRestore();
  });

  it("falls back to its own section scroll when no entrance is injected", () => {
    const model = createShelfHandoff({ reducedMotion: false });
    const { container } = renderShowcase();

    // jsdom pins framer's real useScroll at 0, i.e. the section's top is still
    // at the bottom of the viewport — the moment the film hands over. The
    // layer must already read the seam value from the model there rather than
    // starting from a hardcoded 0 or 1.
    expect(layerOpacity(container)).toBeCloseTo(
      handoffLayerOpacities(model, showcaseHandoff(model, 0)).showcase,
      6,
    );
    expect(pressedFlavorName()).toBe(flavors[0].name);
  });
});

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

  it("has exactly one picker pressed at a time, and the live region only announces manual picks", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<FlavorShowcase />);

    const buttons = flavors.map((f) => screen.getByRole("button", { name: f.name }));
    const pressed = () => buttons.filter((b) => b.getAttribute("aria-pressed") === "true");

    expect(pressed()).toHaveLength(1);
    expect(pressed()[0]).toHaveAccessibleName(flavors[0].name);
    // Nothing has been manually picked yet (the initial flavor is just the
    // default, not a "selection"), so the live region must stay silent.
    expect(screen.queryByText(`${flavors[0].name} selected`)).not.toBeInTheDocument();

    await user.click(buttons[2]);

    expect(pressed()).toHaveLength(1);
    expect(pressed()[0]).toHaveAccessibleName(flavors[2].name);
    expect(screen.getByText(`${flavors[2].name} selected`)).toBeInTheDocument();
  });

  it("snaps the picker dot's selection ring on a short ease-out, and rings only the active dot", () => {
    render(<FlavorShowcase />);

    const dotOf = (name: string): HTMLElement =>
      screen.getByRole("button", { name }).firstElementChild as HTMLElement;

    const activeDot = dotOf(flavors[0].name);
    const inactiveDot = dotOf(flavors[1].name);

    // The ring is direct click feedback, so it tracks the pointer rather
    // than the 600ms flavor swap it used to be timed against — and it runs on
    // the page's OWN curve. Asserted against the resolved transition rather
    // than a Tailwind class name, because `ease-out` the utility is a
    // different bezier from EASE_OUT the token: the class-name form of this
    // assertion passed happily while the dot animated off-vocabulary.
    for (const dot of [activeDot, inactiveDot]) {
      expect(dot.style.transition).toContain(EASE_OUT_CSS);
      expect(dot.style.transition).toContain("box-shadow");
      expect(dot.style.transition).toMatch(/\b200ms\b/);
    }

    // Both branches of the box-shadow conditional: the selected dot gets the
    // accent ring, every other dot keeps its hairline so it never disappears
    // against a same-colored background.
    expect(activeDot.style.boxShadow).toBe(`0 0 0 3px ${flavors[0].accent}`);
    expect(inactiveDot.style.boxShadow).toBe("inset 0 0 0 1.5px rgba(29,66,60,0.35)");
  });

  it("D2 regression: the dot button's own hover-scale transition matches its inner ring's curve exactly", () => {
    // Pre-fix, the button itself was `transition-transform duration-300`
    // (Tailwind's untouched default timing function) while its inner span
    // (the ring) was on a 200ms curve — one dot, two curves. Both now name
    // the same shared token, and the assertion compares the two resolved
    // curves against each other rather than against a class name, so a
    // future retune of EASE_OUT cannot desynchronise them silently.
    render(<FlavorShowcase />);
    const button = screen.getByRole("button", { name: flavors[0].name });
    const dot = button.firstElementChild as HTMLElement;

    expect(button.style.transition).toContain("transform");
    expect(button.style.transition).toContain(EASE_OUT_CSS);
    expect(button.style.transition).toMatch(/\b200ms\b/);
    // Same curve, same duration, different property — one dot, one motion.
    const curveOf = (el: HTMLElement) => el.style.transition.replace(/^\S+\s/, "");
    expect(curveOf(button)).toBe(curveOf(dot));
    // And neither reaches for Tailwind's easing utilities any more.
    expect(button.className).not.toMatch(/\bease-(in|out|in-out)\b/);
    expect(dot.className).not.toMatch(/\bease-(in|out|in-out)\b/);
  });

  it("does not have aria-current on the picker buttons (aria-pressed is the sole toggle signal)", () => {
    render(<FlavorShowcase />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toHaveAttribute("aria-current");
    }
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

  it("permanently stops auto-advance once a dot is clicked manually", () => {
    render(<FlavorShowcase />);

    // A plain click event (rather than userEvent.click) keeps this test
    // focused purely on the manual-selection contract, without also
    // exercising userEvent's realistic pointer choreography (which also
    // fires pointerenter on the <section> ancestor).
    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS / 2);
    });
    fireEvent.click(screen.getByRole("button", { name: flavors[2].name }));
    expect(pressedFlavorName()).toBe(flavors[2].name);

    // Per the current contract (WCAG 2.2.2), a manual pick stops
    // auto-advance for good — it must never resume, no matter how much time
    // passes afterward.
    act(() => {
      vi.advanceTimersByTime(AUTO_ADVANCE_MS * 5);
    });
    expect(pressedFlavorName()).toBe(flavors[2].name);
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
