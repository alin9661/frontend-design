import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  chapterSpanRatio,
  colorUtilitiesResolveToTokens,
  conceptIsWired,
  emitsPerViewReady,
  evaluateCriteria,
  exactlyOneActiveChapterThroughout,
  firstLoadJsBytes,
  firstLoadJsWithinBudget,
  formatProgressReport,
  gatesBeatArtOnViewReady,
  glbPipelineDegradesToProcedural,
  gpgpuProbesFloatSupport,
  homeBundleBudgetIsEnforced,
  importsModule,
  moduleStem,
  hasNoBootScrollLock,
  hasNoInlineTransformStops,
  minimumOpacityPlateau,
  mintsFreshCanvasPerSetup,
  projectCriteria,
  safeCheck,
  sectionRootAttributes,
  sectionRootsAreTransparent,
  summarizeCriteria,
  type ProjectCriterion,
} from "@/lib/project-criteria";

// The three headline tests turn lib/project-criteria.ts into a completion
// metric that cannot lie in either direction, without ever going red on work
// that simply is not finished (CLAUDE.md forbids both a failing test and a
// skipped one, so "not done" lives in the manifest as data).

describe("lib/project-criteria manifest", () => {
  it("HONESTY BACKWARD: every criterion marked done still holds", async () => {
    const results = await evaluateCriteria(projectCriteria);
    const regressions = results
      .filter(({ status, met }) => status === "done" && met !== true)
      .map(({ id, met, error }) =>
        met === null ? `${id}: done criterion has no executable check` : `${id}${error ? `: check threw ${error}` : ""}`
      );

    expect(
      regressions,
      "A landed project guarantee regressed. Fix the implementation; do not downgrade the criterion to planned."
    ).toEqual([]);
  });

  it("HONESTY FORWARD: no planned criterion is already passing", async () => {
    const results = await evaluateCriteria(projectCriteria);
    const stale = results.filter(({ status, met }) => status === "planned" && met === true).map(({ id }) => id);

    expect(
      stale,
      "These planned criteria now pass. Flip their manifest status to done so the metric reports real progress."
    ).toEqual([]);
  });

  it("THE METRIC: reports completion by area and keeps the manifest well-formed", () => {
    const ids = projectCriteria.map(({ id }) => id);

    expect(new Set(ids).size, "criterion ids must be unique").toBe(ids.length);
    for (const criterion of projectCriteria) {
      expect(criterion.id.trim(), "every criterion needs an id").not.toBe("");
      expect(criterion.area.trim(), `${criterion.id} needs an area`).not.toBe("");
      expect(criterion.description.trim(), `${criterion.id} needs a description`).not.toBe("");
      expect(["done", "planned"], `${criterion.id} has an invalid status`).toContain(criterion.status);
    }

    // Deliberately process.stdout.write and not console.log: `bun run test`
    // uses vitest's default reporter, which swallows console output from a
    // PASSING test — and this report is the deliverable, so it has to survive
    // the green path. It must never assert a target percentage; that would
    // turn "the project is unfinished" into a red suite.
    process.stdout.write(formatProgressReport(projectCriteria));
  });
});

describe("lib/project-criteria evaluation helpers", () => {
  const criterion = (over: Partial<ProjectCriterion>): ProjectCriterion => ({
    id: "x",
    area: "Area",
    description: "d",
    status: "planned",
    ...over,
  });

  it("safeCheck passes a predicate's value through and turns a throw into not-met", () => {
    expect(safeCheck(() => true)()).toBe(true);
    expect(safeCheck(() => false)()).toBe(false);
    expect(
      safeCheck(() => {
        throw new Error("no build output");
      })()
    ).toBe(false);
  });

  it("evaluateCriteria records true, false, thrown and check-less criteria distinctly", async () => {
    const results = await evaluateCriteria([
      criterion({ id: "met", check: () => true }),
      criterion({ id: "unmet", check: () => false }),
      criterion({ id: "async-met", check: async () => true }),
      criterion({ id: "checkless" }),
      criterion({
        id: "throws",
        check: () => {
          throw new Error("boom");
        },
      }),
    ]);

    expect(results.map(({ id, met }) => [id, met])).toEqual([
      ["met", true],
      ["unmet", false],
      ["async-met", true],
      ["checkless", null],
      ["throws", false],
    ]);
    expect(results.find(({ id }) => id === "throws")?.error).toContain("boom");
  });

  it("summarizeCriteria counts per area and overall, and survives an empty manifest", () => {
    const summary = summarizeCriteria([
      criterion({ id: "a", area: "Boot", status: "done" }),
      criterion({ id: "b", area: "Boot", status: "planned" }),
      criterion({ id: "c", area: "Bundle", status: "done" }),
    ]);

    expect(summary.areas).toEqual([
      { area: "Boot", done: 1, total: 2 },
      { area: "Bundle", done: 1, total: 1 },
    ]);
    expect(summary.done).toBe(2);
    expect(summary.total).toBe(3);
    expect(summary.percent).toBe(67);

    expect(summarizeCriteria([])).toEqual({ areas: [], done: 0, total: 0, percent: 0 });
  });

  it("formatProgressReport groups by area, names remaining work and prints the overall line", () => {
    const report = formatProgressReport([
      criterion({ id: "shipped", area: "Boot", status: "done" }),
      criterion({ id: "not-shipped", area: "Boot", status: "planned" }),
    ]);

    expect(report).toContain("Boot");
    expect(report).toContain("remaining: not-shipped");
    expect(report).not.toContain("remaining: shipped");
    expect(report).toContain("1/2 criteria met (50%)");
  });
});

describe("lib/project-criteria source predicates", () => {
  it("recognizes the home bundle gate only when CI runs it after a build", () => {
    const bundleScript = `
      const HOME_BUDGET = 165_000;
      const ROUTE_BUDGETS = [{ route: "/", manifestKey: "/page", budgetBytes: HOME_BUDGET }];
    `;
    const workflow = `
      - name: Build
        run: bun run build
      - name: Check bundle-size budgets
        run: bun scripts/check-bundle.ts
    `;

    expect(homeBundleBudgetIsEnforced({ bundleScript, workflow })).toBe(true);
    expect(homeBundleBudgetIsEnforced({ bundleScript: null, workflow })).toBe(false);
    expect(homeBundleBudgetIsEnforced({ bundleScript, workflow: null })).toBe(false);
    expect(
      homeBundleBudgetIsEnforced({
        bundleScript: bundleScript.replace("165_000", "200_000"),
        workflow,
      })
    ).toBe(false);
    expect(
      homeBundleBudgetIsEnforced({
        bundleScript,
        workflow: workflow.split("\n").reverse().join("\n"),
      })
    ).toBe(false);
  });

  it("sectionRootAttributes reads every root tag, including one opened by an arrow handler", () => {
    const source = `
      <motion.section onPointerEnter={(e) => setHover(true)} className="relative">
        <div className="bg-forest" />
      </motion.section>
      <footer className="relative pt-32">x</footer>
    `;

    const roots = sectionRootAttributes(source);

    expect(roots).toHaveLength(2);
    expect(roots[0]).toContain('className="relative"');
    expect(roots[1]).toContain('className="relative pt-32"');
    expect(sectionRootAttributes("<div className=\"bg-forest\" />")).toEqual([]);
  });

  it("scans `m.*` roots, not just `motion.*` — the namespace the LazyMotion migration moved to", () => {
    // Regression: the scanner's regex knew `<section`, `<footer` and
    // `<motion.section` but not `<m.section`. After every rendered element
    // was rewritten to the lightweight `m.*` namespace, OriginStory's sticky
    // `<m.section>` — the ONE root that actually overlays the shared GL
    // canvas — stopped being scanned. Its StaticStory `<section>` sibling
    // still matched, so the "every file contributes a root" safety net below
    // saw one root and reported the file fine. The criterion kept passing
    // while covering strictly less than it claimed.
    const painted = '<m.section className="relative bg-forest"><p /></m.section>';

    expect(sectionRootAttributes(painted)).toHaveLength(1);
    expect(sectionRootsAreTransparent([{ path: "m.tsx", source: painted }])).toBe(false);
    expect(sectionRootAttributes('<m.footer className="relative">x</m.footer>')).toHaveLength(1);
    // `m.` is a prefix, not a wildcard: an unrelated element must not match.
    expect(sectionRootAttributes('<m.div className="bg-forest" />')).toEqual([]);
  });

  it("scans BOTH of OriginStory's real section roots (the sticky m.section and the static section)", () => {
    // Pins the regression against the real file rather than a fixture: if the
    // sticky root falls out of the scan again, this drops back to 1.
    const source = readFileSync(
      resolve(import.meta.dirname, "../components/OriginStory.tsx"),
      "utf8"
    );
    const roots = sectionRootAttributes(source);

    expect(roots.some((root) => root.includes('data-layout="sticky"'))).toBe(true);
    expect(roots.some((root) => root.includes('data-layout="static"'))).toBe(true);
  });

  it("sectionRootsAreTransparent rejects an opaque root and accepts an underlay child", () => {
    const opaque = { path: "a.tsx", source: '<section className="relative bg-forest"><p /></section>' };
    const underlaid = {
      path: "b.tsx",
      source: '<section className="relative"><div className="absolute inset-0 -z-10 bg-forest" /></section>',
    };

    expect(sectionRootsAreTransparent([underlaid])).toBe(true);
    expect(sectionRootsAreTransparent([opaque])).toBe(false);
    expect(sectionRootsAreTransparent([underlaid, opaque])).toBe(false);
    expect(
      sectionRootsAreTransparent([{ path: "bg-transparent.tsx", source: '<section className="bg-transparent" />' }])
    ).toBe(true);
    // A file with no root at all, and an empty file list, are both "not met".
    expect(sectionRootsAreTransparent([{ path: "c.tsx", source: "<div />" }])).toBe(false);
    expect(sectionRootsAreTransparent([])).toBe(false);
  });

  it("hasNoInlineTransformStops flags a literal stop array but not a timeline-derived one", () => {
    expect(hasNoInlineTransformStops("const o = useTransform(progress, bandStops(2), bandOutputs(2));")).toBe(true);
    expect(hasNoInlineTransformStops("const o = useTransform(progress, shelfStops.slice(0, 2), [0, 1]);")).toBe(true);
    expect(hasNoInlineTransformStops("const o = useTransform(progress, [0, 0.32, 0.52], [1, 1, 0]);")).toBe(false);
    expect(hasNoInlineTransformStops("const y = useTransform(\n  progress,\n  [0, 1],\n  [24, -8]\n);")).toBe(false);
    // THE TRAP: an empty source contains no inline stops, so the predicate
    // says "true". That is correct for the predicate and catastrophic for a
    // caller that feeds it `readText(...) ?? ""` — see the criterion test
    // below.
    expect(hasNoInlineTransformStops("")).toBe(true);
  });

  it("timeline-no-inline-transform-stops reports NOT met when OriginStory.tsx cannot be read", () => {
    // Regression: the criterion used `readText("components", "OriginStory.tsx") ?? ""`.
    // An unreadable file therefore became an empty string, which contains no
    // inline stop arrays, so the criterion reported MET with no source to
    // check at all — a green metric earned by a missing file. (Not
    // hypothetical here: this repo has hit EPERM reading its own files.)
    // readText resolves against process.cwd(), so pointing cwd at an empty
    // directory is exactly "the file cannot be read".
    const criterion = projectCriteria.find((c) => c.id === "timeline-no-inline-transform-stops");
    expect(criterion?.check).toBeDefined();

    // Sanity: it genuinely passes against the real tree.
    expect(criterion!.check!()).toBe(true);

    const emptyRoot = mkdtempSync(join(tmpdir(), "criteria-unreadable-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(emptyRoot);
    try {
      expect(criterion!.check!()).toBe(false);
    } finally {
      cwd.mockRestore();
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("emitsPerViewReady requires the protocol, BOTH hosts and the React consumer", () => {
    const complete = {
      types: 'export interface ViewReadyEvent { type: "VIEW_READY"; viewId: number }',
      host: `export class WorkerHost { onMessage(ev) { for (const cb of this.listeners) cb(ev.data); } }
             export class MainThreadHost { init() { stage.run({ onViewReady: (viewId) => this.emit({ type: "VIEW_READY", viewId }) }); } }`,
      worker: 'stage.run({ onViewReady: (viewId) => ctx.postMessage({ type: "VIEW_READY", viewId }) });',
      provider: 'if (msg.type === "VIEW_READY") setReady(); const isViewReady = (id) => readyViewIds.has(id);',
      context: "isViewReady?: (viewId: number) => boolean;",
    };

    expect(emitsPerViewReady(complete)).toBe(true);
    // Each leg on its own is load-bearing.
    expect(emitsPerViewReady({ ...complete, types: null })).toBe(false);
    expect(emitsPerViewReady({ ...complete, types: "export interface Event { type: 'READY' }" })).toBe(false);
    expect(
      emitsPerViewReady({
        ...complete,
        host: 'export class WorkerHost { onMessage(ev) { for (const cb of this.listeners) cb(ev.data); } }',
      }),
      "a MainThreadHost that never emits VIEW_READY leaves the no-OffscreenCanvas path silent"
    ).toBe(false);
    expect(
      emitsPerViewReady({ ...complete, worker: "stage.run({});" }),
      "a worker that never posts VIEW_READY leaves the WorkerHost path silent"
    ).toBe(false);
    expect(emitsPerViewReady({ ...complete, provider: 'if (msg.type === "READY") setReady();' })).toBe(false);
    expect(emitsPerViewReady({ ...complete, context: "status: EngineStatus;" })).toBe(false);
  });

  it("mintsFreshCanvasPerSetup requires a created canvas, a replaced slot and a mint() call", () => {
    const canvas = 'function mint() { const canvas = document.createElement("canvas"); slot.replaceChildren(canvas); }';
    const provider = "const canvas = canvasRef.current?.mint();";

    expect(mintsFreshCanvasPerSetup({ canvas, provider })).toBe(true);
    expect(mintsFreshCanvasPerSetup({ canvas, provider: "const canvas = canvasRef.current;" })).toBe(false);
    expect(
      mintsFreshCanvasPerSetup({
        canvas: 'function mint() { const canvas = document.createElement("canvas"); slot.appendChild(canvas); }',
        provider,
      }),
      "appendChild keeps the previous StrictMode setup's transferred canvas in the DOM"
    ).toBe(false);
    expect(mintsFreshCanvasPerSetup({ canvas: null, provider })).toBe(false);
  });

  it("gatesBeatArtOnViewReady rejects a gate on the engine's global status alone", () => {
    const perView = `const originFilmReady = engine?.status === "ready" && originFilmViewId !== null &&
      engine.isViewReady?.(originFilmViewId) === true;
      return <LivingScene showBeatArt={!originFilmReady} />;`;
    const global = `const originFilmReady = engine?.status === "ready";
      return <LivingScene showBeatArt={!originFilmReady} />;`;

    expect(gatesBeatArtOnViewReady(perView)).toBe(true);
    expect(gatesBeatArtOnViewReady(global)).toBe(false);
    expect(gatesBeatArtOnViewReady(null)).toBe(false);
  });

  it("hasNoBootScrollLock catches a boot overlay, a body style lock and a CSS body lock", () => {
    const clean = { page: "export default function Home() { return <main /> }", globalsCss: "body { margin: 0 }", landing: ["<section />"] };

    expect(hasNoBootScrollLock(clean)).toBe(true);
    expect(hasNoBootScrollLock({ ...clean, page: "import LoadingScreen from '@/components/LoadingScreen';" })).toBe(false);
    expect(hasNoBootScrollLock({ ...clean, globalsCss: "body { overflow: hidden; }" })).toBe(false);
    expect(hasNoBootScrollLock({ ...clean, landing: ['document.body.style.overflow = "hidden";'] })).toBe(false);
    expect(
      hasNoBootScrollLock({ ...clean, landing: ['document.body.classList.add("overflow-hidden");'] })
    ).toBe(false);
    expect(hasNoBootScrollLock({ ...clean, landing: [null] })).toBe(false);
    expect(hasNoBootScrollLock({ ...clean, globalsCss: null })).toBe(false);
  });

  it("colorUtilitiesResolveToTokens accepts declared tokens and rejects an undeclared one", () => {
    const css = "@theme { --color-forest: #1D423C; --color-cream: #F9F9EE; }";

    expect(colorUtilitiesResolveToTokens(css, [{ path: "a.tsx", source: '<p className="bg-forest text-cream/65" />' }])).toBe(true);
    expect(colorUtilitiesResolveToTokens(css, [{ path: "a.tsx", source: '<p className="bg-turquoise" />' }])).toBe(false);
    // Keywords and sizes that merely share a color prefix are not tokens.
    expect(colorUtilitiesResolveToTokens(css, [{ path: "a.tsx", source: '<p className="bg-transparent text-xs" />' }])).toBe(true);
    expect(colorUtilitiesResolveToTokens(null, [{ path: "a.tsx", source: "" }])).toBe(false);
    expect(colorUtilitiesResolveToTokens(css, [])).toBe(false);
  });

  it("conceptIsWired demands an implementation AND a consumer that imports it", () => {
    // The predicate this replaced was `path matches OR source contains` — so a
    // file NAME alone satisfied it, and so did a function name in a totally
    // unrelated file. It reported concepts as landed for code that provably
    // never ran, and the manifest's own honesty tests could not catch that
    // because they re-ran the same name-grep. Each clause below is a way the
    // old predicate said yes and this one says no.

    // 1. No such module: no.
    expect(
      conceptIsWired({
        module: /definitely-not-a-module/,
        symbol: /export function bandOpacity\b/,
        consumer: /^components\//,
      }),
    ).toBe(false);

    // 2. A real module whose named symbol is NOT in it: no. (The old
    //    predicate returned true here on the path match alone.)
    expect(
      conceptIsWired({
        module: /lib\/visuals\/origin-timeline\.ts$/,
        symbol: /export function neverMatchesAnything\b/,
        consumer: /^components\//,
      }),
    ).toBe(false);

    // 3. A real, implemented module that NOTHING in the named consumer scope
    //    imports: no. This is the dead-code case the metric exists to catch.
    expect(
      conceptIsWired({
        module: /lib\/visuals\/origin-timeline\.ts$/,
        symbol: /export function bandOpacity\b/,
        consumer: /^app\/refer\//,
      }),
    ).toBe(false);

    // 4. Implemented AND imported by something that renders: yes.
    expect(
      conceptIsWired({
        module: /lib\/visuals\/origin-timeline\.ts$/,
        symbol: /export function bandOpacity\b/,
        consumer: /^components\/OriginStory\.tsx$/,
      }),
    ).toBe(true);

    // 5. `consumerCount` really counts DISTINCT consumers: one importer
    //    cannot satisfy a two-consumer concept (a handoff needs both sides).
    expect(
      conceptIsWired({
        module: /lib\/visuals\/shelf-to-showcase\.ts$/,
        symbol: /export function createShelfHandoff\b/,
        consumer: /^components\/OriginStory\.tsx$/,
        consumerCount: 2,
      }),
    ).toBe(false);
    expect(
      conceptIsWired({
        module: /lib\/visuals\/shelf-to-showcase\.ts$/,
        symbol: /export function createShelfHandoff\b/,
        consumer: /^components\/(OriginStory|FlavorShowcase)\.tsx$/,
        consumerCount: 2,
      }),
    ).toBe(true);
  });

  it("importsModule recognises every import form this codebase uses, and nothing else", () => {
    const stem = "lib/audio/soundscape";

    expect(importsModule('import { x } from "@/lib/audio/soundscape";', stem)).toBe(true);
    expect(importsModule('const m = await import("@/lib/audio/soundscape");', stem)).toBe(true);
    expect(importsModule('import "../audio/soundscape";', stem)).toBe(true);
    expect(importsModule('import x from "./soundscape.ts";', stem)).toBe(true);
    // A sibling module carries no directory at all — this is how
    // lib/scenes/origin-film/scene.ts imports its own pollen field.
    expect(importsModule('import { PollenField } from "./pollen";', "lib/scenes/origin-film/pollen")).toBe(
      true,
    );

    // A mention is not an import — the whole point of replacing the old
    // name-grep is that prose and identifiers no longer count as wiring.
    expect(importsModule("// see lib/audio/soundscape for the graph", stem)).toBe(false);
    expect(importsModule("const soundscape = null;", stem)).toBe(false);
    expect(importsModule('import { x } from "@/lib/audio/other";', stem)).toBe(false);
    // A longer name that merely CONTAINS the module's name is a different
    // module: the final segment has to match whole.
    expect(importsModule('import { x } from "@/lib/audio/soundscape-legacy";', stem)).toBe(false);
  });

  it("moduleStem strips the extension so a path and an import specifier compare equal", () => {
    expect(moduleStem("lib/visuals/drag-inspect.ts")).toBe("lib/visuals/drag-inspect");
    expect(moduleStem("components/OriginStory.tsx")).toBe("components/OriginStory");
    expect(moduleStem("lib/no-extension")).toBe("lib/no-extension");
  });

  it("glbPipelineDegradesToProcedural rejects each way the optional upgrade stops being free", () => {
    const gltf = `
      const response = await fetch(url);
      if (!response.ok) return NO_ASSETS;
      const [{ GLTFLoader }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
      ]);`;
    const scene = `
      this.machine = buildMachine();
      this.hand = buildHand();
      void loadOriginAssets().then((assets) => {});`;

    expect(glbPipelineDegradesToProcedural({ gltf, scene })).toBe(true);
    expect(
      glbPipelineDegradesToProcedural({
        gltf,
        scene: `
          this.machine = buildMachine({ simplified: compact });
          this.hand = buildHand({ silhouette: compact });
          void loadOriginAssets().then((assets) => {});`,
      }),
    ).toBe(true);

    // Loader imported before the file is known to exist: every visitor pays
    // for GLTFLoader + meshopt to parse nothing.
    const eagerImport = `
      const [{ GLTFLoader }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
      ]);
      const response = await fetch(url);`;
    expect(glbPipelineDegradesToProcedural({ gltf: eagerImport, scene })).toBe(false);

    // A static import puts the loader in the route's first-load JS.
    expect(
      glbPipelineDegradesToProcedural({
        gltf: `import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";\n${gltf}`,
        scene,
      })
    ).toBe(false);

    // Fallback deleted: nothing renders until (and unless) the GLB arrives.
    expect(
      glbPipelineDegradesToProcedural({
        gltf,
        scene: "void loadOriginAssets().then((assets) => {});",
      })
    ).toBe(false);

    expect(glbPipelineDegradesToProcedural({ gltf: null, scene })).toBe(false);
    expect(glbPipelineDegradesToProcedural({ gltf, scene: null })).toBe(false);
  });

  it("gpgpuProbesFloatSupport rejects a probe that reads the sampling extension", () => {
    const probe = `
      colorBufferFloat: hasExtension("EXT_color_buffer_float"),
      colorBufferFloat: hasExtension("WEBGL_color_buffer_float"),`;
    const gpgpu = "const mappedType = floatSupportToTextureType(opts.support ?? \"float\");";

    expect(gpgpuProbesFloatSupport({ gpgpu, probe })).toBe(true);

    // OES_texture_float grants sampling, not renderability — accepting it is
    // the false positive the whole probe exists to remove.
    expect(
      gpgpuProbesFloatSupport({
        gpgpu,
        probe: `${probe}\n colorBufferFloat: hasExtension("OES_texture_float"),`,
      })
    ).toBe(false);

    // WebGL1 unprobed: the half of the fleet most likely to lack float RTTs.
    expect(
      gpgpuProbesFloatSupport({ gpgpu, probe: 'colorBufferFloat: hasExtension("EXT_color_buffer_float"),' })
    ).toBe(false);

    // The old hardcoded default, still in place behind a probe that is never consulted.
    expect(
      gpgpuProbesFloatSupport({ gpgpu: "type: opts.type ?? THREE.FloatType,", probe })
    ).toBe(false);

    expect(gpgpuProbesFloatSupport({ gpgpu: null, probe })).toBe(false);
    expect(gpgpuProbesFloatSupport({ gpgpu, probe: null })).toBe(false);
  });
});

describe("lib/project-criteria bundle measurement", () => {
  const fixtures: string[] = [];

  function buildDir(files: string[], chunkBytes: number): string {
    const dir = mkdtempSync(join(tmpdir(), "project-metrics-"));
    fixtures.push(dir);
    mkdirSync(join(dir, "static"), { recursive: true });
    // Random-ish bytes: incompressible, so the gzip sum stays near chunkBytes.
    writeFileSync(
      join(dir, "static", "chunk.js"),
      Array.from({ length: chunkBytes }, (_, i) => String.fromCharCode(33 + ((i * 7919) % 90))).join("")
    );
    writeFileSync(join(dir, "build-manifest.json"), JSON.stringify({ pages: {} }));
    writeFileSync(join(dir, "app-build-manifest.json"), JSON.stringify({ pages: { "/page": files } }));
    return dir;
  }

  afterAll(() => {
    for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
  });

  it("sums only the .js chunks of route /", () => {
    // styles.css is listed in the manifest but never written to disk: if the
    // sum read it, this would come back null (unmeasurable) instead of bytes.
    const withCss = firstLoadJsBytes(buildDir(["static/chunk.js", "static/styles.css"], 4_000));
    const jsOnly = firstLoadJsBytes(buildDir(["static/chunk.js"], 4_000));

    expect(withCss).not.toBeNull();
    expect(withCss).toBe(jsOnly);
    expect(withCss!).toBeGreaterThan(0);
    // Gzipped, so strictly smaller than the 4 kB source it measures.
    expect(withCss!).toBeLessThan(4_000);
  });

  it("reports unmeasurable build output as not met instead of throwing", () => {
    expect(firstLoadJsBytes(resolve(tmpdir(), "project-metrics-does-not-exist"))).toBeNull();
    expect(firstLoadJsWithinBudget(resolve(tmpdir(), "project-metrics-does-not-exist"), 165_000)).toBe(false);
    // A resolved route that lists no JS would measure 0 bytes and sail under
    // every budget — that is a tooling break, not a pass.
    expect(firstLoadJsBytes(buildDir(["static/styles.css"], 100))).toBeNull();
    expect(firstLoadJsWithinBudget(buildDir(["static/styles.css"], 100), 165_000)).toBe(false);
    // A manifest listing a chunk that isn't on disk is unmeasurable too.
    expect(firstLoadJsBytes(buildDir(["static/missing.js"], 100))).toBeNull();
  });

  it("passes a small bundle and fails one over budget", () => {
    const dir = buildDir(["static/chunk.js"], 4_000);

    expect(firstLoadJsWithinBudget(dir, 165_000)).toBe(true);
    expect(firstLoadJsWithinBudget(dir, 10)).toBe(false);
  });
});

describe("lib/project-criteria timeline measurements", () => {
  it("measures the current chapter span ratio and opacity plateau from the timeline", () => {
    // These two measurements are what the pacing criteria are graded on, so
    // they are pinned to the thresholds those criteria name — not merely to
    // "whatever the timeline currently returns", which would move with any
    // retune and grade nothing.
    //
    // Both are still real ratios of real band data, so a generator that
    // collapsed every chapter onto one another (ratio 1, plateau equal to the
    // whole film) would fail the lower bounds rather than sail through.
    expect(chapterSpanRatio()).toBeGreaterThan(1);
    expect(chapterSpanRatio()).toBeLessThanOrEqual(1.6);
    expect(minimumOpacityPlateau()).toBeGreaterThanOrEqual(0.08);
    expect(minimumOpacityPlateau()).toBeLessThan(0.5);

    // The weighted generator's actual numbers, so a silent regression in the
    // pacing shows up here as a diff and not just as "still within bounds".
    expect(chapterSpanRatio()).toBeCloseTo(1.325, 3);
    expect(minimumOpacityPlateau()).toBeCloseTo(0.085, 3);
  });

  it("finds exactly one a11y-active chapter across the whole scroll", () => {
    expect(exactlyOneActiveChapterThroughout(200)).toBe(true);
    expect(exactlyOneActiveChapterThroughout()).toBe(true);
  });
});
