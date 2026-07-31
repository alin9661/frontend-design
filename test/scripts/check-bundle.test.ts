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
import { checkBudgets, firstLoadJsBytes } from "@/scripts/check-bundle";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

describe("firstLoadJsBytes", () => {
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

describe("checkBudgets", () => {
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

  it("throws a clear error when the manifest has no entry for a budgeted route", () => {
    const manifest = { pages: {} };
    expect(() =>
      checkBudgets(manifest, [{ route: "/", manifestKey: "/page", budgetBytes: 1_000_000 }], dir)
    ).toThrow(/no entry for "\/page"/);
  });

  it("design review item E11: wraps a missing chunk's read failure with route/manifest-key context on top of the chunk-level detail", () => {
    const manifest = { pages: { "/page": ["does-not-exist.js"] } };
    expect(() =>
      checkBudgets(manifest, [{ route: "/", manifestKey: "/page", budgetBytes: 1_000_000 }], dir)
    ).toThrow(/route "\/"[\s\S]*manifest key "\/page"[\s\S]*does-not-exist\.js/);
  });
});

describe("firstLoadJsBytes — missing-chunk ENOENT context (design review item E11)", () => {
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

describe("check-bundle.ts CLI — subprocess against a fixture .next dir via NEXT_DIR (design review item E11)", () => {
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
    expect(result.stderr).toContain("exceeded their First Load JS budget");
  });
});
