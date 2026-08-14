import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import SoundToggle, {
  SOUNDSCAPE_STORAGE_KEY,
  type SoundscapeHandle,
} from "@/components/SoundToggle";
import { setReducedMotion } from "./setup";

/* ------------------------------------------------------------------ */
/* A minimal Web Audio implementation for jsdom.                       */
/*                                                                     */
/* These tests deliberately run the REAL lib/audio/soundscape module    */
/* through the component's dynamic import — the point of the component  */
/* is the import boundary, so stubbing the module out would test        */
/* nothing. Only the browser API underneath is faked.                   */
/* ------------------------------------------------------------------ */

class FakeParam {
  value = 0;
  setValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeNode {
  connect() {}
  disconnect() {}
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = "lowpass";
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

class FakeSource extends FakeNode {
  startCount = 0;
  stopCount = 0;
  buffer: unknown = null;
  loop = false;
  type = "sine";
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  start() {
    this.startCount += 1;
  }
  stop() {
    this.stopCount += 1;
  }
}

/**
 * jsdom in this Vitest/Node combination exposes no `window.localStorage` at
 * all (Node's own shim needs `--localstorage-file`), so the persistence tests
 * would otherwise be asserting against an undefined global. This is a plain
 * in-memory Storage, installed for this file only.
 */
function installLocalStorage() {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, String(value)),
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
}

const contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 8000;
  state = "suspended";
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  resumeCount = 0;
  closeCount = 0;

  constructor() {
    contexts.push(this);
  }

  createGain() {
    return new FakeGain();
  }
  createBiquadFilter() {
    return new FakeFilter();
  }
  createOscillator() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { numberOfChannels: channels, length, sampleRate, getChannelData: () => data };
  }
  resume() {
    this.resumeCount += 1;
    this.state = "running";
    return Promise.resolve();
  }
  close() {
    this.closeCount += 1;
    this.state = "closed";
    return Promise.resolve();
  }
}

function installWebAudio() {
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
}

function toggleButton() {
  return screen.getByRole("button", { name: /ambient sound/i });
}

beforeEach(() => {
  contexts.length = 0;
  installLocalStorage();
  installWebAudio();
});

afterEach(() => {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe("SoundToggle accessibility", () => {
  it("is a real button that is off by default and states what it controls", () => {
    render(<SoundToggle />);

    const button = toggleButton();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("meets the 44px minimum hit target and carries a visible focus ring", () => {
    render(<SoundToggle />);

    const button = toggleButton();
    expect(button).toHaveStyle({ minHeight: "44px", minWidth: "44px" });
    // jsdom compiles no Tailwind, so the utility class is the only observable
    // proxy for "there is a focus-visible outline".
    expect(button.className).toMatch(/focus-visible:outline-2/);
    expect(button.className).toMatch(/focus-visible:outline-offset-2/);
  });

  it("is keyboard reachable and toggles from the keyboard", async () => {
    const user = userEvent.setup();
    render(<SoundToggle />);

    await user.tab();
    expect(toggleButton()).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(toggleButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("stays visible and usable under prefers-reduced-motion", async () => {
    setReducedMotion(true);
    const user = userEvent.setup();
    render(<SoundToggle />);

    // Sound and motion are different axes: reduced motion must not hide it.
    const button = toggleButton();
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);
    expect(toggleButton()).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(contexts).toHaveLength(1));
  });

  it("behaves identically with motion allowed", async () => {
    setReducedMotion(false);
    const user = userEvent.setup();
    render(<SoundToggle />);

    await user.click(toggleButton());
    expect(toggleButton()).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(contexts).toHaveLength(1));
  });
});

describe("SoundToggle enable/disable", () => {
  it("builds and starts the soundscape only once enabled", async () => {
    const user = userEvent.setup();
    render(<SoundToggle />);

    // Nothing exists before the gesture.
    expect(contexts).toHaveLength(0);

    await user.click(toggleButton());

    expect(toggleButton()).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(contexts).toHaveLength(1));
    expect(contexts[0].resumeCount).toBeGreaterThanOrEqual(1);
    expect(contexts[0].sources.length).toBeGreaterThan(0);
    expect(contexts[0].sources.every((source) => source.startCount === 1)).toBe(true);
  });

  it("disposes everything on toggle-off", async () => {
    const user = userEvent.setup();
    render(<SoundToggle />);

    await user.click(toggleButton());
    await waitFor(() => expect(contexts).toHaveLength(1));

    await user.click(toggleButton());

    expect(toggleButton()).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(contexts[0].closeCount).toBe(1));
    expect(contexts[0].sources.every((source) => source.stopCount === 1)).toBe(true);
    // A second enable builds a fresh context rather than reviving a closed one.
    await user.click(toggleButton());
    await waitFor(() => expect(contexts).toHaveLength(2));
  });

  it("hands the live soundscape to onSoundscapeChange and clears it on stop", async () => {
    const user = userEvent.setup();
    const seen: (SoundscapeHandle | null)[] = [];
    render(<SoundToggle onSoundscapeChange={(soundscape) => seen.push(soundscape)} />);

    await user.click(toggleButton());
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).not.toBeNull();

    await user.click(toggleButton());
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toBeNull();
  });

  it("forwards film progress to the running soundscape", async () => {
    const user = userEvent.setup();
    let handle: SoundscapeHandle | null = null;
    const onChange = (soundscape: SoundscapeHandle | null) => {
      handle = soundscape;
    };

    const { rerender } = render(<SoundToggle progress={0} onSoundscapeChange={onChange} />);
    await user.click(toggleButton());
    await waitFor(() => expect(handle).not.toBeNull());

    const levels = () =>
      (handle as unknown as { levels(): Record<string, number> }).levels();

    expect(levels()["forest-air"]).toBeCloseTo(1, 6);

    rerender(<SoundToggle progress={1} onSoundscapeChange={onChange} />);
    expect(levels()["room-tone"]).toBeCloseTo(1, 6);
    expect(levels()["forest-air"]).toBeCloseTo(0, 6);
  });

  it("survives a browser with no Web Audio at all, and does not claim to be playing", async () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    const user = userEvent.setup();
    const seen: (SoundscapeHandle | null)[] = [];
    render(<SoundToggle onSoundscapeChange={(soundscape) => seen.push(soundscape)} />);

    await user.click(toggleButton());

    // Nothing throws, nothing is built...
    expect(contexts).toHaveLength(0);
    // The only thing the caller hears about is the withdrawal.
    expect(seen).toEqual([null]);
    // ...and the control settles back to off. `aria-pressed="true"` over a
    // platform that cannot produce sound tells a screen-reader user "Ambient
    // sound, pressed" and then plays nothing, which is a worse outcome than
    // the toggle appearing not to take.
    await waitFor(() => expect(toggleButton()).toHaveAttribute("aria-pressed", "false"));
  });

  it("creates and resumes the AudioContext before it awaits the synth chunk (WebKit gesture chain)", async () => {
    // WebKit only unlocks a context created or resumed while it is still
    // processing the user gesture. `await import("@/lib/audio/soundscape")` is
    // a network/parse boundary that ends that window, so a context built on
    // its far side stays suspended forever: `aria-pressed="true"` over
    // silence, with nothing in the console. Asserting on the tick BEFORE the
    // dynamic import can resolve is what pins the ordering.
    render(<SoundToggle />);

    // fireEvent, not userEvent: this must be observed on the tick the click
    // handler returns, before any microtask has let the `await import()`
    // settle — which is exactly the window WebKit cares about.
    fireEvent.click(toggleButton());

    // Synchronously after the click handler: the context already exists and
    // has been asked to resume, long before the synth module has landed.
    expect(contexts).toHaveLength(1);
    expect(contexts[0].resumeCount).toBeGreaterThanOrEqual(1);
    expect(contexts[0].sources).toHaveLength(0); // synth has not built yet

    await waitFor(() => expect(contexts[0].sources.length).toBeGreaterThan(0));
  });

  it("turns itself back off when the synth chunk fails to load, instead of lying about it", async () => {
    // No try/catch at all used to mean an unhandled promise rejection AND a
    // control still reporting pressed over silence.
    vi.doMock("@/lib/audio/soundscape", () => {
      throw new Error("chunk load failed");
    });
    const user = userEvent.setup();
    const seen: (SoundscapeHandle | null)[] = [];
    render(<SoundToggle onSoundscapeChange={(soundscape) => seen.push(soundscape)} />);

    await user.click(toggleButton());

    await waitFor(() => expect(toggleButton()).toHaveAttribute("aria-pressed", "false"));
    expect(seen).not.toContain(expect.objectContaining({ start: expect.anything() }));
    // The context it opened in the gesture is closed again rather than leaked.
    await waitFor(() => expect(contexts[0].closeCount).toBeGreaterThanOrEqual(1));
    vi.doUnmock("@/lib/audio/soundscape");
  });

  it("disposes when the component unmounts while playing", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SoundToggle />);

    await user.click(toggleButton());
    await waitFor(() => expect(contexts).toHaveLength(1));

    unmount();
    await waitFor(() => expect(contexts[0].closeCount).toBe(1));
  });
});

describe("SoundToggle persistence", () => {
  it("writes the preference to localStorage on both transitions", async () => {
    const user = userEvent.setup();
    render(<SoundToggle />);

    await user.click(toggleButton());
    expect(window.localStorage.getItem(SOUNDSCAPE_STORAGE_KEY)).toBe("on");

    await user.click(toggleButton());
    expect(window.localStorage.getItem(SOUNDSCAPE_STORAGE_KEY)).toBe("off");
  });

  it("honours a stored 'on' on mount without autoplaying", async () => {
    window.localStorage.setItem(SOUNDSCAPE_STORAGE_KEY, "on");
    render(<SoundToggle />);

    await waitFor(() => expect(toggleButton()).toHaveAttribute("aria-pressed", "true"));
    // Restored state is UI state only — no AudioContext until a real gesture.
    expect(contexts).toHaveLength(0);
  });

  it("resumes a stored 'on' at the visitor's first gesture", async () => {
    window.localStorage.setItem(SOUNDSCAPE_STORAGE_KEY, "on");
    render(<SoundToggle />);
    await waitFor(() => expect(toggleButton()).toHaveAttribute("aria-pressed", "true"));

    window.dispatchEvent(new Event("pointerdown"));

    await waitFor(() => expect(contexts).toHaveLength(1));
    expect(contexts[0].resumeCount).toBeGreaterThanOrEqual(1);
  });

  it("ignores any other stored value", async () => {
    window.localStorage.setItem(SOUNDSCAPE_STORAGE_KEY, "off");
    render(<SoundToggle />);

    window.dispatchEvent(new Event("pointerdown"));

    expect(toggleButton()).toHaveAttribute("aria-pressed", "false");
    expect(contexts).toHaveLength(0);
  });

  it("still works when storage access throws", async () => {
    // Private-mode Safari and storage-blocked embeds throw on every access.
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    const user = userEvent.setup();
    render(<SoundToggle />);

    expect(toggleButton()).toHaveAttribute("aria-pressed", "false");

    await user.click(toggleButton());

    expect(toggleButton()).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(contexts).toHaveLength(1));
  });

  it("renders pressed=false on the server even when storage says on", () => {
    window.localStorage.setItem(SOUNDSCAPE_STORAGE_KEY, "on");

    // The server has no localStorage, so the first client render must match
    // this markup exactly or React logs a hydration mismatch.
    const markup = renderToStaticMarkup(<SoundToggle />);
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain('aria-pressed="true"');
  });
});

describe("SoundToggle bundle boundary", () => {
  const source = readFileSync(
    join(process.cwd(), "components", "SoundToggle.tsx"),
    "utf8",
  );

  it("never statically imports the synth module", () => {
    const staticImports = [...source.matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map(
      (match) => match[1],
    );

    expect(staticImports).not.toContain("@/lib/audio/soundscape");
    expect(staticImports.some((specifier) => specifier.includes("audio/soundscape"))).toBe(false);
    // Route "/" has a hard gzip budget; three.js and the engine must not be
    // dragged in through this button either.
    expect(staticImports.some((specifier) => specifier.includes("three"))).toBe(false);
    expect(staticImports.some((specifier) => specifier.includes("engine"))).toBe(false);
  });

  it("reaches the synth only through an awaited dynamic import", () => {
    expect(source).toMatch(/await import\(\s*["']@\/lib\/audio\/soundscape["']\s*\)/);
  });

  it("declares the soundscape's shape locally instead of importing its types", () => {
    expect(source).toMatch(/interface SoundscapeHandle/);
  });
});
