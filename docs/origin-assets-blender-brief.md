# Origin film — Blender authoring brief (`public/origin-assets.glb`)

The origin film's **hand** and **machine** can be authored in Blender and loaded
at runtime. Everything else in the film stays procedural: the leaves, the brew
shader, the basket, the carton, the shelf, and the can are all generated in code
(`lib/scenes/origin-film/rig.ts`, `lib/scenes/hero-can/can-geometry.ts`), and the
can in particular *must* stay procedural because it is parameterised across all
five flavors in `lib/flavors.ts` with runtime label textures.

**This file is not committed and the site does not require it.** When
`public/origin-assets.glb` is absent — which is the state of the repo today — the
film renders `buildHand()` and `buildMachine()` from `rig.ts` and nothing logs an
error. Adding the file upgrades those two objects in place; deleting it again
reverts cleanly. That is deliberate: the repo must build and run for anyone who
does not have the binaries.

## What the loader expects

| Requirement | Value |
|---|---|
| File name | `origin-assets.glb` in `public/` (served at `/origin-assets.glb`) |
| Format | glTF 2.0 **binary** (`.glb`), single file |
| Compression | `EXT_meshopt_compression`, or none. **No Draco.** |
| Textures | **None.** No image textures, no KTX2/Basis, no baked lighting. |
| Node names | Exactly `Hand` and `Machine`, at any depth in the scene |
| Cameras / lights | **None** — do not export them |
| Up axis | Y-up (the glTF default; Blender's exporter converts from its Z-up) |

Node names are the entire contract. `loadOriginAssets()` calls
`gltf.scene.getObjectByName("Hand")` and `getObjectByName("Machine")`. A rename
in Blender is a silent downgrade to the procedural rig on the next deploy, so if
the models stop appearing, check the names first.

## Materials are discarded on load

Whatever you assign in Blender is **thrown away** at load time and replaced with
materials built from `glPalette` in `lib/palette.ts`. This is not an oversight —
it keeps one palette authoritative across the SVG film, the DOM, and the GL
scene, so a brand color change stays a one-line edit rather than a re-export.

Assign whatever is convenient for modelling. The only thing the loader reads
from your material assignment is one special case: a child mesh named `Drum`
inside `Machine` gets the amber accent instead of the ochre body, mirroring the
raised drying drum in `buildMachine()`.

## Silhouette and scale

Scene units are the film's own — roughly "1 unit ≈ 1 mm at product scale." The
loader **preserves the procedural node's transform**, so it drops your mesh into
the position, rotation and scale the film already animates. Match these bounding
boxes and the choreography needs no retuning:

| Node | Width (X) | Height (Y) | Depth (Z) | Origin sits at |
|---|---|---|---|---|
| `Hand` | ~140 | ~200 | ~45 | palm centre |
| `Machine` | ~510 | ~330 | ~120 | roller-bank centre, drum above |

Keep the object origin at the pivot named above and freeze transforms before
export (`Object → Apply → All Transforms`). A non-zero object transform in
Blender compounds with the film's animated transform and the object will drift.

Art direction, matching the SVG film it replaces:

- Low-poly, broad readable planes. Target well under 5k triangles each.
- Exaggerated, slightly stylised proportions — this is a storybook hand, not an
  anatomical one. The existing procedural hand is a flattened sphere with four
  capsule fingers; that is the level of abstraction to beat, not to match.
- No micro-surface detail, no bevelled edge wear, no photoreal topology. It is
  lit by one hemisphere light, one key and one warm rim; detail below a few
  units simply will not survive.
- The machine reads at a glance as *rollers plus a drying drum*. It has five
  rollers today; keep that silhouette legible from the film's camera distance.

## Export

From Blender: `File → Export → glTF 2.0 (.glb)`, format **glTF Binary**, include
**Selected Objects** only, geometry **Apply Modifiers** on, **Compression off**,
and uncheck cameras, lights and animation.

Then compress with meshopt (Draco is deliberately excluded — its wasm decoder
costs more than these two low-poly objects are worth):

```bash
bunx gltfpack -i exported.glb -o public/origin-assets.glb -c
```

`-c` applies `EXT_meshopt_compression`; `-cc` compresses harder at some quality
cost and is usually unnecessary at this polygon count.

## Verifying it landed

There is no build step and no test that can prove the models look right — the
repo cannot ship the binary, so CI necessarily exercises the fallback path. Check
by eye:

1. Drop the file at `public/origin-assets.glb`.
2. Run the dev server and scroll to the MAKE chapter (machine) and the final GRAB
   chapter (hand).
3. If either object still looks like the procedural primitive, open the console:
   `loadOriginAssets` warns exactly once with the URL and the reason. The two
   common causes are a mistyped node name and a Draco-compressed export.

Budget: the file should land in the low tens of kilobytes. If it is over ~200 kB
something is wrong — most likely exported modifiers, or geometry that should have
been decimated.
