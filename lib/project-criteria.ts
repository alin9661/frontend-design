// lib/project-criteria.ts
//
// The project's completion manifest: one row per guarantee this codebase is
// supposed to make, each with a machine-evaluable predicate. test/project-
// metrics.test.ts turns it into a number.
//
// Why data and not tests: CLAUDE.md forbids a failing test AND forbids
// .skip/.todo/xfail, so unfinished work cannot be expressed as a red or
// skipped test. It is expressed here instead — `status: "planned"` is the
// honest record of "not done yet", and its `check` is the definition of done.
// The suite then polices the manifest in BOTH directions: a "done" row whose
// check stops holding is a regression, and a "planned" row whose check starts
// holding means the manifest is under-reporting real progress.
//
// Every check must be total: a missing file, a missing build, or unparseable
// output means "not met", never a thrown error. `safeCheck` enforces that.

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { bandOpacity, isActive, originChapters } from "@/lib/visuals/origin-timeline";

export type ProjectCriterionStatus = "done" | "planned";

export interface ProjectCriterion {
  /** Stable slug; the suite asserts uniqueness. */
  id: string;
  /** Grouping key for the progress report. */
  area: string;
  description: string;
  status: ProjectCriterionStatus;
  /** Definition of done. Must never throw; use `safeCheck` to guarantee it. */
  check?: () => boolean | Promise<boolean>;
}

export interface CriterionResult {
  id: string;
  area: string;
  status: ProjectCriterionStatus;
  /** `null` when the criterion has no executable check. */
  met: boolean | null;
  /** Set when a check threw despite the total-function rule. */
  error?: string;
}

export interface AreaProgress {
  area: string;
  done: number;
  total: number;
}

export interface ProgressSummary {
  areas: AreaProgress[];
  done: number;
  total: number;
  /** Rounded percentage of criteria marked done; 0 for an empty manifest. */
  percent: number;
}

/** Matches scripts/check-bundle.ts's HOME_BUDGET — the CI gate for route "/". */
const HOME_FIRST_LOAD_BUDGET_BYTES = 165_000;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

// ---------------------------------------------------------------------------
// Evaluation + reporting (pure; exercised directly by the suite)
// ---------------------------------------------------------------------------

/** Wraps a predicate so an unevaluable criterion reads as "not met". */
export function safeCheck(predicate: () => boolean): () => boolean {
  return () => {
    try {
      return predicate();
    } catch {
      return false;
    }
  };
}

/** Runs every criterion's check. Never rejects: a throwing check is "not met". */
export async function evaluateCriteria(
  criteria: readonly ProjectCriterion[]
): Promise<CriterionResult[]> {
  const results: CriterionResult[] = [];

  for (const { id, area, status, check } of criteria) {
    if (!check) {
      results.push({ id, area, status, met: null });
      continue;
    }
    try {
      results.push({ id, area, status, met: (await check()) === true });
    } catch (error) {
      results.push({
        id,
        area,
        status,
        met: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/** Counts done/total overall and per area, preserving manifest area order. */
export function summarizeCriteria(criteria: readonly ProjectCriterion[]): ProgressSummary {
  const byArea = new Map<string, AreaProgress>();

  for (const { area, status } of criteria) {
    const progress = byArea.get(area) ?? { area, done: 0, total: 0 };
    progress.total += 1;
    if (status === "done") progress.done += 1;
    byArea.set(area, progress);
  }

  const done = criteria.filter(({ status }) => status === "done").length;
  const total = criteria.length;

  return {
    areas: [...byArea.values()],
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

const percentOf = (done: number, total: number) =>
  `${String(total === 0 ? 0 : Math.round((done / total) * 100)).padStart(3)}%`;

/** Human-readable progress report: per area, remaining work named, then overall. */
export function formatProgressReport(criteria: readonly ProjectCriterion[]): string {
  const { areas, done, total, percent } = summarizeCriteria(criteria);
  const lines = ["", "Project completion metrics", "─".repeat(64)];

  for (const area of areas) {
    lines.push(
      `  ${area.area.padEnd(32)} ${String(area.done).padStart(2)}/${String(area.total).padEnd(2)} ${percentOf(area.done, area.total)}`
    );
    for (const criterion of criteria) {
      if (criterion.area !== area.area || criterion.status !== "planned") continue;
      lines.push(`      remaining: ${criterion.id}`);
    }
  }

  lines.push("─".repeat(64));
  lines.push(`  ${"OVERALL".padEnd(32)} ${done}/${total} criteria met (${percent}%)`);
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Filesystem plumbing
// ---------------------------------------------------------------------------

function readText(...parts: string[]): string | null {
  try {
    return readFileSync(resolve(process.cwd(), ...parts), "utf8");
  } catch {
    return null;
  }
}

function sourceFilesUnder(relativeDirectory: string): string[] {
  const directory = resolve(process.cwd(), relativeDirectory);

  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) return sourceFilesUnder(relativePath);
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
        return [];
      }
      return [relativePath];
    });
  } catch {
    return [];
  }
}

export interface SourceFile {
  path: string;
  source: string;
}

/** Reads the given paths, dropping any that are missing. */
function readAll(paths: readonly string[]): SourceFile[] {
  return paths.flatMap((path) => {
    const source = readText(path);
    return source === null ? [] : [{ path, source }];
  });
}

// The concept checks each scan app/, components/ and lib/. Reading the tree
// once per test run (rather than once per criterion) keeps the whole manifest
// well under a frame's worth of work.
let projectSourcesCache: SourceFile[] | null = null;

function projectSources(): SourceFile[] {
  if (projectSourcesCache) return projectSourcesCache;

  projectSourcesCache = ["app", "components", "lib"].flatMap((directory) =>
    readAll(sourceFilesUnder(directory))
  );

  return projectSourcesCache;
}

// ---------------------------------------------------------------------------
// Pure predicates (source text in, boolean out — testable without the repo)
// ---------------------------------------------------------------------------

/**
 * The attribute text of every `<section>` / `<footer>` root in a JSX source.
 * Brace-aware, so a handler like `onPointerEnter={(e) => …}` doesn't end the
 * tag at its own arrow (FlavorShowcase's root really does open that way).
 */
export function sectionRootAttributes(source: string): string[] {
  const attributes: string[] = [];

  // `m\.` as well as `motion\.`: the LazyMotion migration rewrote every
  // rendered element to the lightweight `m.*` namespace, which silently took
  // OriginStory's sticky `<m.section>` — the one root that actually overlays
  // the shared GL canvas — out of this scan. Its StaticStory sibling still
  // matched, so the "every file contributes a root" net below did not notice.
  for (const open of source.matchAll(/<(?:motion\.|m\.)?(?:section|footer)\b/g)) {
    if (open.index === undefined) continue;
    const start = open.index + open[0].length;
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) {
        attributes.push(source.slice(start, i));
        break;
      }
    }
  }

  return attributes;
}

/**
 * A landing section root may not paint its own background: the shared GL
 * canvas is a `fixed inset-0 z-0` element behind all of them, so an opaque
 * root occludes the whole engine. Every listed file must contribute at least
 * one root — a file with none means the scan silently stopped working.
 */
export function sectionRootsAreTransparent(files: readonly SourceFile[]): boolean {
  if (files.length === 0) return false;

  return files.every(({ source }) => {
    const roots = sectionRootAttributes(source);
    if (roots.length === 0) return false;

    return roots.every((root) =>
      (root.match(/className="([^"]*)"/)?.[1] ?? "")
        .split(/\s+/)
        .every((utility) => !/^bg-/.test(utility) || utility === "bg-transparent")
    );
  });
}

/**
 * True when no `useTransform(x, [ … ])` literal stop array remains: a band
 * expressed as `useTransform(progress, bandStops(i), bandOutputs(i))` reads
 * from the timeline module, a literal `[0, 0.32, …]` forks it.
 */
export function hasNoInlineTransformStops(source: string): boolean {
  // No `s` flag: tsconfig targets ES2017, and a negated class already spans
  // newlines, so a multi-line useTransform( … ) call is still matched.
  return !/useTransform\s*\(\s*[^,]+,\s*\[/.test(source);
}

/**
 * VIEW_READY must be a real per-view signal: declared in the protocol, emitted
 * by BOTH render hosts (MainThreadHost directly, WorkerHost by forwarding the
 * worker's post), and consumed by React as a per-view predicate.
 */
export function emitsPerViewReady(sources: {
  types: string | null;
  host: string | null;
  worker: string | null;
  provider: string | null;
  context: string | null;
}): boolean {
  const { types, host, worker, provider, context } = sources;
  if (!types || !host || !worker || !provider || !context) return false;

  const declaresEvent = /type:\s*"VIEW_READY"/.test(types) && /\bviewId\b/.test(types);
  const mainThreadHostEmits =
    /class\s+MainThreadHost\b/.test(host) &&
    /onViewReady\s*:\s*\([^)]*\)\s*=>\s*this\.emit\(\s*\{\s*type:\s*"VIEW_READY"/.test(host);
  // WorkerHost never mints the event itself; it forwards whatever the worker
  // posts to its own listeners, so the pair (worker posts, host forwards) is
  // what makes the worker path emit.
  const workerPathEmits =
    /onViewReady\s*:\s*\([^)]*\)\s*=>\s*ctx\.postMessage\(\s*\{\s*type:\s*"VIEW_READY"/.test(worker) &&
    /class\s+WorkerHost\b/.test(host) &&
    /this\.listeners\b/.test(host);
  const reactConsumesPerView =
    /msg\.type === "VIEW_READY"/.test(provider) &&
    /isViewReady/.test(provider) &&
    /isViewReady\??\s*:/.test(context);

  return declaresEvent && mainThreadHostEmits && workerPathEmits && reactConsumesPerView;
}

/** Every StrictMode effect setup must mint (not reuse) a canvas. */
export function mintsFreshCanvasPerSetup(sources: {
  canvas: string | null;
  provider: string | null;
}): boolean {
  const { canvas, provider } = sources;
  if (!canvas || !provider) return false;

  return (
    /document\.createElement\(\s*["']canvas["']\s*\)/.test(canvas) &&
    /\breplaceChildren\(\s*canvas\s*\)/.test(canvas) &&
    /\bmint\(\)/.test(provider)
  );
}

/** The 2D beat art yields to GL only when this section's own view is ready. */
export function gatesBeatArtOnViewReady(source: string | null): boolean {
  if (!source) return false;

  return (
    /engine\?\.status === "ready"/.test(source) &&
    /originFilmViewId !== null/.test(source) &&
    /engine\.isViewReady\?\.\(\s*originFilmViewId\s*\) === true/.test(source) &&
    /showBeatArt=\{!originFilmReady\}/.test(source)
  );
}

const BODY_OVERFLOW_MUTATION =
  /document\.body(?:\.style\.overflow|\.classList\.(?:add|toggle)\([^)]*overflow-hidden)/;
const GLOBAL_BODY_LOCK = /body\s*\{[^}]*overflow\s*:\s*hidden/;

/** No boot overlay on "/" and nothing that pins body scroll while it boots. */
export function hasNoBootScrollLock(sources: {
  page: string | null;
  globalsCss: string | null;
  landing: ReadonlyArray<string | null>;
}): boolean {
  const { page, globalsCss, landing } = sources;
  if (!page || !globalsCss || landing.some((source) => source === null)) return false;

  return (
    !/LoadingScreen/.test(page) &&
    !GLOBAL_BODY_LOCK.test(globalsCss) &&
    [page, ...landing].every((source) => !BODY_OVERFLOW_MUTATION.test(source ?? ""))
  );
}

interface BuildManifest {
  pages?: Record<string, unknown>;
}

/**
 * Gzip-sums route "/"'s first-load JS from a Next build directory, mirroring
 * scripts/check-bundle.ts (both manifests merged, `.css` skipped). Returns
 * `null` when there is no usable build output — an unmeasurable route is not
 * a passing route, but it must not crash the suite either.
 */
export function firstLoadJsBytes(nextDir: string): number | null {
  const pages: Record<string, unknown> = {};

  for (const manifestName of ["build-manifest.json", "app-build-manifest.json"]) {
    let parsed: BuildManifest;
    try {
      parsed = JSON.parse(readFileSync(resolve(nextDir, manifestName), "utf8")) as BuildManifest;
    } catch {
      return null;
    }
    Object.assign(pages, parsed.pages ?? {});
  }

  // The route's own chunks UNIONED with the root layout's, exactly as
  // scripts/check-bundle.ts does. Taking the first matching key and stopping
  // there under-reports by however much client code lives in app/layout.tsx's
  // subtree (Next emits those chunks only under `/layout`, and the browser
  // downloads them on the same navigation) — which would have this manifest
  // grading a different, smaller number than the CI gate enforces, so the two
  // could straddle the budget in opposite directions.
  const routeKey = ["/page", "/"].find((key) => Array.isArray(pages[key]));
  if (routeKey === undefined) return null;

  const seen = new Set<string>();
  const chunks: string[] = [];
  for (const key of ["/layout", routeKey]) {
    for (const file of Array.isArray(pages[key]) ? (pages[key] as unknown[]) : []) {
      if (typeof file !== "string" || !file.endsWith(".js") || seen.has(file)) continue;
      seen.add(file);
      chunks.push(file);
    }
  }
  // A key that lists no JS would measure 0 bytes and sail under any budget —
  // report it as unmeasurable rather than as a pass.
  if (chunks.length === 0) return null;

  let bytes = 0;
  for (const chunk of chunks) {
    try {
      bytes += gzipSync(readFileSync(resolve(nextDir, chunk)), { level: 9 }).length;
    } catch {
      return null;
    }
  }

  return bytes;
}

/** False (not met) when the build output is missing, unreadable, or over budget. */
export function firstLoadJsWithinBudget(nextDir: string, budgetBytes: number): boolean {
  const bytes = firstLoadJsBytes(nextDir);
  return bytes !== null && bytes <= budgetBytes;
}

/** max/min chapter span — the evenness of the film's pacing. */
export function chapterSpanRatio(): number {
  const spans = originChapters.map(({ band }) => band.out - band.in);
  return Math.max(...spans) / Math.min(...spans);
}

/** Shortest full-opacity plateau (hold − peak) across all chapters. */
export function minimumOpacityPlateau(): number {
  return Math.min(...originChapters.map(({ band }) => band.hold - band.peak));
}

/** Samples 0..1: a11y focus must belong to exactly one chapter at all times. */
export function exactlyOneActiveChapterThroughout(samples = 1_000): boolean {
  for (let sample = 0; sample <= samples; sample += 1) {
    const progress = sample / samples;
    const active = originChapters.filter((_, index) => isActive(index, progress)).length;
    if (active !== 1) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Repo-bound checks
// ---------------------------------------------------------------------------

const LANDING_COMPONENTS = [
  "components/OriginStory.tsx",
  "components/FlavorShowcase.tsx",
  "components/Benefits.tsx",
  "components/SocialProof.tsx",
  "components/Footer.tsx",
];

function qualityDetectionIsThreeFree(): boolean {
  const provider = readText("lib", "engine", "react", "EngineProvider.tsx");
  if (!provider) return false;

  const importMatch = provider.match(
    /import\s*\{[^}]*\bdetectQualityTier\b[^}]*\}\s*from\s*["'](@\/[^"']+)["']/
  );
  if (!importMatch) return false;

  const qualityModule = readText(`${importMatch[1].slice(2)}.ts`);
  if (!qualityModule || !/export function detectQualityTier\b/.test(qualityModule)) return false;

  // A `import type … from "three"` erases at build time; a value import does not.
  return !/^\s*import\s+(?!type\b).*?(?:from\s+)?["']three["']/m.test(qualityModule);
}

function allChapterBandsUseTheTimeline(): boolean {
  const originStory = readText("components", "OriginStory.tsx");
  const originFilm = readText("lib", "scenes", "origin-film", "scene.ts");
  if (!originStory || !originFilm || originChapters.length !== 7) return false;

  const rivals = [...sourceFilesUnder("components"), ...sourceFilesUnder("lib/scenes")].filter(
    (path) => path !== "lib/visuals/origin-timeline.ts"
  );

  return (
    originStory.includes('from "@/lib/visuals/origin-timeline"') &&
    originFilm.includes('from "@/lib/visuals/origin-timeline"') &&
    // No second declaration of the bands anywhere else.
    rivals.every((path) => !/\bband\s*:\s*\{\s*in\s*:/.test(readText(path) ?? ""))
  );
}

function reducedMotionRendersSevenStaticChapters(): boolean {
  const source = readText("components", "OriginStory.tsx");
  if (!source) return false;

  return (
    /function StaticStory\(\)/.test(source) &&
    /originChapters\.map\(/.test(source) &&
    /prefersReducedMotion\s*\?\s*<StaticStory\s*\/>\s*:\s*<AnimatedOriginStory\s*\/>/.test(source) &&
    originChapters.length === 7
  );
}

const COLOR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "fill",
  "stroke",
  "decoration",
  "from",
  "to",
  "via",
  "outline",
  "accent",
  "caret",
  "shadow",
  "divide",
  "placeholder",
];

// Words that share a color utility's prefix but name a size, side or keyword.
const NON_COLOR_WORDS = new Set([
  "current", "transparent", "inherit", "white", "black", "none", "auto",
  "xs", "sm", "base", "lg", "xl", "left", "right", "center", "justify", "start",
  "end", "wrap", "nowrap", "balance", "pretty", "ellipsis", "clip",
  "t", "r", "b", "l", "x", "y", "s", "e", "solid", "dashed", "dotted", "double",
  "hidden", "collapse", "separate", "underline", "overline", "line", "through", "wavy",
  "offset", "inset", "reverse", "cover", "contain", "fixed", "local", "scroll", "repeat",
  "top", "bottom", "opacity", "blend", "origin", "position", "size",
]);

/** Every color word used by a `className` in a source file. */
export function colorWordsInClassNames(source: string): string[] {
  const classNames = [
    ...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g),
  ].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
  const colorPattern = new RegExp(
    `\\b(?:${COLOR_PREFIXES.join("|")})-(?:offset-)?([a-z][a-z-]*)\\b`,
    "g"
  );

  return classNames.flatMap((className) =>
    [...className.matchAll(colorPattern)]
      .map((match) => match[1])
      .filter((word) => !word.endsWith("-") && !NON_COLOR_WORDS.has(word))
  );
}

/** Every color word in a class name resolves to a declared `@theme` token. */
export function colorUtilitiesResolveToTokens(
  css: string | null,
  files: readonly SourceFile[]
): boolean {
  if (!css || files.length === 0) return false;

  const tokens = new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((match) => match[1]));
  return files.every(({ source }) => colorWordsInClassNames(source).every((word) => tokens.has(word)));
}

/**
 * Strips the extension from a project-relative path, giving the stem an import
 * specifier for that module would end with (`lib/visuals/drag-inspect.ts` ->
 * `lib/visuals/drag-inspect`). Exported for testing.
 */
export function moduleStem(path: string): string {
  return path.replace(/\.(tsx?|jsx?)$/, "");
}

/**
 * Does `source` import the module at `stem`, by any of the three forms this
 * codebase uses: a static `from "…"`, a dynamic `import("…")`, or a bare
 * side-effect `import "…"`? Alias-agnostic (`@/lib/x` and `../x` both match on
 * the tail), which is the point — this asks "is this module reachable from
 * here", not "how was the path spelled". Exported for testing.
 */
export function importsModule(source: string, stem: string): boolean {
  // The final segment, bounded so it matches a whole path segment and not a
  // substring of a longer name. Matching on more of the path would be tighter
  // but wrong: a sibling module is imported as `"./pollen"`, which carries no
  // directory at all, and the `consumer` path pattern is what narrows the
  // scope anyway.
  const name = stem.split("/").pop()!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const specifier = `["'](?:[^"']*/)?${name}(?:\\.[jt]sx?)?["']`;
  return (
    new RegExp(`from\\s*${specifier}`).test(source) ||
    new RegExp(`import\\s*\\(\\s*${specifier}`).test(source) ||
    new RegExp(`import\\s+${specifier}`).test(source)
  );
}

export interface ConceptWiring {
  /** Path of the module that implements the concept. */
  module: RegExp;
  /** A declaration that module must actually contain. */
  symbol: RegExp;
  /** Path(s) that must IMPORT that module for the concept to be reachable. */
  consumer: RegExp;
  /** How many distinct consumers must do so. Default 1. */
  consumerCount?: number;
}

/**
 * A concept has shipped when a module implements it AND something that renders
 * actually imports that module.
 *
 * The predicate this replaces was `pathPattern.test(path) || symbolPattern
 * .test(source)` — satisfied by a FILE NAME alone, or by a function name in an
 * unrelated file, with no claim that anything ever calls it. That is not a
 * completion metric, it is a spell-checker: it reported a concept as landed
 * for code that provably never executed, and the manifest's own honesty tests
 * could not catch it because they re-ran the same name-grep.
 *
 * Import-reachability is still a proxy — it cannot prove a pixel changed — but
 * it is a proxy that FAILS for dead code, which the old one never did.
 */
export function conceptIsWired(wiring: ConceptWiring): boolean {
  const sources = projectSources();
  const implementations = sources.filter(
    ({ path, source }) => wiring.module.test(path) && wiring.symbol.test(source)
  );
  if (implementations.length === 0) return false;

  const implementationStems = implementations.map(({ path }) => moduleStem(path));
  const consumers = sources.filter(
    ({ path, source }) =>
      !implementationStems.includes(moduleStem(path)) &&
      wiring.consumer.test(path) &&
      implementationStems.some((stem) => importsModule(source, stem))
  );

  return consumers.length >= (wiring.consumerCount ?? 1);
}

/** Every project source under a path, for checks that span several modules. */
export function sourcesMatching(pathPattern: RegExp): SourceFile[] {
  return projectSources().filter(({ path }) => pathPattern.test(path));
}

/** At least one source under `pathPattern` whose text matches every pattern. */
export function someSourceMatchesAll(
  pathPattern: RegExp,
  ...textPatterns: readonly RegExp[]
): boolean {
  return sourcesMatching(pathPattern).some(({ source }) =>
    textPatterns.every((pattern) => pattern.test(source))
  );
}

/**
 * The optional Blender GLB must cost nothing in the state this repo actually
 * ships in, which is *without* the binary. Three separable conditions, because
 * each one has failed independently in review:
 *   - the loader stays behind a dynamic import (it must never reach `/`'s
 *     first-load JS);
 *   - the existence check runs BEFORE that import, so a missing file does not
 *     buy ~35 kB of GLTFLoader and meshopt decoder to parse nothing;
 *   - the procedural rig is still built unconditionally, so the film renders
 *     from the first frame and survives a failed or absent asset.
 */
export function glbPipelineDegradesToProcedural(input: {
  gltf: string | null;
  scene: string | null;
}): boolean {
  const { gltf, scene } = input;
  if (!gltf || !scene) return false;

  const loaderImport = 'import("three/examples/jsm/loaders/GLTFLoader.js")';
  const dynamicOnly =
    gltf.includes(loaderImport) &&
    !/^import .*GLTFLoader/m.test(gltf) &&
    !scene.includes("GLTFLoader");

  const fetchIndex = gltf.indexOf("await fetch(");
  const importIndex = gltf.indexOf(loaderImport);
  const checksBeforeImporting = fetchIndex >= 0 && fetchIndex < importIndex;

  const proceduralFallback =
    scene.includes("buildHand()") &&
    scene.includes("buildMachine()") &&
    scene.includes("loadOriginAssets");

  return dynamicOnly && checksBeforeImporting && proceduralFallback;
}

/**
 * Float render targets must come from a capability probe, and the probe must
 * consult the RENDERABILITY extensions. WebGL1's `OES_texture_float` grants
 * sampling only — a context can hold it and still fail framebuffer
 * completeness — so accepting it as proof is precisely the silent-black-
 * simulation false positive this probe was added to eliminate.
 */
export function gpgpuProbesFloatSupport(input: {
  gpgpu: string | null;
  probe: string | null;
}): boolean {
  const { gpgpu, probe } = input;
  if (!gpgpu || !probe) return false;

  const probesRenderability =
    probe.includes("EXT_color_buffer_float") &&
    probe.includes("WEBGL_color_buffer_float") &&
    !/colorBufferFloat:\s*hasExtension\("OES_texture_float"\)/.test(probe);

  const derivesTypeFromProbe =
    gpgpu.includes("floatSupportToTextureType") &&
    !/type:\s*opts\.type\s*\?\?\s*THREE\.FloatType/.test(gpgpu);

  return probesRenderability && derivesTypeFromProbe;
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

const currentSpanRatio = chapterSpanRatio().toFixed(2);
const currentPlateau = minimumOpacityPlateau().toFixed(3);

export const projectCriteria: readonly ProjectCriterion[] = [
  {
    id: "engine-strictmode-fresh-canvas",
    area: "Boot / Engine",
    description:
      "Engine initialization mints a fresh canvas for every React StrictMode effect setup.",
    status: "done",
    check: safeCheck(() =>
      mintsFreshCanvasPerSetup({
        canvas: readText("lib", "engine", "react", "GlCanvas.tsx"),
        provider: readText("lib", "engine", "react", "EngineProvider.tsx"),
      })
    ),
  },
  {
    id: "engine-per-view-ready-signal",
    area: "Boot / Engine",
    description:
      "A per-view VIEW_READY signal exists, both render hosts emit it, and React exposes it per view.",
    status: "done",
    check: safeCheck(() =>
      emitsPerViewReady({
        types: readText("lib", "engine", "types.ts"),
        host: readText("lib", "engine", "worker", "host.ts"),
        worker: readText("lib", "engine", "worker", "render.worker.ts"),
        provider: readText("lib", "engine", "react", "EngineProvider.tsx"),
        context: readText("lib", "engine", "react", "engine-context.ts"),
      })
    ),
  },
  {
    id: "origin-art-per-view-ready-gate",
    area: "Boot / Engine",
    description: "Origin Story's 2D beat art yields only when its own engine view is ready.",
    status: "done",
    check: safeCheck(() => gatesBeatArtOnViewReady(readText("components", "OriginStory.tsx"))),
  },
  {
    id: "landing-no-boot-scroll-lock",
    area: "Boot / Engine",
    description: "The landing page has no boot overlay import and no body overflow lock.",
    status: "done",
    check: safeCheck(() =>
      hasNoBootScrollLock({
        page: readText("app", "page.tsx"),
        globalsCss: readText("app", "globals.css"),
        landing: [
          ...LANDING_COMPONENTS.map((path) => readText(path)),
          readText("components", "SiteHeader.tsx"),
          readText("lib", "engine", "react", "EngineProvider.tsx"),
        ],
      })
    ),
  },
  {
    id: "bundle-home-under-165kb",
    area: "Bundle",
    description: `Route "/" first-load JS is at most ${HOME_FIRST_LOAD_BUDGET_BYTES.toLocaleString("en-US")} gzip bytes (unmeasurable without a build = not met).`,
    status: "done",
    check: safeCheck(() =>
      firstLoadJsWithinBudget(resolve(process.cwd(), ".next"), HOME_FIRST_LOAD_BUDGET_BYTES)
    ),
  },
  {
    id: "bundle-quality-detection-three-free",
    area: "Bundle",
    description:
      "The quality-detection module EngineProvider imports has no runtime three.js dependency.",
    status: "done",
    check: safeCheck(qualityDetectionIsThreeFree),
  },
  {
    id: "engine-gpgpu-float-capability-probe",
    area: "Boot / Engine",
    description:
      "GPGPU render-target precision comes from a renderability probe, not a hardcoded FloatType.",
    status: "done",
    check: safeCheck(() =>
      gpgpuProbesFloatSupport({
        gpgpu: readText("lib", "engine", "gl", "gpgpu.ts"),
        probe: readText("lib", "engine", "gl", "float-support.ts"),
      })
    ),
  },
  {
    id: "assets-origin-glb-optional-upgrade",
    area: "Assets",
    description:
      "The origin film's hand and machine upgrade to public/origin-assets.glb when present, and cost nothing when absent.",
    status: "done",
    check: safeCheck(() =>
      glbPipelineDegradesToProcedural({
        gltf: readText("lib", "scenes", "origin-film", "gltf.ts"),
        scene: readText("lib", "scenes", "origin-film", "scene.ts"),
      })
    ),
  },
  {
    id: "assets-blender-brief-documented",
    area: "Assets",
    description:
      "The GLB authoring contract (node names, scale, export flags) is written down for whoever makes the models.",
    status: "done",
    check: safeCheck(() => {
      const brief = readText("docs", "origin-assets-blender-brief.md");
      if (!brief) return false;
      // The node names ARE the contract — a brief that omits them is decoration.
      return ["`Hand`", "`Machine`", "gltfpack", "EXT_meshopt_compression"].every((token) =>
        brief.includes(token)
      );
    }),
  },
  {
    id: "timeline-single-chapter-source",
    area: "Timeline / Pacing",
    description: "All seven chapter bands come from lib/visuals/origin-timeline.ts.",
    status: "done",
    check: safeCheck(allChapterBandsUseTheTimeline),
  },
  {
    id: "timeline-final-chapter-holds",
    area: "Timeline / Pacing",
    description: "The final chapter is still fully opaque at progress 1.0.",
    status: "done",
    check: safeCheck(() => bandOpacity(6, 1) === 1),
  },
  {
    id: "timeline-one-a11y-active-chapter",
    area: "Timeline / Pacing",
    description: "Exactly one chapter is accessibility-active at every progress from 0 to 1.",
    status: "done",
    check: safeCheck(() => exactlyOneActiveChapterThroughout()),
  },
  {
    id: "timeline-chapter-span-evenness",
    area: "Timeline / Pacing",
    description: `Chapter span max/min ratio is at most 1.6 (currently ${currentSpanRatio}).`,
    status: "done",
    check: safeCheck(() => chapterSpanRatio() <= 1.6),
  },
  {
    id: "timeline-minimum-opacity-plateau",
    area: "Timeline / Pacing",
    description: `Every chapter holds full opacity for at least 0.08 of scroll (currently ${currentPlateau}).`,
    status: "done",
    check: safeCheck(() => minimumOpacityPlateau() >= 0.08),
  },
  {
    id: "timeline-no-inline-transform-stops",
    area: "Timeline / Pacing",
    description:
      "OriginStory has no hardcoded useTransform stop arrays; every visual track comes from the timeline module.",
    status: "done",
    // An unreadable OriginStory.tsx must be "not met", never met: `?? ""`
    // here would make the criterion pass vacuously (an empty string contains
    // no inline stops), reporting progress for a file nobody could read.
    // Matches how allChapterBandsUseTheTimeline/reducedMotionRendersSeven…
    // guard the same case.
    check: safeCheck(() => {
      const source = readText("components", "OriginStory.tsx");
      return source !== null && hasNoInlineTransformStops(source);
    }),
  },
  {
    id: "a11y-reduced-motion-static-story",
    area: "Progressive Enhancement / A11y",
    description: "Reduced motion renders all seven Origin Story chapters as a static document.",
    status: "done",
    check: safeCheck(reducedMotionRendersSevenStaticChapters),
  },
  {
    id: "a11y-transparent-section-roots",
    area: "Progressive Enhancement / A11y",
    description: "No section root on the landing page paints over the shared GL canvas.",
    status: "done",
    check: safeCheck(() => {
      const files = readAll(LANDING_COMPONENTS);
      // A landing component that vanished (or was renamed) must read as "not
      // met" rather than as "the four that are left are all fine".
      return files.length === LANDING_COMPONENTS.length && sectionRootsAreTransparent(files);
    }),
  },
  {
    id: "a11y-component-color-tokens",
    area: "Progressive Enhancement / A11y",
    description: "Every color utility in components/ resolves to a declared @theme token.",
    status: "done",
    check: safeCheck(() =>
      colorUtilitiesResolveToTokens(readText("app", "globals.css"), readAll(sourceFilesUnder("components")))
    ),
  },
  {
    id: "concept-c1-gpgpu-pollen",
    area: "Concepts",
    description: "C1: a GPGPU pollen field has shipped, and the origin film renders it.",
    status: "done",
    check: safeCheck(
      () =>
        conceptIsWired({
          module: /scenes\/origin-film\/pollen\.ts$/,
          // The field itself, and specifically the GPU path — a CPU-only
          // particle cloud with "pollen" in its name is not concept C1.
          symbol: /class PollenField\b/,
          consumer: /scenes\/origin-film\/scene\.ts$/,
        }) &&
        someSourceMatchesAll(/scenes\/origin-film\/pollen\.ts$/, /\bGpgpu\b/, /floatSupport|support:/) &&
        // ...and the scene must hand it a probed float-support verdict, which
        // is what stops the GPU path from silently rendering black.
        someSourceMatchesAll(/scenes\/origin-film\/scene\.ts$/, /new PollenField\(/, /floatSupport/)
    ),
  },
  {
    id: "concept-c2-audio-soundscape",
    area: "Concepts",
    description: "C2: an audio soundscape has shipped, behind a user-operable control.",
    status: "done",
    check: safeCheck(
      () =>
        conceptIsWired({
          module: /lib\/audio\/soundscape\.ts$/,
          symbol: /(?:class|function|const)\s+\w*[Ss]oundscape\w*/,
          // A soundscape nothing can start is not a shipped soundscape. The
          // consumer must be a component, i.e. something that renders.
          consumer: /^components\//,
        }) &&
        // Audio may never autoplay: the control has to be an actual toggle
        // with an accessible pressed state.
        someSourceMatchesAll(/^components\/SoundToggle\.tsx$/, /aria-pressed/),
    ),
  },
  {
    id: "concept-c4-drag-to-inspect",
    area: "Concepts",
    description: "C4: a drag-to-inspect can has shipped, in both the DOM arbiter and the GL scene.",
    status: "done",
    check: safeCheck(
      () =>
        // Both halves are required and they are genuinely separate: the scene
        // owns the rotation but cannot call preventDefault(), so a component
        // has to arbitrate the gesture or the film becomes a scroll trap.
        conceptIsWired({
          module: /lib\/visuals\/drag-inspect\.ts$/,
          symbol: /export function createDragInspector\b/,
          consumer: /^components\/|scenes\/origin-film\/scene\.ts$/,
          consumerCount: 2,
        }) &&
        // And the hit element must carry the touch-action policy, without
        // which the gesture is either never delivered or eats the scroll.
        someSourceMatchesAll(/^components\/OriginStory\.tsx$/, /DRAG_INSPECT_TOUCH_ACTION/),
    ),
  },
  {
    id: "concept-c6-riso-grain-post-pass",
    area: "Concepts",
    description: "C6: a riso-grain post-pass has shipped, and is reachable on both the GPU and fallback paths.",
    status: "done",
    // Deliberately the longest check in this file. C6 is the concept that
    // proved a name-grep is not a completion metric: the effect, its 43 tests
    // and its fallback descriptor all existed while NOTHING constructed the
    // pass in the running app, because no view opted into post-processing and
    // no host ever named a route. Every conjunct below is one link of that
    // chain, and each one was independently missing at some point.
    check: safeCheck(
      () =>
        // 1. The effect exists and the composer builds it.
        someSourceMatchesAll(/gl\/shaders\/riso(?:-policy)?\.ts$/, /riso[-_]?[Gg]rain/) &&
        someSourceMatchesAll(/gl\/post\.ts$/, /createRisoGrainEffect\(/) &&
        // 2. A view can ASK for the post chain, end to end: the hook option,
        //    the context option, and a real caller passing it.
        someSourceMatchesAll(/engine\/react\/useView\.ts$/, /post\??:/) &&
        someSourceMatchesAll(/^components\/OriginStory\.tsx$/, /post:\s*true/) &&
        // 3. Both hosts forward the opt-in to Stage.addView.
        sourcesMatching(/engine\/worker\/(host|render\.worker)\.ts$/).every(({ source }) =>
          /addView\([^)]*\{\s*post/.test(source.replace(/\n\s*/g, " "))
        ) &&
        // 4. Both hosts name a route, without which Post builds no grain at
        //    all — this was true of the shipped code while every riso test
        //    passed, because the tests hand-passed their own route.
        sourcesMatching(/engine\/worker\/(host|render\.worker)\.ts$/).every(({ source }) =>
          /route[,:]/.test(source)
        ) &&
        someSourceMatchesAll(/engine\/react\/EngineProvider\.tsx$/, /route:/) &&
        // 5. The low tier, where the GPU pass declines, still gets the print
        //    texture from a real DOM layer.
        conceptIsWired({
          module: /gl\/shaders\/riso-policy\.ts$/,
          symbol: /export const RISO_GRAIN_FALLBACK\b/,
          consumer: /engine\/react\/.*\.tsx$/,
        })
    ),
  },
  {
    id: "concept-c11-shelf-to-showcase",
    area: "Concepts",
    description: "C11: the shelf-to-showcase transition has shipped, driven from both sides of the section boundary.",
    status: "done",
    check: safeCheck(
      () =>
        // TWO consumers is the concept: one section handing an arrangement to
        // another. A single importer would be a carousel, not a handoff.
        conceptIsWired({
          module: /lib\/visuals\/shelf-to-showcase\.ts$/,
          symbol: /export function createShelfHandoff\b/,
          consumer: /^components\/(OriginStory|FlavorShowcase)\.tsx$/,
          consumerCount: 2,
        }) &&
        // Both legs must read the SAME crossfade function, or the two layers
        // stop summing to 1 across the boundary and the seam shows a hole.
        sourcesMatching(/^components\/(OriginStory|FlavorShowcase)\.tsx$/).every(({ source }) =>
          /handoffLayerOpacities\(/.test(source)
        )
    ),
  },
];
