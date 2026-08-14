// scripts/check-bundle.ts
//
// CI bundle-size gate: after `bun run build`, asserts that each budgeted
// route's "First Load JS" hasn't regressed past its budget. Exits non-zero
// with a clear message on breach; run via `bun scripts/check-bundle.ts`
// (see .github/workflows/test.yml's build job). Set the `NEXT_DIR`
// environment variable to point at a different build output directory
// (default `.next` at the repo root) — used by this file's own subprocess
// test (test/scripts/check-bundle.test.ts) to run the real CLI against a
// small fixture instead of a full `bun run build`.
//
// Approach (deterministic, no stdout scraping): `bun run build`'s printed
// "First Load JS" table is ANSI-colored and column-formatted — parsing it
// would be fragile across Next.js versions/terminal-width wrapping. Instead
// this reads both manifests that can own route chunks: App Router entries in
// `app-build-manifest.json` use internal keys such as `/deep-wave/page`, while
// Pages Router entries in `build-manifest.json` use URL keys such as
// `/deep-wave`. The exact JS files are gzip-summed; `.css` entries are skipped
// because Next's "First Load JS" is a JS-only metric.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "..");

/** Resolves the Next.js build output directory: `NEXT_DIR` env override if
 * set (see this file's header comment), else `.next` at the repo root. */
function resolveNextDir(): string {
  const override = process.env.NEXT_DIR;
  return override && override.length > 0 ? resolve(override) : resolve(ROOT, ".next");
}

// Budgets are in bytes, gzip-equivalent (see this file's header). Headroom
// is intentional slack above the CURRENT measured size, not a target to
// grow into — a breach means investigate first, raise the budget only if
// the growth is deliberate and reviewed.
/**
 * `/` measures 163.6 kB gzip against a 165.0 kB budget — about 1.4 kB of
 * headroom, so this budget is TIGHT: a couple of kB of new client code
 * anywhere in the landing page's tree will breach it.
 *
 * RE-MEASURE, DO NOT TRUST THIS PARAGRAPH. Every figure here was correct when
 * written and silently rots with the next commit; `bun run build && bun
 * scripts/check-bundle.ts` prints the current one in two lines of output.
 * A previous revision of this comment claimed "only 269 bytes of headroom"
 * long after the gate had started printing 149.6 kB, which is worse than no
 * figure at all — a reader who spots one stale number assumes the direction of
 * the error and spends the slack they think is hiding.
 *
 * The figure moved for a real reason, not just drift: this gate used to sum
 * ONLY the `/page` manifest key (149.4 kB) and never the root layout's own
 * client chunks, which the browser downloads on the same navigation. See
 * SHARED_MANIFEST_KEYS. 163.6 kB is the honest number — it matches the script
 * tags in `.next/server/app/index.html` exactly, polyfills aside.
 *
 * What the gate is for: catching the engine/three.js bundle leaking back into
 * the landing first-load (see docs/deep-wave-engine-design.md §6 "Bundle:
 * engine/three load only on /deep-wave"); for scale, statically importing the
 * three.js chunk here measures 247.7 kB. The remaining weight is framer-motion
 * under LazyMotion/`m`, pulled in by every components/*.tsx.
 *
 * NOT covered by this gate, and worth knowing before trusting a PASS: async
 * chunks are not First Load JS, so the ~226 kB gzip of three.js +
 * postprocessing that lib/engine/react/LazyEngineProvider.tsx fetches after
 * hydration is invisible here on both routes.
 *
 * History: 157954 bytes when this gate was written; 320 kB once EngineProvider
 * was statically imported by app/page.tsx; back down once that import moved
 * behind LazyEngineProvider. */
const HOME_BUDGET = 165_000;
/**
 * `/deep-wave` measures 155.6 kB gzip, well under budget. (Same warning as
 * above: re-measure rather than trusting the number. A previous revision of
 * this comment said 160.2 kB while the gate printed 134.7 kB.)
 *
 * It previously measured ~304 kB when it statically owned the whole
 * engine/three.js/postprocessing payload; that payload is now behind a
 * post-mount dynamic import in lib/engine/worker/host.ts, so it no longer
 * counts toward First Load JS on either route. The 330 kB budget is
 * deliberately left where it is: it still covers the remaining M2/M3 scene
 * work (splats, MSDF text) and re-inlining the engine, without silently
 * ratcheting up forever. Note the large gap means this budget will NOT catch
 * a moderate regression on this route — tighten it if that matters. */
const DEEP_WAVE_BUDGET = 330_000;

interface RouteBudget {
  /** Route path as shown in `next build`'s own output table (for messages only). */
  route: string;
  /** Key into app-build-manifest.json's `pages` map. */
  manifestKey: string;
  budgetBytes: number;
}

/**
 * Manifest keys whose chunks EVERY App Router route also loads.
 *
 * This is not a nicety, it is the difference between measuring the route and
 * measuring part of it. Next emits the root layout's client chunks under
 * `/layout`, never under `/page` — but the browser downloads both on `/`, and
 * `next build`'s own "First Load JS" column counts both. Summing only `/page`
 * therefore under-reports by however much client code lives in
 * app/layout.tsx's subtree, which on this project is the site header and its
 * sound toggle: a gate blind to exactly the place layout-level client code
 * gets added. Unioned (not concatenated) so a chunk listed under both keys is
 * counted once.
 */
const SHARED_MANIFEST_KEYS = ["/layout"];

const ROUTE_BUDGETS: RouteBudget[] = [
  { route: "/", manifestKey: "/page", budgetBytes: HOME_BUDGET },
  { route: "/deep-wave", manifestKey: "/deep-wave/page", budgetBytes: DEEP_WAVE_BUDGET },
];

/**
 * Pure: the route's own chunks unioned with every shared (layout) chunk, in a
 * stable order and with duplicates removed. Exported for unit testing.
 */
export function routeChunks(
  pages: Record<string, string[]>,
  routeKey: string,
  sharedKeys: readonly string[] = SHARED_MANIFEST_KEYS
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of [...sharedKeys, routeKey]) {
    for (const file of pages[key] ?? []) {
      if (seen.has(file)) continue;
      seen.add(file);
      out.push(file);
    }
  }
  return out;
}

interface AppBuildManifest {
  pages: Record<string, string[]>;
  /** Present in the merged CLI input so resolution failures can name every
   * manifest inspected and the keys each one actually contained. */
  sources?: ManifestSource[];
}

interface ManifestSource {
  path: string;
  keys: string[];
}

interface BudgetCheckResult extends RouteBudget {
  measuredBytes: number | null;
  ok: boolean;
  resolvedManifestKey?: string;
  error?: string;
}

/** Pure: gzip-sums every `.js` entry in `files` (each resolved relative to
 * `.next/`). Skips non-JS entries (e.g. `.css`) — Next's "First Load JS" is
 * JS-only. Exported for unit testing. */
export function firstLoadJsBytes(nextDir: string, files: string[]): number {
  let total = 0;
  for (const rel of files) {
    if (!rel.endsWith(".js")) continue;
    const filePath = resolve(nextDir, rel);
    let data: Buffer;
    try {
      data = readFileSync(filePath);
    } catch (err) {
      // Wrapped with the chunk's own relative path + resolved path (design
      // review item E11) — a bare ENOENT only names the resolved path,
      // which doesn't say WHICH manifest entry it came from; `checkBudgets`
      // layers the route/manifest-key context on top of this.
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `check-bundle: failed to read chunk "${rel}" (resolved to ${filePath}): ${detail}. ` +
          `Did app-build-manifest.json list a chunk that's missing from a completed build?`
      );
    }
    total += gzipSync(data, { level: 9 }).length;
  }
  return total;
}

/** Pure: given a parsed app-build-manifest.json and a set of route budgets,
 * returns one result per budgeted route (measured bytes vs its budget) —
 * exported for unit testing without touching the real filesystem. */
export function checkBudgets(
  manifest: AppBuildManifest,
  budgets: RouteBudget[],
  nextDir: string
): BudgetCheckResult[] {
  return budgets.map((budget) => {
    // App Router manifests use the internal `/segment/page` key. The regular
    // build manifest uses the public URL route key. Supporting both keeps the
    // gate stable across Next.js routers and manifest-output changes.
    const candidateKeys = [...new Set([budget.manifestKey, budget.route])];
    // A manifest whose `pages` map is missing entirely (malformed/partial
    // build output) must land in the descriptive-failure branch below, not
    // blow up inside Object.hasOwn.
    const pages = manifest.pages ?? {};
    const resolvedManifestKey = candidateKeys.find((key) => Object.hasOwn(pages, key));

    if (!resolvedManifestKey) {
      const sources = manifest.sources ?? [{ path: "app-build-manifest.json", keys: Object.keys(pages) }];
      const inventory = sources
        .map(({ path, keys }) => {
          const found = keys.length > 0 ? keys.slice().sort().map((key) => `"${key}"`).join(", ") : "(none)";
          return `${path} (found keys: ${found})`;
        })
        .join("; ");

      return {
        ...budget,
        measuredBytes: null,
        ok: false,
        error:
          `check-bundle: cannot resolve budgeted route "${budget.route}"; tried manifest keys ` +
          `${candidateKeys.map((key) => `"${key}"`).join(" and ")}. ` +
          `Inspected ${inventory}. Verify the route's emitted manifest key after a completed build.`,
      };
    }

    // The route's own chunks PLUS the root layout's — see SHARED_MANIFEST_KEYS.
    const files = routeChunks(pages, resolvedManifestKey);

    // A resolved key that lists no JS at all would measure 0 bytes and sail
    // under any budget — a tooling break reported as a green gate, which is
    // exactly as bad as the crash this script used to throw. Fail loudly.
    if (!files.some((rel) => rel.endsWith(".js"))) {
      const listed = files.length > 0 ? files.map((rel) => `"${rel}"`).join(", ") : "(empty)";
      return {
        ...budget,
        measuredBytes: null,
        ok: false,
        resolvedManifestKey,
        error:
          `check-bundle: route "${budget.route}" resolved to manifest key "${resolvedManifestKey}" but that ` +
          `key lists no .js chunks — entries: ${listed}. Measuring it would report 0 bytes and pass every ` +
          `budget, so this is treated as a failure. Verify the route's emitted manifest key after a completed build.`,
      };
    }

    let measuredBytes: number;
    try {
      measuredBytes = firstLoadJsBytes(nextDir, files);
    } catch (err) {
      // Layers route/manifest-key context on top of firstLoadJsBytes' own
      // chunk-level detail (design review item E11).
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ...budget,
        measuredBytes: null,
        ok: false,
        resolvedManifestKey,
        error: `check-bundle: route "${budget.route}" (manifest key "${resolvedManifestKey}"): ${detail}`,
      };
    }
    return {
      ...budget,
      measuredBytes,
      ok: measuredBytes <= budget.budgetBytes,
      resolvedManifestKey,
    };
  });
}

function formatKb(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

/** Reads + parses one Next manifest, naming the offending file in every
 * failure mode (unparseable JSON, or a shape with no `pages` map). Without
 * this the top-level catch reports a bare `JSON.parse` / "Cannot convert
 * undefined" message that doesn't say WHICH manifest was malformed. */
function readManifest(manifestPath: string): AppBuildManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`could not parse ${manifestPath}: ${detail}. Is the build output complete?`);
  }
  const pages = (parsed as AppBuildManifest | null)?.pages;
  if (typeof pages !== "object" || pages === null) {
    throw new Error(
      `${manifestPath} has no "pages" map (found top-level keys: ` +
        `${Object.keys((parsed as object | null) ?? {}).join(", ") || "(none)"}). ` +
        `Next may have changed its manifest shape — update scripts/check-bundle.ts's route mapping.`
    );
  }
  return { pages };
}

function main(): void {
  const nextDir = resolveNextDir();
  const appManifestPath = resolve(nextDir, "app-build-manifest.json");
  const buildManifestPath = resolve(nextDir, "build-manifest.json");

  for (const manifestPath of [appManifestPath, buildManifestPath]) {
    if (!existsSync(manifestPath)) {
      console.error(
        `check-bundle: ${manifestPath} not found — run "bun run build" first.\n` +
          `(This script asserts bundle-size budgets against a completed Next.js build. ` +
          `Set NEXT_DIR to point at a different build output directory.)`
      );
      process.exitCode = 1;
      return;
    }
  }

  const appManifest = readManifest(appManifestPath);
  const buildManifest = readManifest(buildManifestPath);
  const manifest: AppBuildManifest = {
    // Prefer App Router data if the same key is ever emitted by both files.
    pages: { ...buildManifest.pages, ...appManifest.pages },
    sources: [
      { path: appManifestPath, keys: Object.keys(appManifest.pages) },
      { path: buildManifestPath, keys: Object.keys(buildManifest.pages) },
    ],
  };
  const results = checkBudgets(manifest, ROUTE_BUDGETS, nextDir);

  let anyBreach = false;
  for (const result of results) {
    if (result.error || result.measuredBytes === null) {
      console.error(`[check-bundle] FAIL  ${result.route.padEnd(12)} ${result.error}`);
      anyBreach = true;
      continue;
    }
    const status = result.ok ? "PASS" : "FAIL";
    console.log(
      `[check-bundle] ${status}  ${result.route.padEnd(12)} ` +
        `${formatKb(result.measuredBytes).padStart(9)} / ${formatKb(result.budgetBytes)} budget`
    );
    if (!result.ok) anyBreach = true;
  }

  if (anyBreach) {
    console.error(
      "\ncheck-bundle: one or more route budget checks failed.\n" +
        "For an over-budget route, investigate what grew (a new dependency? a scene that didn't route-split?) " +
        "before raising the budget. For a manifest-resolution failure, inspect the listed keys and update the " +
        "route mapping only if Next changed its emitted manifest shape."
    );
    process.exitCode = 1;
    return;
  }

  console.log("\ncheck-bundle: all routes within budget.");
}

// Only run when executed directly (`bun scripts/check-bundle.ts`), not when
// imported by a test for its pure helpers.
if (import.meta.main) {
  try {
    main();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`check-bundle: unable to evaluate bundle budgets: ${detail}`);
    process.exitCode = 1;
  }
}
