// test/scripts/gen-msdf.test.ts
//
// scripts/gen-msdf.ts's pure exported helpers: `sanitizeErrorText` (strips
// this machine's absolute repo path/home directory out of error text before
// it's ever written to a committed file — design review item C1's PII fix)
// and `isNativeToolchainFailure` (categorizes a genuine msdfgen/native
// failure, safe to fall back from, vs. a font/config bug that must fail
// loudly instead). Both are exercised directly rather than through `main()`
// (a process-exiting CLI entry point, like scripts/check-bundle.ts's own
// `main()` — only its pure helpers are unit-tested there too).

import { describe, expect, it } from "vitest";
import { isNativeToolchainFailure, sanitizeErrorText } from "@/scripts/gen-msdf";

describe("sanitizeErrorText", () => {
  const REPO_ROOT = "/Users/aaronlin/Downloads/Projects/Frontend";

  it("replaces the exact repo root with <repo>", () => {
    const text = `Error at ${REPO_ROOT}/scripts/gen-msdf.ts:85:5`;
    expect(sanitizeErrorText(text, REPO_ROOT)).toBe("Error at <repo>/scripts/gen-msdf.ts:85:5");
    expect(sanitizeErrorText(text, REPO_ROOT)).not.toContain(REPO_ROOT);
  });

  it("replaces any other /Users/<name> path (not just the exact repo root) with ~", () => {
    const text = "at Module._load (/Users/someoneelse/node_modules/foo/index.js:1:1)";
    const out = sanitizeErrorText(text, REPO_ROOT);
    expect(out).not.toMatch(/\/Users\/[^/\s]+/);
    expect(out).toContain("~/node_modules/foo/index.js:1:1");
  });

  it("replaces any /home/<name> path with ~ (Linux CI images)", () => {
    const text = "at /home/runner/work/repo/node_modules/x/index.js:1:1";
    const out = sanitizeErrorText(text, REPO_ROOT);
    expect(out).not.toMatch(/\/home\/[^/\s]+/);
  });

  it("leaves text with no machine-specific paths unchanged", () => {
    const text = "TypeError: undefined is not an object (evaluating 'font.outlinesFormat')";
    expect(sanitizeErrorText(text, REPO_ROOT)).toBe(text);
  });

  it("handles an empty repoRoot without throwing (defensive — never expected in practice)", () => {
    expect(() => sanitizeErrorText("some text", "")).not.toThrow();
  });
});

describe("isNativeToolchainFailure", () => {
  it("classifies ENOENT/spawn/EACCES child-process errors as native-toolchain failures", () => {
    expect(isNativeToolchainFailure(new Error("spawn msdfgen ENOENT"))).toBe(true);
    expect(isNativeToolchainFailure(new Error("EACCES: permission denied, open 'msdfgen'"))).toBe(true);
    expect(isNativeToolchainFailure(new Error("Command failed: msdfgen exited with code 127"))).toBe(true);
  });

  it("classifies an explicit msdfgen mention as a native-toolchain failure", () => {
    expect(isNativeToolchainFailure(new Error("msdfgen: native binary not found for this platform"))).toBe(true);
  });

  it("classifies a font/config bug (no toolchain signature) as NOT a native-toolchain failure", () => {
    // The real error this repo hit before this fix (see docs/msdf-fallback.md's
    // history) — a bug in msdf-bmfont-xml's font parsing, not the msdfgen
    // binary itself. Must NOT be treated as safe-to-fall-back-from.
    expect(
      isNativeToolchainFailure(new TypeError("undefined is not an object (evaluating 'font.outlinesFormat')"))
    ).toBe(false);
  });

  it("handles a non-Error thrown value", () => {
    expect(isNativeToolchainFailure("spawn msdfgen ENOENT")).toBe(true);
    expect(isNativeToolchainFailure("some other string")).toBe(false);
  });
});
