// test/scripts/check-bundle.test.ts
//
// scripts/check-bundle.ts's pure helpers: `firstLoadJsBytes` (gzip-sums a
// manifest's listed JS chunk files, skipping non-JS entries) and
// `checkBudgets` (measures each budgeted route against its budget). Both
// are exercised against real temp files on disk (gzip is a real
// byte-for-byte codec, not worth mocking) instead of a real `.next` build —
// that's what proves the CI wiring works; see this file's header comment
// for the numbers measured against a real build.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBudgets, firstLoadJsBytes, routeChunks } from "@/scripts/check-bundle";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

describe("scripts/check-bundle.ts > firstLoadJsBytes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "check-bundle-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("sums the gzip size of every listed .js file", () => {
    const a = "a".repeat(1000); // highly compressible — gzip shrinks it a lot
    const b = "b".repeat(2000);
    writeFileSync(join(dir, "a.js"), a);
    writeFileSync(join(dir, "b.js"), b);

    const expected = gzipSync(Buffer.from(a), { level: 9 }).length + gzipSync(Buffer.from(b), { level: 9 }).length;
    expect(firstLoadJsBytes(dir, ["a.js", "b.js"])).toBe(expected);
  });

  it("skips non-.js entries (e.g. .css) — Next's First Load JS is JS-only", () => {
    const js = "console.log(1);".repeat(50);
    const css = ".foo{color:red}".repeat(50);
    writeFileSync(join(dir, "styles.css"), css);
    writeFileSync(join(dir, "app.js"), js);

    const jsOnly = firstLoadJsBytes(dir, ["app.js"]);
    const withCss = firstLoadJsBytes(dir, ["styles.css", "app.js"]);
    expect(withCss).toBe(jsOnly); // css contributed nothing
  });

  it("returns 0 for an empty file list", () => {
    expect(firstLoadJsBytes(dir, [])).toBe(0);
  });

  it("resolves each path relative to the given directory", () => {
    writeFileSync(join(dir, "nested.js"), "x".repeat(500));
    expect(firstLoadJsBytes(dir, ["nested.js"])).toBeGreaterThan(0);
  });
});

describe("scripts/check-bundle.ts > routeChunks (the root layout's chunks are part of the route)", () => {
  it("unions the shared layout chunks with the route's own, layout first", () => {
    // Next emits the root layout's client chunks ONLY under `/layout`, never
    // under `/page` — but the browser downloads both on the same navigation,
    // and `next build`'s own First Load JS column counts both. Summing just
    // the route key under-reports by exactly the amount of client code that
    // lives in app/layout.tsx's subtree, which is where this project's site
    // header and sound toggle are.
    const pages = {
      "/layout": ["static/chunks/200.js", "static/chunks/app/layout.js"],
      "/page": ["static/chunks/app/page.js"],
    };

    expect(routeChunks(pages, "/page")).toEqual([
      "static/chunks/200.js",
      "static/chunks/app/layout.js",
      "static/chunks/app/page.js",
    ]);
  });

  it("counts a chunk listed under both keys exactly once", () => {
    const shared = "static/chunks/framework.js";
    const pages = {
      "/layout": [shared, "static/chunks/app/layout.js"],
      "/page": [shared, "static/chunks/app/page.js"],
    };

    const chunks = routeChunks(pages, "/page");
    expect(chunks.filter((file) => file === shared)).toHaveLength(1);
    expect(chunks).toHaveLength(3);
  });

  it("still measures a route whose manifest has no layout key at all", () => {
    expect(routeChunks({ "/page": ["a.js"] }, "/page")).toEqual(["a.js"]);
    expect(routeChunks({}, "/page")).toEqual([]);
  });

  it("measures MORE than the route key alone whenever the layout owns chunks", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-bundle-layout-"));
    try {
      writeFileSync(join(dir, "page.js"), "p".repeat(4000));
      writeFileSync(join(dir, "layout.js"), Array.from({ length: 400 }, () => Math.random().toString(36)).join(""));
      const manifest = { pages: { "/layout": ["layout.js"], "/page": ["page.js"] } };

      const [result] = checkBudgets(
        manifest,
        [{ route: "/", manifestKey: "/page", budgetBytes: 1_000_000 }],
        dir,
      );

      // The regression: the gate reported only `page.js` and stayed green
      // while the layout grew without limit.
      expect(result!.measuredBytes).toBeGreaterThan(firstLoadJsBytes(dir, ["page.js"]));
      expect(result!.measuredBytes).toBe(firstLoadJsBytes(dir, ["layout.js", "page.js"]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scripts/check-bundle.ts > checkBudgets", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "check-bundle-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports ok:true when measured bytes are within budget", () => {
    writeFileSync(join(dir, "home.js"), "x".repeat(100));
    const manifest = { pages: { "/page": ["home.js"] } };
    const [result] = checkBudgets(manifest, [{ route: "/", manifestKey: "/page", budgetBytes: 1_000_000 }], dir);

    expect(result!.ok).toBe(true);
    expect(result!.measuredBytes).toBeGreaterThan(0);
    expect(result!.measuredBytes).toBeLessThanOrEqual(1_000_000);
  });

  it("reports ok:false when measured bytes exceed the budget (regression detection)", () => {
    // Highly incompressible (random-ish) content so gzip can't shrink it
    // below a tiny budget — a real bundle-size regression would look like
    // this: measured > budget.
    const random = Array.from({ length: 5000 }, () => Math.random().toString(36)).join("");
    writeFileSync(join(dir, "home.js"), random);
    const manifest = { pages: { "/page": ["home.js"] } };
    const [result] = checkBudgets(manifest, [{ route: "/", manifestKey: "/page", budgetBytes: 10 }], dir);

    expect(result!.ok).toBe(false);
    expect(result!.measuredBytes).toBeGreaterThan(10);
    expect(result!.budgetBytes).toBe(10);
  });

  it("checks every budgeted route independently in one call", () => {
    writeFileSync(join(dir, "home.js"), "x".repeat(100));
    writeFileSync(join(dir, "deep-wave.js"), "y".repeat(100));
    const manifest = { pages: { "/page": ["home.js"], "/deep-wave/page": ["deep-wave.js"] } };

    const results = checkBudgets(
      manifest,
      [
        { route: "/", manifestKey: "/page", budgetBytes: 1_000_000 },
        { route: "/deep-wave", manifestKey: "/deep-wave/page", budgetBytes: 1_000_000 },
      ],
      dir
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.route).toBe("/");
    expect(results[1]!.route).toBe("/deep-wave");
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("returns a descriptive failure with manifest paths and found keys when a budgeted route is absent", () => {
    const manifest = {
      pages: { "/layout": ["layout.js"], "/_app": ["app.js"] },
      sources: [
        { path: "/fixture/.next/app-build-manifest.json", keys: ["/layout"] },
        { path: "/fixture/.next/build-manifest.json", keys: ["/_app"] },
      ],
    };

    const [result] = checkBudgets(
      manifest,
      [{ route: "/deep-wave", manifestKey: "/deep-wave/page", budgetBytes: 1_000_000 }],
      dir
    );

    expect(result!.ok).toBe(false);
    expect(result!.measuredBytes).toBeNull();
    expect(result!.error).toContain("/fixture/.next/app-build-manifest.json");
    expect(result!.error).toContain("/fixture/.next/build-manifest.json");
    expect(result!.error).toContain('found keys: "/layout"');
    expect(result!.error).toContain('found keys: "/_app"');
  });

  it("resolves the URL-route key emitted by build-manifest.json as an alternative manifest shape", () => {
    writeFileSync(join(dir, "deep-wave.js"), "x".repeat(100));
    const manifest = {
      pages: { "/deep-wave": ["deep-wave.js"] },
      sources: [{ path: "/fixture/.next/build-manifest.json", keys: ["/deep-wave"] }],
    };

    const [result] = checkBudgets(
      manifest,
      [{ route: "/deep-wave", manifestKey: "/deep-wave/page", budgetBytes: 1_000_000 }],
      dir
    );

    expect(result!.ok).toBe(true);
    expect(result!.resolvedManifestKey).toBe("/deep-wave");
    expect(result!.measuredBytes).toBeGreaterThan(0);
  });

  it("fails (rather than silently passing at 0 bytes) when the resolved key lists no .js chunks", () => {
    // A manifest shape change that leaves a route key present but empty
    // would measure 0 bytes and sail under every budget — a tooling break
    // reported as a green gate.
    const manifest = { pages: { "/deep-wave/page": [] } };

    const [result] = checkBudgets(
      manifest,
      [{ route: "/deep-wave", manifestKey: "/deep-wave/page", budgetBytes: 1_000_000 }],
      dir
    );

    expect(result!.ok).toBe(false);
    expect(result!.measuredBytes).toBeNull();
    expect(result!.error).toContain("lists no .js chunks");
    expect(result!.error).toContain("(empty)");
  });

  it("does not let shared layout chunks mask an empty route key", () => {
    writeFileSync(join(dir, "layout.js"), "shared layout code");
    const manifest = { pages: { "/layout": ["layout.js"], "/page": [] } };

    const [result] = checkBudgets(
      manifest,
      [{ route: "/", manifestKey: "/page", budgetBytes: 1_000_000 }],
      dir,
    );

    expect(result!.ok).toBe(false);
    expect(result!.measuredBytes).toBeNull();
    expect(result!.error).toContain("lists no .js chunks");
    expect(result!.error).toContain("(empty)");
  });

  it("fails when the resolved key lists only non-JS entries (css-only), naming what it did list", () => {
    const manifest = { pages: { "/page": ["static/css/app.css"] } };

    const [result] = checkBudgets(manifest, [{ route: "/", manifestKey: "/page", budgetBytes: 1_000_000 }], dir);

    expect(result!.ok).toBe(false);
    expect(result!.measuredBytes).toBeNull();
    expect(result!.error).toContain("static/css/app.css");
  });

  it("still measures normally when the resolved key mixes .css with real .js chunks", () => {
    writeFileSync(join(dir, "home.js"), "x".repeat(100));
    const manifest = { pages: { "/page": ["static/css/app.css", "home.js"] } };

    const [result] = checkBudgets(manifest, [{ route: "/", manifestKey: "/page", budgetBytes: 1_000_000 }], dir);

    expect(result!.ok).toBe(true);
    expect(result!.measuredBytes).toBeGreaterThan(0);
  });

  it("reports a descriptive failure instead of throwing when the manifest has no pages map at all", () => {
    // Malformed/partial build output: `pages` absent entirely. The old
    // lookup would blow up; the gate must still name what it inspected.
    const manifest = { pages: undefined as unknown as Record<string, string[]> };

    const [result] = checkBudgets(manifest, [{ route: "/", manifestKey: "/page", budgetBytes: 1_000_000 }], dir);

    expect(result!.ok).toBe(false);
    expect(result!.measuredBytes).toBeNull();
    expect(result!.error).toContain('cannot resolve budgeted route "/"');
    expect(result!.error).toContain("found keys: (none)");
  });

  it("design review item E11: reports a missing chunk with route/manifest-key context on top of the chunk-level detail", () => {
    const manifest = { pages: { "/page": ["does-not-exist.js"] } };
    const [result] = checkBudgets(
      manifest,
      [{ route: "/", manifestKey: "/page", budgetBytes: 1_000_000 }],
      dir
    );

    expect(result!.ok).toBe(false);
    expect(result!.error).toMatch(/route "\/"[\s\S]*manifest key "\/page"[\s\S]*does-not-exist\.js/);
  });
});

describe("scripts/check-bundle.ts > firstLoadJsBytes missing-chunk context", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "check-bundle-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("wraps a missing chunk's read failure with the chunk's own relative path (not just a bare ENOENT)", () => {
    expect(() => firstLoadJsBytes(dir, ["missing-chunk.js"])).toThrow(/missing-chunk\.js/);
  });

  it("still reports real chunks correctly alongside a later missing one (fails on the missing one, not silently)", () => {
    writeFileSync(join(dir, "real.js"), "x".repeat(100));
    expect(() => firstLoadJsBytes(dir, ["real.js", "missing.js"])).toThrow(/missing\.js/);
  });
});

describe("scripts/check-bundle.ts > CLI subprocess via NEXT_DIR", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "check-bundle-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeManifest(homeFiles: string[], deepWaveFiles: string[]): void {
    writeFileSync(
      join(dir, "app-build-manifest.json"),
      JSON.stringify({ pages: { "/page": homeFiles, "/deep-wave/page": deepWaveFiles } })
    );
    writeFileSync(join(dir, "build-manifest.json"), JSON.stringify({ pages: { "/_app": [] } }));
  }

  function runCli(): { exitCode: number | null; stdout: string; stderr: string } {
    // node:child_process, not Bun.spawnSync — the latter's global isn't
    // available inside this project's vitest test context even though the
    // suite itself runs under `bunx vitest` (verified empirically); spawning
    // the real `bun scripts/check-bundle.ts` CLI as a subprocess is the part
    // that matters here, not which spawn API does it.
    const result = spawnSync("bun", ["scripts/check-bundle.ts"], {
      cwd: REPO_ROOT,
      env: { ...process.env, NEXT_DIR: dir },
      encoding: "utf8",
    });
    return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it("exits 0 when every route is within its budget (real CLI process, NEXT_DIR override)", () => {
    writeFileSync(join(dir, "home.js"), "x".repeat(100));
    writeFileSync(join(dir, "deep-wave.js"), "y".repeat(100));
    writeManifest(["home.js"], ["deep-wave.js"]);

    const result = runCli();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("all routes within budget");
  });

  it("exits 1 when a route breaches its budget (real CLI process, NEXT_DIR override)", () => {
    // True random bytes are essentially incompressible — gzip can't shrink
    // 300KB of these below the 165KB home-route budget, unlike the base36
    // text tricks used elsewhere in this file for much smaller budgets.
    writeFileSync(join(dir, "home.js"), randomBytes(300_000));
    writeFileSync(join(dir, "deep-wave.js"), "y".repeat(100));
    writeManifest(["home.js"], ["deep-wave.js"]);

    const result = runCli();

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/FAIL\s+\/\s+300\.1 kB \/ 165\.0 kB budget/);
    expect(result.stderr).toContain("one or more route budget checks failed");
  });

  it("reports all resolvable routes plus an actionable failure when one route key is absent", () => {
    writeFileSync(join(dir, "home.js"), "x".repeat(100));
    writeFileSync(
      join(dir, "app-build-manifest.json"),
      JSON.stringify({ pages: { "/layout": [], "/page": ["home.js"] } })
    );
    writeFileSync(join(dir, "build-manifest.json"), JSON.stringify({ pages: { "/_app": [] } }));

    const result = runCli();

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/PASS\s+\//);
    expect(result.stderr).toContain("[check-bundle] FAIL  /deep-wave");
    expect(result.stderr).toContain(join(dir, "app-build-manifest.json"));
    expect(result.stderr).toContain('found keys: "/layout", "/page"');
    expect(result.stderr).toContain(join(dir, "build-manifest.json"));
    expect(result.stderr).toContain('found keys: "/_app"');
    expect(result.stderr).not.toContain("at checkBudgets");
  });

  it("names the offending manifest when its JSON is unparseable, instead of a bare parse stack", () => {
    writeFileSync(join(dir, "app-build-manifest.json"), "{ not json");
    writeFileSync(join(dir, "build-manifest.json"), JSON.stringify({ pages: { "/_app": [] } }));

    const result = runCli();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("could not parse");
    expect(result.stderr).toContain(join(dir, "app-build-manifest.json"));
  });

  it("names the offending manifest when it parses but carries no pages map", () => {
    writeFileSync(join(dir, "app-build-manifest.json"), JSON.stringify({ pages: { "/page": [] } }));
    writeFileSync(join(dir, "build-manifest.json"), JSON.stringify({ rootMainFiles: [] }));

    const result = runCli();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('has no "pages" map');
    expect(result.stderr).toContain(join(dir, "build-manifest.json"));
    expect(result.stderr).toContain("rootMainFiles");
  });
});
