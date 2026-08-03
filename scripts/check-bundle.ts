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
// this reads `.next/app-build-manifest.json`, which lists the exact JS
// chunk files (webpack runtime + shared vendor chunks + the page's own
// chunk) a route needs on first load, and gzips each one (Next's own
// reported metric is gzip size, not raw). Empirically this reproduces
// Next's own reported number almost exactly: for this repo's current build,
// summing gzip sizes of `/page`'s listed chunks gives 157954 bytes (Next
// prints "158 kB" for `/`), and `/deep-wave/page`'s gives 304041 bytes
// (Next prints "304 kB" for `/deep-wave`) — both round to Next's own
// terminal output. `.css` entries in the manifest are skipped (Next's
// "First Load JS" is a JS-only metric).

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
/** `/` currently measures ~158 kB gzip (157954 bytes) — headroom to 165 kB
 * so routine dependency bumps don't false-positive, while still catching a
 * real regression (the landing page must stay light; the engine/three.js
 * bundle must never leak into it — see docs/deep-wave-engine-design.md §6
 * "Bundle: engine/three load only on /deep-wave"). */
const HOME_BUDGET = 165_000;
/** `/deep-wave` currently measures ~304 kB gzip (304041 bytes) — this route
 * owns the whole engine/three.js/postprocessing payload, so its budget is
 * intentionally much larger; headroom to 330 kB covers the remaining M2/M3
 * scene work (splats, MSDF text) without silently ratcheting up forever. */
const DEEP_WAVE_BUDGET = 330_000;

interface RouteBudget {
  /** Route path as shown in `next build`'s own output table (for messages only). */
  route: string;
  /** Key into app-build-manifest.json's `pages` map. */
  manifestKey: string;
  budgetBytes: number;
}

const ROUTE_BUDGETS: RouteBudget[] = [
  { route: "/", manifestKey: "/page", budgetBytes: HOME_BUDGET },
  { route: "/deep-wave", manifestKey: "/deep-wave/page", budgetBytes: DEEP_WAVE_BUDGET },
];

interface AppBuildManifest {
  pages: Record<string, string[]>;
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
): Array<RouteBudget & { measuredBytes: number; ok: boolean }> {
  return budgets.map((budget) => {
    const files = manifest.pages[budget.manifestKey];
    if (!files) {
      throw new Error(
        `check-bundle: app-build-manifest.json has no entry for "${budget.manifestKey}" ` +
          `(route "${budget.route}"). Did the route get renamed/removed, or did the build fail?`
      );
    }
    let measuredBytes: number;
    try {
      measuredBytes = firstLoadJsBytes(nextDir, files);
    } catch (err) {
      // Layers route/manifest-key context on top of firstLoadJsBytes' own
      // chunk-level detail (design review item E11).
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`check-bundle: route "${budget.route}" (manifest key "${budget.manifestKey}"): ${detail}`);
    }
    return { ...budget, measuredBytes, ok: measuredBytes <= budget.budgetBytes };
  });
}

function formatKb(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

function main(): void {
  const nextDir = resolveNextDir();
  const manifestPath = resolve(nextDir, "app-build-manifest.json");

  if (!existsSync(manifestPath)) {
    console.error(
      `check-bundle: ${manifestPath} not found — run "bun run build" first.\n` +
        `(This script asserts bundle-size budgets against a completed Next.js build. ` +
        `Set NEXT_DIR to point at a different build output directory.)`
    );
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AppBuildManifest;
  const results = checkBudgets(manifest, ROUTE_BUDGETS, nextDir);

  let anyBreach = false;
  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    console.log(
      `[check-bundle] ${status}  ${result.route.padEnd(12)} ` +
        `${formatKb(result.measuredBytes).padStart(9)} / ${formatKb(result.budgetBytes)} budget`
    );
    if (!result.ok) anyBreach = true;
  }

  if (anyBreach) {
    console.error(
      "\ncheck-bundle: one or more routes exceeded their First Load JS budget.\n" +
        "Investigate what grew (a new dependency? a scene that didn't route-split?) before " +
        "raising the budget constant in scripts/check-bundle.ts — it exists to catch exactly this."
    );
    process.exit(1);
  }

  console.log("\ncheck-bundle: all routes within budget.");
}

// Only run when executed directly (`bun scripts/check-bundle.ts`), not when
// imported by a test for its pure helpers.
if (import.meta.main) {
  main();
}
