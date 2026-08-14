/**
 * lib/audio/soundscape.ts — the origin film's opt-in ambient soundscape.
 *
 * Five procedural "beds" (forest air, leaf rustle, machine hum, brew bubble,
 * room tone), each a tiny Web Audio graph of an oscillator and/or looping
 * noise buffer -> biquad filter -> gain. There are no audio files: every sample
 * is synthesized at runtime, so the whole soundtrack costs zero network bytes.
 * Each bed is anchored to the progress value of one of the film's chapters
 * (`lib/visuals/origin-timeline.ts`), and `setProgress(0..1)` crossfades
 * between the two beds that bracket the playhead.
 *
 * Deliberately NOT here: an AnalyserNode. Audio never drives the visuals — the
 * film's choreography is a pure function of scroll progress, and letting a
 * shader uniform depend on the audio graph would make the visuals differ
 * between a muted and an unmuted visitor. Progress flows audio-ward only.
 *
 * The one non-obvious decision: the crossfade is EQUAL-POWER (cosine/sine),
 * not linear. Two beds faded linearly are uncorrelated noise sources, so their
 * powers add rather than their amplitudes; at the midpoint of a linear fade
 * the pair measures ~3 dB quieter than either bed alone and the mix audibly
 * dips at every chapter boundary. Cosine/sine keeps `a^2 + b^2 === 1` across
 * the whole transition, so loudness stays flat. The visible consequence is
 * that a bed sits at ~0.707, not 0.5, halfway between two anchors.
 *
 * The AudioContext arrives through an injected factory rather than being
 * constructed here, so this module owns no globals or singletons: the caller
 * decides when a context exists (browsers require a user gesture) and tests
 * can drive the whole graph with a fake.
 */

import { originChapters } from "@/lib/visuals/origin-timeline";

export type SoundscapeBedId =
  | "forest-air"
  | "leaf-rustle"
  | "machine-hum"
  | "brew-bubble"
  | "room-tone";

/** A level per bed, 0..1. Always contains all five keys. */
export type SoundscapeMix = Record<SoundscapeBedId, number>;

export interface SoundscapeBedSpec {
  readonly id: SoundscapeBedId;
  /** Human-readable, for UI or debugging. */
  readonly label: string;
  /** Index into `originChapters` this bed leads. */
  readonly chapterIndex: number;
  /** Film progress (0..1) at which this bed plays alone. */
  readonly anchor: number;
}

interface NoiseLayer {
  readonly filter: BiquadFilterType;
  readonly frequency: number;
  readonly Q: number;
  readonly level: number;
}

interface ToneLayer {
  readonly type: OscillatorType;
  readonly frequency: number;
  readonly level: number;
}

interface WobbleLayer {
  /** LFO rate in Hz. Sub-1 Hz reads as drift; above ~1 Hz reads as texture. */
  readonly frequency: number;
  /** Peak filter-cutoff deviation in Hz. */
  readonly depth: number;
}

interface BedRecipe {
  readonly noise: NoiseLayer;
  readonly tones?: readonly ToneLayer[];
  readonly wobble?: WobbleLayer;
}

/**
 * Bed -> chapter assignment. Seven chapters, five beds: the last bed leads the
 * three shipping/shelf/grab chapters, which share one acoustic space.
 */
const bedChapters: ReadonlyArray<{
  id: SoundscapeBedId;
  label: string;
  chapterIndex: number;
}> = [
  { id: "forest-air", label: "Forest air", chapterIndex: 0 },
  { id: "leaf-rustle", label: "Leaf rustle", chapterIndex: 1 },
  { id: "machine-hum", label: "Machine hum", chapterIndex: 2 },
  { id: "brew-bubble", label: "Brew bubble", chapterIndex: 3 },
  { id: "room-tone", label: "Room tone", chapterIndex: 4 },
];

/** The five beds, in film order, each anchored to its chapter's peak. */
export const soundscapeBeds: readonly SoundscapeBedSpec[] = bedChapters.map((bed) => {
  const chapter = originChapters[bed.chapterIndex];

  if (!chapter) {
    throw new RangeError(`Soundscape bed "${bed.id}" names a missing origin chapter`);
  }

  return { ...bed, anchor: chapter.band.peak };
});

const bedRecipes: Record<SoundscapeBedId, BedRecipe> = {
  // Wide, soft, almost sub-audible: the canopy before anything happens.
  "forest-air": {
    noise: { filter: "lowpass", frequency: 780, Q: 0.6, level: 0.9 },
    wobble: { frequency: 0.07, depth: 240 },
  },
  // A fast bandpass sweep over noise is the cheapest convincing dry-leaf sound.
  "leaf-rustle": {
    noise: { filter: "bandpass", frequency: 3100, Q: 1.4, level: 0.55 },
    wobble: { frequency: 0.33, depth: 900 },
  },
  // A detuned saw pair under a low cutoff: a room-sized machine, not a buzzer.
  "machine-hum": {
    noise: { filter: "lowpass", frequency: 240, Q: 0.9, level: 0.35 },
    tones: [
      { type: "sawtooth", frequency: 57, level: 0.22 },
      { type: "square", frequency: 114, level: 0.06 },
    ],
    wobble: { frequency: 0.9, depth: 40 },
  },
  // Highpassed noise pulsed by a ~1.7 Hz LFO reads as liquid, not hiss.
  "brew-bubble": {
    noise: { filter: "highpass", frequency: 640, Q: 0.7, level: 0.4 },
    tones: [{ type: "sine", frequency: 196, level: 0.1 }],
    wobble: { frequency: 1.7, depth: 520 },
  },
  // The cold case: a low hum and a nearly static air bed.
  "room-tone": {
    noise: { filter: "lowpass", frequency: 420, Q: 0.5, level: 0.5 },
    tones: [{ type: "sine", frequency: 96, level: 0.14 }],
    wobble: { frequency: 0.05, depth: 90 },
  },
};

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

function emptyMix(): SoundscapeMix {
  return {
    "forest-air": 0,
    "leaf-rustle": 0,
    "machine-hum": 0,
    "brew-bubble": 0,
    "room-tone": 0,
  };
}

/**
 * The equal-power crossfade, as a pure function of film progress.
 *
 * Below the first anchor and above the last, the terminal bed holds at 1 —
 * the film starts and ends inside a bed rather than fading up from silence.
 */
export function bedMixForProgress(progress: number): SoundscapeMix {
  const p = clamp01(progress);
  const mix = emptyMix();
  const last = soundscapeBeds.length - 1;

  if (p <= soundscapeBeds[0].anchor) {
    mix[soundscapeBeds[0].id] = 1;
    return mix;
  }

  if (p >= soundscapeBeds[last].anchor) {
    mix[soundscapeBeds[last].id] = 1;
    return mix;
  }

  let index = 0;
  while (index < last - 1 && p > soundscapeBeds[index + 1].anchor) index += 1;

  const from = soundscapeBeds[index];
  const to = soundscapeBeds[index + 1];
  const t = (p - from.anchor) / (to.anchor - from.anchor);

  mix[from.id] = Math.cos((t * Math.PI) / 2);
  mix[to.id] = Math.sin((t * Math.PI) / 2);

  return mix;
}

export interface SoundscapeOptions {
  /**
   * Builds the AudioContext. Called once, synchronously, in the constructor.
   * Injected so this module never reaches for a global and so the caller
   * controls when a context is created (browsers need a user gesture).
   */
  createContext: () => AudioContext;
  /** Peak output level, 0..1. Default 0.16 — ambient, under any narration. */
  masterVolume?: number;
  /** Crossfade/ramp time in seconds. Default 0.9. */
  fadeSeconds?: number;
  /** Length of the looping noise buffer in seconds. Default 2. */
  noiseSeconds?: number;
}

interface BuiltBed {
  readonly id: SoundscapeBedId;
  readonly gain: GainNode;
  readonly sources: readonly AudioScheduledSourceNode[];
  readonly nodes: readonly AudioNode[];
}

function rampTo(param: AudioParam, target: number, now: number, seconds: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + seconds);
}

function createNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);

  // A one-pole lowpass over white noise ("brown-ish") — far less fizzy than
  // raw white noise at the low levels these beds run at.
  let previous = 0;
  for (let i = 0; i < frames; i += 1) {
    const white = Math.random() * 2 - 1;
    previous = (previous + 0.02 * white) / 1.02;
    data[i] = Math.max(-1, Math.min(1, previous * 3.5));
  }

  return buffer;
}

function buildBed(
  context: AudioContext,
  spec: SoundscapeBedSpec,
  recipe: BedRecipe,
  noiseBuffer: AudioBuffer,
  destination: AudioNode,
): BuiltBed {
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(destination);

  const nodes: AudioNode[] = [gain];
  const sources: AudioScheduledSourceNode[] = [];

  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = recipe.noise.filter;
  filter.frequency.value = recipe.noise.frequency;
  filter.Q.value = recipe.noise.Q;

  const noiseLevel = context.createGain();
  noiseLevel.gain.value = recipe.noise.level;

  source.connect(filter);
  filter.connect(noiseLevel);
  noiseLevel.connect(gain);
  sources.push(source);
  nodes.push(filter, noiseLevel);

  if (recipe.wobble) {
    const lfo = context.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = recipe.wobble.frequency;

    const depth = context.createGain();
    depth.gain.value = recipe.wobble.depth;

    lfo.connect(depth);
    depth.connect(filter.frequency);
    sources.push(lfo);
    nodes.push(depth);
  }

  for (const tone of recipe.tones ?? []) {
    const oscillator = context.createOscillator();
    oscillator.type = tone.type;
    oscillator.frequency.value = tone.frequency;

    const level = context.createGain();
    level.gain.value = tone.level;

    oscillator.connect(level);
    level.connect(gain);
    sources.push(oscillator);
    nodes.push(level);
  }

  return { id: spec.id, gain, sources, nodes };
}

/**
 * The five-bed ambient graph. Construct via `createSoundscape`, call `start()`
 * from inside a user gesture, feed it `setProgress` as the film scrolls, and
 * `dispose()` when the listener turns it off.
 */
export class Soundscape {
  private readonly context: AudioContext;
  private readonly master: GainNode;
  private readonly beds: readonly BuiltBed[];
  private readonly fadeSeconds: number;
  private masterVolume: number;
  private mix: SoundscapeMix = emptyMix();
  private running = false;
  private closed = false;

  constructor(options: SoundscapeOptions) {
    this.context = options.createContext();
    this.fadeSeconds = Math.max(0.01, options.fadeSeconds ?? 0.9);
    this.masterVolume = clamp01(options.masterVolume ?? 0.16);

    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    const noiseBuffer = createNoiseBuffer(this.context, Math.max(0.1, options.noiseSeconds ?? 2));

    this.beds = soundscapeBeds.map((spec) =>
      buildBed(this.context, spec, bedRecipes[spec.id], noiseBuffer, this.master),
    );

    this.setProgress(0);
  }

  /** True between a successful `start()` and `dispose()`. */
  get started(): boolean {
    return this.running;
  }

  /** True once `dispose()` has run. A disposed soundscape cannot restart. */
  get disposed(): boolean {
    return this.closed;
  }

  /** The mix last applied by `setProgress`, per bed. */
  levels(): SoundscapeMix {
    return { ...this.mix };
  }

  /**
   * Resumes the context and starts every source. Must be called from a user
   * gesture — nothing in this module starts audio on its own. Idempotent.
   */
  async start(): Promise<void> {
    if (this.closed) throw new Error("Soundscape: start() after dispose()");
    if (this.running) return;

    await this.context.resume();
    this.running = true;

    const now = this.context.currentTime;
    for (const bed of this.beds) {
      for (const source of bed.sources) source.start(now);
    }

    rampTo(this.master.gain, this.masterVolume, now, this.fadeSeconds);
    this.applyMix();
  }

  /** Crossfades the beds to the mix for `progress` (0..1). Safe before start. */
  setProgress(progress: number): void {
    if (this.closed) return;
    this.mix = bedMixForProgress(progress);
    this.applyMix();
  }

  /** Sets peak output, 0..1. Takes effect immediately while running. */
  setMasterVolume(volume: number): void {
    if (this.closed) return;
    this.masterVolume = clamp01(volume);

    if (this.running) {
      rampTo(this.master.gain, this.masterVolume, this.context.currentTime, this.fadeSeconds);
    } else {
      this.master.gain.value = 0;
    }
  }

  /**
   * Stops every source, disconnects every node and closes the context. Leaves
   * nothing scheduled and nothing running. Idempotent.
   */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    for (const bed of this.beds) {
      for (const source of bed.sources) {
        // stop() on a source that never started throws InvalidStateError, so
        // only the started branch stops; an unstarted source is already silent.
        if (this.running) {
          try {
            source.stop();
          } catch {
            // A source the browser already ended. Nothing to stop.
          }
        }
        source.disconnect();
      }
      for (const node of bed.nodes) node.disconnect();
    }

    this.master.disconnect();
    this.running = false;

    await this.context.close();
  }

  private applyMix(): void {
    if (this.running) {
      const now = this.context.currentTime;
      for (const bed of this.beds) rampTo(bed.gain.gain, this.mix[bed.id], now, this.fadeSeconds);
      return;
    }

    // Before start() nothing is audible, so jump rather than schedule a ramp
    // against a context clock that has not begun to advance.
    for (const bed of this.beds) bed.gain.gain.value = this.mix[bed.id];
  }
}

/** Builds a `Soundscape`. The only entry point callers need. */
export function createSoundscape(options: SoundscapeOptions): Soundscape {
  return new Soundscape(options);
}
