// scripts/gen-msdf.ts
//
// Build-time MSDF atlas generation for the Deep Wave engine's WebGL text
// (docs/deep-wave-engine-design.md §4C). Runs msdf-bmfont-xml over the
// committed Anton TTF and writes public/msdf/anton.png + anton.json.
//
// Run with: bunx tsx scripts/gen-msdf.ts   (or: bun run scripts/gen-msdf.ts)
//
// Failure handling (design review item C1) distinguishes two very different
// situations instead of treating every thrown error as "safe to fall back
// from":
//   - A genuine msdfgen/native-toolchain failure (the binary is missing,
//     can't spawn, or crashes for environment reasons) is NOT this script's
//     fault and not blocking: it writes docs/msdf-fallback.md documenting
//     the runtime tiny-sdf path from §4C and exits 0.
//   - Anything else (a malformed font, a bad option) is almost certainly a
//     real bug in this script's own inputs and must not be silently
//     swallowed into a fallback doc — it exits non-zero with a clear
//     message instead.
// Whatever error text does get written out (to the fallback doc or stderr)
// is sanitized first (see `sanitizeErrorText`) — a full stack trace can
// contain this machine's absolute repo path and OS username, neither of
// which belongs in a file this repo may commit.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// msdf-bmfont-xml ships no type declarations — see the local shim in
// scripts/msdf-bmfont-xml.d.ts.
import generateBMFont from "msdf-bmfont-xml";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const FONT_PATH = resolve(ROOT, "assets/fonts/Anton-Regular.ttf");
const OUT_DIR = resolve(ROOT, "public/msdf");
const OUT_BASENAME = "anton";
/** Moved out of public/ (design review item C2) — a generated fallback doc
 * has no reason to ship to users, and its old location made it easy to
 * forget it was even there. */
const FALLBACK_DOC_PATH = resolve(ROOT, "docs/msdf-fallback.md");

// A-Z 0-9 . , ' * ! ? - : / space — everything the copy in §5 needs
// (headline, section titles, flavor names, gag stats).
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,'*!?-:/ ";

const MAX_ATTEMPTS = 2;

interface GenerateResult {
  textures: Array<{ filename: string; texture: Buffer }>;
  font: { filename: string; data: string };
}

/**
 * Pure: strips this machine's absolute repo root and home directory (plus a
 * catch-all for any other `/Users/<name>`/`/home/<name>` path) out of a
 * string before it's ever written to a committed file (design review item
 * C1 — the pre-fix fallback doc committed a full stack trace containing
 * `/Users/<real-name>/...` verbatim). Exported for unit testing.
 */
export function sanitizeErrorText(text: string, repoRoot: string): string {
  let out = repoRoot ? text.split(repoRoot).join("<repo>") : text;
  const home = homedir();
  if (home) out = out.split(home).join("~");
  out = out.replace(/\/Users\/[^/\s]+/g, "~").replace(/\/home\/[^/\s]+/g, "~");
  return out;
}

/**
 * Pure: distinguishes a genuine native-toolchain failure (msdfgen binary
 * missing/crashing — safe to fall back from) from a font/config problem (a
 * bug in OUR inputs, which must fail loudly instead of silently shipping a
 * broken/fallback atlas). msdf-bmfont-xml's native failures surface as
 * child-process errors (ENOENT/spawn/EACCES) or explicit "msdfgen"
 * mentions; anything else — e.g. a malformed font file tripping an internal
 * null-deref like `font.outlinesFormat` — is treated as a hard failure
 * (design review item C1, CodeRabbit). Exported for unit testing.
 */
export function isNativeToolchainFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /msdfgen|ENOENT|EACCES|spawn|native binary|exited with code/i.test(message);
}

function writeFallbackDoc(reason: string): void {
  mkdirSync(dirname(FALLBACK_DOC_PATH), { recursive: true });
  const doc = `# MSDF atlas fallback

The build-time MSDF atlas generation (\`scripts/gen-msdf.ts\`, via
\`msdf-bmfont-xml\`'s native \`msdfgen\` binary) failed on this machine after
${MAX_ATTEMPTS} attempts:

\`\`\`
${reason}
\`\`\`

## What this means

\`public/msdf/anton.png\` and \`public/msdf/anton.json\` were NOT generated.
This does not block the build or the \`/deep-wave\` route.

## Runtime fallback (design doc §4C)

\`lib/engine/gl/text/\` supports a \`mode: "sdf"\` atlas built entirely
in-browser at runtime, as an \`AssetManager\` job:

1. Rasterize each glyph to a Canvas2D bitmap (alpha channel only).
2. Run a single-channel distance transform (tiny-sdf-style: 8-point signed
   distance sweep) over the alpha bitmap to produce a per-glyph SDF tile.
3. Pack tiles into a canvas atlas texture, uploaded once as a THREE.Texture.
4. \`MsdfText\`'s fragment shader branches on \`mode\`: multi-channel MSDF uses
   \`median(r, g, b)\`; single-channel runtime SDF uses \`r\` directly. Both
   paths use the same \`fwidth\`-based anti-aliasing and glow/outline
   uniforms — only the distance-sample expression differs.

This keeps text crisp at the 3x zoom bar from §7 even without the msdfgen
toolchain, at the cost of a runtime rasterization pass instead of a
build-time one.

## Retrying MSDF generation

\`msdfgen\` needs a working native binary for this platform. Common fixes:
reinstall \`msdf-bmfont-xml\` (\`bun add -d msdf-bmfont-xml\`), or generate the
atlas on a machine/CI image with the required shared libraries and commit
the resulting \`anton.png\`/\`anton.json\` here.
`;
  writeFileSync(FALLBACK_DOC_PATH, doc, "utf8");
  console.warn(
    `[gen-msdf] msdfgen failed after ${MAX_ATTEMPTS} attempts — wrote docs/msdf-fallback.md documenting the runtime tiny-sdf path. Not blocking the build.`
  );
}

function attemptGenerate(): Promise<GenerateResult> {
  return new Promise((resolvePromise, reject) => {
    generateBMFont(
      FONT_PATH,
      {
        charset: CHARSET,
        fontSize: 64,
        textureSize: [512, 512],
        distanceRange: 4,
        fieldType: "msdf",
        outputType: "json",
        smartSize: true,
        filename: OUT_BASENAME,
      },
      (err: Error | null, textures: Array<{ filename: string; texture: Buffer }>, font: { filename: string; data: string }) => {
        if (err) {
          reject(err);
          return;
        }
        resolvePromise({ textures, font });
      }
    );
  });
}

async function main(): Promise<void> {
  if (!existsSync(FONT_PATH)) {
    console.error(`[gen-msdf] font not found at ${FONT_PATH} — expected the committed Anton-Regular.ttf`);
    process.exit(1);
  }
  const fontSize = statSync(FONT_PATH).size;
  if (fontSize < 50 * 1024) {
    console.error(`[gen-msdf] ${FONT_PATH} is suspiciously small (${fontSize} bytes) — refusing to proceed`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`[gen-msdf] attempt ${attempt}/${MAX_ATTEMPTS}: running msdf-bmfont-xml...`);
      const { textures, font } = await attemptGenerate();

      // gl/text/'s MsdfText only supports a single-page atlas today — a
      // charset that no longer fits in one page at the configured
      // textureSize would otherwise silently overwrite earlier pages when
      // they all wrote to the same anton.png (design review item E8).
      if (textures.length !== 1) {
        throw new Error(
          `expected exactly 1 atlas page, got ${textures.length} — the charset no longer fits in a single ` +
            `texture at the configured textureSize. Bump textureSize in scripts/gen-msdf.ts's attemptGenerate() ` +
            `options (gl/text/ only supports a single-page atlas today).`
        );
      }
      const [tex] = textures;
      writeFileSync(resolve(OUT_DIR, tex!.filename), tex!.texture);
      writeFileSync(resolve(OUT_DIR, `${OUT_BASENAME}.json`), font.data, "utf8");

      console.log(`[gen-msdf] wrote public/msdf/${tex!.filename} + public/msdf/${OUT_BASENAME}.json`);
      return;
    } catch (err) {
      lastError = err;
      const sanitized = sanitizeErrorText(err instanceof Error ? err.message : String(err), ROOT);

      if (!isNativeToolchainFailure(err)) {
        // Not a native-toolchain problem — almost certainly a bug in this
        // script's own inputs (a malformed font, a bad option). Fail loudly
        // instead of retrying or silently falling back (design review item
        // C1, CodeRabbit).
        console.error(`[gen-msdf] non-toolchain failure, not retrying: ${sanitized}`);
        process.exit(1);
      }

      console.warn(`[gen-msdf] attempt ${attempt} failed: ${sanitized}`);
    }
  }

  const sanitizedReason = sanitizeErrorText(
    lastError instanceof Error ? (lastError.stack ?? lastError.message) : String(lastError),
    ROOT
  );
  writeFallbackDoc(sanitizedReason);
  // Non-blocking: exit 0 so this never fails the build/CI.
  process.exit(0);
}

// Only run when executed directly (`bunx tsx scripts/gen-msdf.ts`), not when
// imported by a test for its pure helpers (see test/scripts/gen-msdf.test.ts).
if (import.meta.main) {
  main();
}
