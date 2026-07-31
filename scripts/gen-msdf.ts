// scripts/gen-msdf.ts
//
// Build-time MSDF atlas generation for the Deep Wave engine's WebGL text
// (docs/deep-wave-engine-design.md §4C). Runs msdf-bmfont-xml over the
// committed Anton TTF and writes public/msdf/anton.png + anton.json.
//
// Run with: bunx tsx scripts/gen-msdf.ts   (or: bun run scripts/gen-msdf.ts)
//
// If the msdfgen native binary fails on this machine (common on some
// sandboxes/CI images without the right shared libs), this script does NOT
// block the build: it writes public/msdf/FALLBACK.md documenting the
// runtime tiny-sdf path from §4C and exits 0 with a clear message. Prefer
// MSDF when it works; the engine ships whichever mode succeeded.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
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

// A-Z 0-9 . , ' * ! ? - : / space — everything the copy in §5 needs
// (headline, section titles, flavor names, gag stats).
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,'*!?-:/ ";

const MAX_ATTEMPTS = 2;

interface GenerateResult {
  textures: Array<{ filename: string; texture: Buffer }>;
  font: { filename: string; data: string };
}

function writeFallbackDoc(reason: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
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
  writeFileSync(resolve(OUT_DIR, "FALLBACK.md"), doc, "utf8");
  console.warn(
    `[gen-msdf] msdfgen failed after ${MAX_ATTEMPTS} attempts — wrote public/msdf/FALLBACK.md documenting the runtime tiny-sdf path. Not blocking the build.`
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

      for (const tex of textures) {
        const outPath = resolve(OUT_DIR, `${OUT_BASENAME}.png`);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, tex.texture);
      }
      writeFileSync(resolve(OUT_DIR, `${OUT_BASENAME}.json`), font.data, "utf8");

      console.log(
        `[gen-msdf] wrote public/msdf/${OUT_BASENAME}.png + public/msdf/${OUT_BASENAME}.json`
      );
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[gen-msdf] attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  writeFallbackDoc(lastError instanceof Error ? (lastError.stack ?? lastError.message) : String(lastError));
  // Non-blocking: exit 0 so this never fails the build/CI.
  process.exit(0);
}

main();
