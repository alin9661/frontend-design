import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bedMixForProgress,
  createSoundscape,
  Soundscape,
  soundscapeBeds,
  type SoundscapeBedId,
} from "@/lib/audio/soundscape";
import { originChapters } from "@/lib/visuals/origin-timeline";

/* ------------------------------------------------------------------ */
/* A fake Web Audio graph.                                             */
/*                                                                     */
/* jsdom has no Web Audio at all, so the module is driven against this */
/* recording fake. `linearRampToValueAtTime` both records the ramp AND */
/* settles `value` to the target, because these tests never advance    */
/* the context clock — the recorded ramp is the assertion of record,   */
/* `value` is the convenience read.                                    */
/* ------------------------------------------------------------------ */

class FakeParam {
  value: number;
  readonly ramps: { value: number; time: number }[] = [];
  readonly cancels: number[] = [];

  constructor(value = 0) {
    this.value = value;
  }

  setValueAtTime(value: number, _time: number) {
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number) {
    this.ramps.push({ value, time });
    this.value = value;
    return this;
  }

  cancelScheduledValues(time: number) {
    this.cancels.push(time);
    return this;
  }
}

class FakeNode {
  readonly connections: unknown[] = [];
  disconnectCount = 0;

  constructor(
    readonly kind: string,
    context: FakeAudioContext,
  ) {
    context.nodes.push(this);
  }

  connect(target: unknown) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.disconnectCount += 1;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeBiquad extends FakeNode {
  type = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
}

class FakeSource extends FakeNode {
  readonly startTimes: number[] = [];
  readonly stopTimes: (number | undefined)[] = [];

  start(time?: number) {
    this.startTimes.push(time ?? 0);
  }

  stop(time?: number) {
    this.stopTimes.push(time);
  }
}

class FakeOscillator extends FakeSource {
  type = "sine";
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
}

class FakeBufferSource extends FakeSource {
  buffer: unknown = null;
  loop = false;
}

class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 44100;
  state: "suspended" | "running" | "closed" = "suspended";
  readonly nodes: FakeNode[] = [];
  readonly destination = new FakeNode("destination", this);
  resumeCount = 0;
  closeCount = 0;

  createGain() {
    return new FakeGain("gain", this);
  }

  createBiquadFilter() {
    return new FakeBiquad("biquad", this);
  }

  createOscillator() {
    return new FakeOscillator("oscillator", this);
  }

  createBufferSource() {
    return new FakeBufferSource("bufferSource", this);
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => data,
    };
  }

  // The plan forbids audio-driven visuals. If the module ever reaches for an
  // analyser, these tests fail loudly rather than silently allowing it.
  createAnalyser() {
    throw new Error("Soundscape must not create an AnalyserNode");
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

interface Harness {
  context: FakeAudioContext;
  soundscape: Soundscape;
  master: FakeGain;
  /** Bed gains in `soundscapeBeds` order — the order `buildBed` creates them. */
  bedGains: FakeGain[];
  sources: FakeSource[];
}

function harness(options: { masterVolume?: number; fadeSeconds?: number } = {}): Harness {
  const context = new FakeAudioContext();
  const soundscape = createSoundscape({
    createContext: () => context as unknown as AudioContext,
    noiseSeconds: 0.02,
    ...options,
  });

  // Identified by wiring, not by creation index: the master is the gain wired
  // to the destination, and a bed gain is any gain wired to the master.
  const gains = context.nodes.filter((node): node is FakeGain => node instanceof FakeGain);
  const master = gains.find((gain) => gain.connections.includes(context.destination));
  if (!master) throw new Error("no gain connected to the destination");

  return {
    context,
    soundscape,
    master,
    bedGains: gains.filter((gain) => gain.connections.includes(master)),
    sources: context.nodes.filter((node): node is FakeSource => node instanceof FakeSource),
  };
}

const SOUNDSCAPE_SOURCE = join(process.cwd(), "lib", "audio", "soundscape.ts");

/**
 * Source with comments removed. The constraints below are about what the code
 * DOES, so the module's own prose ("deliberately not an AnalyserNode") must not
 * count as a violation of itself.
 */
function executableSource(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const bedIds = soundscapeBeds.map((bed) => bed.id);

describe("soundscape beds", () => {
  it("declares five beds, each keyed to a distinct origin chapter", () => {
    expect(soundscapeBeds).toHaveLength(5);
    expect(new Set(bedIds).size).toBe(5);

    const chapters = soundscapeBeds.map((bed) => bed.chapterIndex);
    expect(new Set(chapters).size).toBe(5);
    for (const index of chapters) {
      expect(originChapters[index]).toBeTruthy();
    }
  });

  it("anchors each bed to its chapter's peak, in ascending film order", () => {
    for (const bed of soundscapeBeds) {
      expect(bed.anchor).toBe(originChapters[bed.chapterIndex].band.peak);
    }

    const anchors = soundscapeBeds.map((bed) => bed.anchor);
    for (let i = 1; i < anchors.length; i += 1) {
      expect(anchors[i]).toBeGreaterThan(anchors[i - 1]);
    }
  });
});

describe("bedMixForProgress", () => {
  it("plays exactly one bed at full level on each anchor", () => {
    for (const bed of soundscapeBeds) {
      const mix = bedMixForProgress(bed.anchor);
      expect(mix[bed.id]).toBeCloseTo(1, 6);

      for (const other of bedIds.filter((id) => id !== bed.id)) {
        expect(mix[other]).toBeCloseTo(0, 6);
      }
    }
  });

  it("crossfades only the two beds bracketing the playhead", () => {
    const [from, to] = [soundscapeBeds[1], soundscapeBeds[2]];
    const mix = bedMixForProgress((from.anchor + to.anchor) / 2);

    expect(mix[from.id]).toBeGreaterThan(0);
    expect(mix[to.id]).toBeGreaterThan(0);
    for (const other of bedIds.filter((id) => id !== from.id && id !== to.id)) {
      expect(mix[other]).toBe(0);
    }
  });

  it("holds constant power across a crossfade rather than dipping at the midpoint", () => {
    const [from, to] = [soundscapeBeds[0], soundscapeBeds[1]];
    const span = to.anchor - from.anchor;

    for (let step = 0; step <= 10; step += 1) {
      const mix = bedMixForProgress(from.anchor + (span * step) / 10);
      const power = mix[from.id] ** 2 + mix[to.id] ** 2;
      expect(power).toBeCloseTo(1, 6);
    }

    // Equal-power, not linear: the midpoint sits at ~0.707, not 0.5.
    const midpoint = bedMixForProgress(from.anchor + span / 2);
    expect(midpoint[from.id]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(midpoint[to.id]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("moves the outgoing bed down and the incoming bed up monotonically", () => {
    const [from, to] = [soundscapeBeds[2], soundscapeBeds[3]];
    const span = to.anchor - from.anchor;
    const samples = [0, 0.25, 0.5, 0.75, 1].map((t) =>
      bedMixForProgress(from.anchor + span * t),
    );

    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i][from.id]).toBeLessThan(samples[i - 1][from.id]);
      expect(samples[i][to.id]).toBeGreaterThan(samples[i - 1][to.id]);
    }
  });

  it("holds the terminal beds outside the film and for non-finite input", () => {
    const first = soundscapeBeds[0].id;
    const last = soundscapeBeds[soundscapeBeds.length - 1].id;

    expect(bedMixForProgress(-3)[first]).toBe(1);
    expect(bedMixForProgress(0)[first]).toBe(1);
    expect(bedMixForProgress(1)[last]).toBe(1);
    expect(bedMixForProgress(9)[last]).toBe(1);
    expect(bedMixForProgress(Number.NaN)[first]).toBe(1);
  });
});

describe("Soundscape graph", () => {
  it("wires one gain per bed into a master gain on the destination", () => {
    const { bedGains, master, context } = harness();

    expect(bedGains).toHaveLength(5);
    expect(master.connections).toEqual([context.destination]);
    // Silent until start(): the master opens only on an explicit user gesture.
    expect(master.gain.value).toBe(0);
  });

  it("gives every bed a looping noise source through its own filter", () => {
    const { context } = harness();

    const noiseSources = context.nodes.filter(
      (node): node is FakeBufferSource => node instanceof FakeBufferSource,
    );
    expect(noiseSources).toHaveLength(5);
    for (const source of noiseSources) {
      expect(source.loop).toBe(true);
      expect(source.buffer).not.toBeNull();
      expect(source.connections.some((target) => target instanceof FakeBiquad)).toBe(true);
    }

    const filters = context.nodes.filter((node): node is FakeBiquad => node instanceof FakeBiquad);
    expect(filters.map((filter) => filter.type).sort()).toEqual([
      "bandpass",
      "highpass",
      "lowpass",
      "lowpass",
      "lowpass",
    ]);
  });

  it("modulates a filter cutoff with an LFO instead of leaving the beds static", () => {
    const { context } = harness();

    const filterFrequencies = context.nodes
      .filter((node): node is FakeBiquad => node instanceof FakeBiquad)
      .map((filter) => filter.frequency);

    const modulated = context.nodes
      .filter((node): node is FakeGain => node instanceof FakeGain)
      .flatMap((gain) => gain.connections)
      .filter((target) => filterFrequencies.includes(target as FakeParam));

    expect(modulated).toHaveLength(5);
  });

  it("never creates an analyser, so audio cannot reach the visuals", () => {
    // The fake's createAnalyser throws, so construction alone proves the
    // runtime path. The source scan pins the constraint against a later edit.
    expect(() => harness()).not.toThrow();

    const source = executableSource(SOUNDSCAPE_SOURCE);
    expect(source).toContain("createBiquadFilter");
    expect(source).not.toMatch(/createAnalyser|AnalyserNode|getByteFrequencyData/);
  });
});

describe("Soundscape playback", () => {
  it("sets bed gains directly before start and ramps them after", async () => {
    const { soundscape, bedGains, context } = harness();

    // Before start(): the constructor's setProgress(0) put bed 0 at 1 by
    // assignment, with nothing scheduled against a clock that isn't running.
    expect(bedGains[0].gain.value).toBe(1);
    expect(bedGains.every((gain) => gain.gain.ramps.length === 0)).toBe(true);

    await soundscape.start();
    expect(context.resumeCount).toBe(1);

    soundscape.setProgress(soundscapeBeds[1].anchor);
    expect(bedGains[1].gain.ramps.at(-1)?.value).toBeCloseTo(1, 6);
    expect(bedGains[0].gain.ramps.at(-1)?.value).toBeCloseTo(0, 6);
  });

  it("moves real gain values as film progress crosses a chapter", async () => {
    const { soundscape, bedGains } = harness();
    await soundscape.start();

    const from = soundscapeBeds[3];
    const to = soundscapeBeds[4];

    soundscape.setProgress(from.anchor);
    const startLevels = bedGains.map((gain) => gain.gain.value);

    soundscape.setProgress((from.anchor + to.anchor) / 2);
    const midLevels = bedGains.map((gain) => gain.gain.value);

    soundscape.setProgress(to.anchor);
    const endLevels = bedGains.map((gain) => gain.gain.value);

    expect(startLevels[3]).toBeCloseTo(1, 6);
    expect(startLevels[4]).toBeCloseTo(0, 6);
    expect(midLevels[3]).toBeLessThan(startLevels[3]);
    expect(midLevels[4]).toBeGreaterThan(startLevels[4]);
    expect(endLevels[3]).toBeCloseTo(0, 6);
    expect(endLevels[4]).toBeCloseTo(1, 6);

    expect(soundscape.levels()[to.id]).toBeCloseTo(1, 6);
    expect(soundscape.levels()[from.id]).toBeCloseTo(0, 6);
  });

  it("starts every source exactly once, however often start() is called", async () => {
    const { soundscape, sources, context } = harness();

    await soundscape.start();
    await soundscape.start();

    expect(sources.length).toBeGreaterThan(5);
    expect(sources.every((source) => source.startTimes.length === 1)).toBe(true);
    expect(context.resumeCount).toBe(1);
    expect(soundscape.started).toBe(true);
  });

  it("opens the master to the configured volume on start and retunes it live", async () => {
    const { soundscape, master } = harness({ masterVolume: 0.4 });

    await soundscape.start();
    expect(master.gain.ramps.at(-1)?.value).toBeCloseTo(0.4, 6);

    soundscape.setMasterVolume(0.05);
    expect(master.gain.ramps.at(-1)?.value).toBeCloseTo(0.05, 6);

    // Out-of-range requests clamp rather than blasting the listener.
    soundscape.setMasterVolume(9);
    expect(master.gain.ramps.at(-1)?.value).toBe(1);
  });

  it("keeps the master closed when the volume changes before start", () => {
    const { soundscape, master } = harness();

    soundscape.setMasterVolume(0.9);

    expect(master.gain.value).toBe(0);
    expect(master.gain.ramps).toHaveLength(0);
  });
});

describe("Soundscape disposal", () => {
  it("stops every source, disconnects every node and closes the context", async () => {
    const { soundscape, sources, context, master, bedGains } = harness();
    await soundscape.start();

    await soundscape.dispose();

    expect(sources.every((source) => source.stopTimes.length === 1)).toBe(true);
    expect(sources.every((source) => source.disconnectCount >= 1)).toBe(true);
    expect(bedGains.every((gain) => gain.disconnectCount >= 1)).toBe(true);
    expect(master.disconnectCount).toBe(1);
    expect(context.closeCount).toBe(1);
    expect(context.state).toBe("closed");
    expect(soundscape.disposed).toBe(true);
    expect(soundscape.started).toBe(false);
  });

  it("closes without stopping sources when it was never started", async () => {
    const { soundscape, sources, context } = harness();

    await soundscape.dispose();

    // stop() before start() throws InvalidStateError in real Web Audio, so the
    // unstarted branch must not call it — it is already silent.
    expect(sources.every((source) => source.stopTimes.length === 0)).toBe(true);
    expect(sources.every((source) => source.disconnectCount >= 1)).toBe(true);
    expect(context.closeCount).toBe(1);
  });

  it("is idempotent and refuses to restart", async () => {
    const { soundscape, context, sources } = harness();
    await soundscape.start();
    await soundscape.dispose();
    await soundscape.dispose();

    expect(context.closeCount).toBe(1);
    expect(sources.every((source) => source.stopTimes.length === 1)).toBe(true);
    await expect(soundscape.start()).rejects.toThrow(/dispose/i);
  });

  it("ignores progress and volume changes after disposal", async () => {
    const { soundscape, bedGains, master } = harness();
    await soundscape.start();
    const levelsBefore = soundscape.levels();
    await soundscape.dispose();

    const rampsBefore = bedGains.map((gain) => gain.gain.ramps.length);
    soundscape.setProgress(1);
    soundscape.setMasterVolume(1);

    expect(bedGains.map((gain) => gain.gain.ramps.length)).toEqual(rampsBefore);
    expect(soundscape.levels()).toEqual(levelsBefore);
    expect(master.gain.ramps.at(-1)?.value).not.toBe(1);
  });
});

describe("dependency injection", () => {
  it("creates its context exactly once, through the injected factory only", () => {
    let calls = 0;
    const soundscape = createSoundscape({
      noiseSeconds: 0.02,
      createContext: () => {
        calls += 1;
        return new FakeAudioContext() as unknown as AudioContext;
      },
    });

    soundscape.setProgress(0.5);
    expect(calls).toBe(1);
    expect(soundscape).toBeInstanceOf(Soundscape);
  });

  it("touches no global audio constructor", () => {
    const source = executableSource(SOUNDSCAPE_SOURCE);
    expect(source).toContain("options.createContext()");
    expect(source).not.toMatch(/new\s+(?:window\.)?(?:webkit)?AudioContext/);
  });
});

describe("mix typing", () => {
  it("always returns a level for every bed id", () => {
    const mix = bedMixForProgress(0.5);
    const keys = Object.keys(mix) as SoundscapeBedId[];
    expect(keys.sort()).toEqual([...bedIds].sort());
  });
});
