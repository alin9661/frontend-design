/** The shared narrative clock for the origin film's copy and visual layers. */
export interface ChapterBand {
  in: number;
  peak: number;
  hold: number;
  out: number;
}

export interface OriginTrack<T> {
  input: number[];
  output: T[];
}

export interface GeneratedOriginTimeline {
  bands: ChapterBand[];
  background: OriginTrack<string>;
  ink: OriginTrack<string>;
  introOpacity: OriginTrack<number>;
  introY: OriginTrack<number>;
  lineLength: OriginTrack<number>;
  lineOpacity: OriginTrack<number>;
  foliageY: OriginTrack<number>;
  copyY: OriginTrack<number>;
}

export interface OriginChapter {
  number: string;
  word: string;
  title: string;
  body: string;
  band: ChapterBand;
}

export interface Origin3DPose {
  progress: number;
  plantGrowth: number;
  collection: number;
  manufacturing: number;
  fill: number;
  pack: number;
  ship: number;
  shelf: number;
  grip: number;
  finalHold: number;
  canOpacity: number;
  canScale: number;
  canY: number;
  brewOpacity: number;
  leafTravel: number;
  worldRotation: number;
  cameraY: number;
  cameraZ: number;
}

const chapterCopy = [
  {
    number: "01",
    word: "GROW",
    title: "ROOT TO LEAF",
    body: "Yerba mate begins as a living plant, growing toward the canopy in Misiones.",
  },
  {
    number: "02",
    word: "COLLECT",
    title: "THE COLLECTION",
    body: "Mature leaves gather into one moving harvest, ready for the next part of the journey.",
  },
  {
    number: "03",
    word: "MAKE",
    title: "MADE INTO MATE",
    body: "Leaves travel through a bold, carefully paced process that becomes our crisp mate infusion.",
  },
  {
    number: "04",
    word: "CAN",
    title: "FILLED & SEALED",
    body: "Bright amber mate fills the can, then a clean seal locks in its fresh, smooth lift.",
  },
  {
    number: "05",
    word: "SHIP",
    title: "PACKED & SHIPPED",
    body: "Cans snap into cartons and head out along a lively route to wherever your day is going.",
  },
  {
    number: "06",
    word: "STOCK",
    title: "ON THE SHELF",
    body: "Five bright flavors arrive together, ready to meet you in the cold case.",
  },
  {
    number: "07",
    word: "GRAB",
    title: "SMOOTH LIFT. ZERO CRASH.",
    body: "Mint Limeade, steady energy, and a better way to pick up your day.",
  },
] as const;

/** Chapters 04 and 07 get a longer beat without dominating their neighbours. */
export const originChapterWeights = [1, 1, 1, 1.2, 1, 1, 1.2] as const;

/** Progress on either side of a chapter boundary used by the shared crossfade. */
export const ORIGIN_FADE_OVERLAP = 0.025;

/** The film's own endpoints, for tracks that drift across all of it. */
const FILM_START = 0;
const FILM_END = 1;

/**
 * Generates every origin-film clock from chapter weights. Visual tracks name
 * chapter landmarks rather than copying their numeric progress values.
 */
export function generateOriginTimeline(weights: readonly number[]): GeneratedOriginTimeline {
  if (
    weights.length !== chapterCopy.length ||
    weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
  ) {
    throw new RangeError(`Origin timeline needs ${chapterCopy.length} positive chapter weights`);
  }

  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const boundaries = [0];
  let elapsedWeight = 0;

  for (const weight of weights) {
    elapsedWeight += weight;
    boundaries.push(elapsedWeight / totalWeight);
  }

  const bands = weights.map((_, index) => {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const terminal = index === weights.length - 1;

    return {
      in: Math.max(0, start - ORIGIN_FADE_OVERLAP),
      peak: start + ORIGIN_FADE_OVERLAP,
      hold: terminal ? 1 : end - ORIGIN_FADE_OVERLAP,
      out: terminal ? 1 : Math.min(1, end + ORIGIN_FADE_OVERLAP),
    };
  });

  const first = bands[0];
  const make = bands[2];
  const can = bands[3];
  const stock = bands[5];
  const grab = bands[6];

  return {
    bands,
    background: {
      input: [first.in, make.peak, can.peak, stock.peak, grab.peak],
      output: ["#142E29", "#1D423C", "#9A5A2D", "#24765F", "#F9F9EE"],
    },
    ink: {
      input: [first.in, grab.in],
      output: ["#F9F9EE", "#1D423C"],
    },
    introOpacity: {
      input: [first.in, first.peak, first.hold],
      output: [1, 1, 0],
    },
    introY: { input: [first.in, first.hold], output: [0, -80] },
    lineLength: { input: [first.in, grab.peak], output: [0.08, 1] },
    lineOpacity: {
      input: [first.in, first.peak, grab.peak, grab.hold],
      output: [0, 1, 1, 0.32],
    },
    // The two continuous parallax tracks. They deliberately span the WHOLE
    // film rather than naming a landmark: they are ambient drift, not a beat,
    // so they are already retune-proof and pinning them to chapter 01's hold
    // and chapter 07's peak would freeze the foliage for the first ~11% and
    // last ~14% of the scroll — on an 800svh film, a deliberate final hold.
    // Their weight-invariance is asserted, not assumed, in the track tests.
    foliageY: { input: [FILM_START, FILM_END], output: [120, -360] },
    copyY: { input: [FILM_START, FILM_END], output: [24, -8] },
  };
}

const originTimeline = generateOriginTimeline(originChapterWeights);

export const originBackgroundTrack = originTimeline.background;
export const originInkTrack = originTimeline.ink;
export const originIntroOpacityTrack = originTimeline.introOpacity;
export const originIntroYTrack = originTimeline.introY;
export const originLineLengthTrack = originTimeline.lineLength;
export const originLineOpacityTrack = originTimeline.lineOpacity;
export const originFoliageYTrack = originTimeline.foliageY;
export const originCopyYTrack = originTimeline.copyY;

export const originChapters: readonly OriginChapter[] = chapterCopy.map((chapter, index) => ({
  ...chapter,
  band: originTimeline.bands[index],
}));

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (start: number, end: number, value: number) => {
  const progress = clamp01((value - start) / Math.max(end - start, Number.EPSILON));
  return progress * progress * (3 - 2 * progress);
};

/** Returns literal transform stops so motion and pure timeline calculations agree. */
export function bandStops(index: number): number[] {
  const band = originChapters[index]?.band;

  if (!band) throw new RangeError(`Unknown origin chapter index: ${index}`);

  return [band.in, band.peak, band.hold, band.out];
}

/**
 * The output stops that pair with `bandStops`.
 *
 * A terminal chapter (hold === out) must NOT end on 0. framer's interpolator
 * picks the final segment for p === 1, and a zero-width segment makes its
 * progress() helper return 1, so mix(1, 0) collapses the chapter to opacity 0
 * at the exact bottom of the film. Ending the ramp on 1 makes that final
 * segment a hold in both directions, whatever the interpolator picks.
 */
export function bandOutputs(index: number): number[] {
  const [, , hold, exit] = bandStops(index);
  return exit <= hold ? [0, 1, 1, 1] : [0, 1, 1, 0];
}

/** Mirrors the bandStops/bandOutputs useTransform, with a terminal hold at duplicate stops. */
export function bandOpacity(index: number, progress: number): number {
  const [enter, peak, hold, exit] = bandStops(index);
  const p = clamp01(progress);

  if (p <= enter) return 0;
  if (p < peak) return (p - enter) / (peak - enter);
  if (p <= hold) return 1;
  if (exit <= hold) return 1;
  if (p < exit) return 1 - (p - hold) / (exit - hold);

  return 0;
}

/** A visible chapter is the only chapter allowed to expose interactive content. */
export function isActive(index: number, progress: number): boolean {
  const chapter = originChapters[index];
  if (!chapter) throw new RangeError(`Unknown origin chapter index: ${index}`);

  const nextChapter = originChapters[index + 1];
  const enter = index === 0 ? chapter.band.in : chapter.band.peak;
  const exit = nextChapter?.band.peak ?? 1;
  const p = clamp01(progress);

  return p >= enter && (index === originChapters.length - 1 ? p <= exit : p < exit);
}

function chapterRamp(index: number, progress: number): number {
  const [enter, peak] = bandStops(index);
  return smoothstep(enter, peak, progress);
}

/** One deterministic choreography sample, shared by every visual layer and tests. */
export function originPoseForProgress(progress: number): Origin3DPose {
  const p = clamp01(progress);
  const plantGrowth = chapterRamp(0, p);
  const collection = bandOpacity(1, p);
  const manufacturing = bandOpacity(2, p);
  const fill = bandOpacity(3, p);
  // Chapter 05 carries two distinct beats: cans snap into the carton (pack),
  // then the carton departs (ship). Ship rides the back half of the same band
  // so the carton still leaves the stage when the chapter ends.
  const shipBand = originChapters[4].band;
  const pack = bandOpacity(4, p);
  const ship = pack * smoothstep(shipBand.peak, shipBand.hold, p);
  const shelf = chapterRamp(5, p);
  const grip = chapterRamp(6, p);
  const finalHold = smoothstep(originChapters[6].band.peak, 1, p);
  const canOpacity = chapterRamp(3, p);

  return {
    progress: p,
    plantGrowth,
    collection,
    manufacturing,
    fill,
    pack,
    ship,
    shelf,
    grip,
    finalHold,
    canOpacity,
    canScale: 0.74 + canOpacity * 0.28 + finalHold * 0.32,
    canY: 120 * (1 - canOpacity),
    brewOpacity: fill,
    leafTravel: p * 520,
    worldRotation: p * Math.PI * 0.42,
    cameraY: 90 - plantGrowth * 160 + shelf * 75,
    cameraZ: 900 - p * 270 - finalHold * 210,
  };
}
