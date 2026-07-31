# MSDF atlas fallback

The build-time MSDF atlas generation (`scripts/gen-msdf.ts`, via
`msdf-bmfont-xml`'s native `msdfgen` binary) has failed on this machine —
`msdf-bmfont-xml`'s bundled `msdfgen` binary does not run in this
environment.

## What this means

`public/msdf/anton.png` and `public/msdf/anton.json` were NOT generated.
This does not block the build or the `/deep-wave` route.

## Runtime fallback (design doc §4C)

`lib/engine/gl/text/` supports a `mode: "sdf"` atlas built entirely
in-browser at runtime, as an `AssetManager` job:

1. Rasterize each glyph to a Canvas2D bitmap (alpha channel only).
2. Run a single-channel distance transform (tiny-sdf-style: 8-point signed
   distance sweep) over the alpha bitmap to produce a per-glyph SDF tile.
3. Pack tiles into a canvas atlas texture, uploaded once as a THREE.Texture.
4. `MsdfText`'s fragment shader branches on `mode`: multi-channel MSDF uses
   `median(r, g, b)`; single-channel runtime SDF uses `r` directly. Both
   paths use the same `fwidth`-based anti-aliasing and glow/outline
   uniforms — only the distance-sample expression differs.

This keeps text crisp at the 3x zoom bar from §7 even without the msdfgen
toolchain, at the cost of a runtime rasterization pass instead of a
build-time one.

## Retrying MSDF generation

`msdfgen` needs a working native binary for this platform. Common fixes:
reinstall `msdf-bmfont-xml` (`bun add -d msdf-bmfont-xml`), or generate the
atlas on a machine/CI image with the required shared libraries and commit
the resulting `anton.png`/`anton.json` here. Run `bun run scripts/gen-msdf.ts`
to retry; a genuine font/config bug now exits non-zero instead of silently
falling back (see `isNativeToolchainFailure` in that script).
