// test/engine/gl/riso.test.ts
//
// gl/shaders/riso.ts. Same jsdom constraint as gl/post.ts: an EffectComposer
// cannot be built without a real WebGLRenderer, so nothing here composes. What
// IS testable without a GPU is everything that decides *whether* and *how* the
// pass runs — the policy matrix, the shader source (parsed, not eyeballed),
// the uniform defaults, and the low-tier fallback descriptor. A bare `Effect`
// is constructible in jsdom (it only builds Maps and a BlendMode), so the
// class's uniform bookkeeping is covered for real too.

import { describe, expect, it } from "vitest";
import { Uniform, Vector2 } from "three";
import type { QualityTier } from "@/lib/engine/types";
import { simplex3d } from "@/lib/engine/gl/shaders/noise";
import {
  RISO_GRAIN_DEFAULTS,
  RISO_GRAIN_FALLBACK,
  RISO_GRAIN_FRAGMENT_SHADER,
  RISO_GRAIN_ROUTE,
  RISO_GRAIN_UNIFORM_NAMES,
  RisoGrainEffect,
  buildRisoGrainFallback,
  createRisoGrainEffect,
  isRisoGrainRoute,
  risoGrainMode,
  shouldAnimateRisoGrain,
  shouldEnableRisoGrain,
} from "@/lib/engine/gl/shaders/riso";

const TIERS: QualityTier[] = ["high", "medium", "low"];

describe("risoGrainMode — the full policy matrix", () => {
  it("covers every tier x reduced-motion combination on the riso route", () => {
    expect(risoGrainMode({ quality: "high", reducedMotion: false, route: "/" })).toBe("animated");
    expect(risoGrainMode({ quality: "medium", reducedMotion: false, route: "/" })).toBe("animated");
    expect(risoGrainMode({ quality: "high", reducedMotion: true, route: "/" })).toBe("static");
    expect(risoGrainMode({ quality: "medium", reducedMotion: true, route: "/" })).toBe("static");
    expect(risoGrainMode({ quality: "low", reducedMotion: false, route: "/" })).toBe("fallback");
    expect(risoGrainMode({ quality: "low", reducedMotion: true, route: "/" })).toBe("fallback");
  });

  it("is off on every other route, whatever the tier or motion preference", () => {
    for (const quality of TIERS) {
      for (const reducedMotion of [false, true]) {
        for (const route of ["/deep-wave", "/refer", "/origin"]) {
          expect(risoGrainMode({ quality, reducedMotion, route })).toBe("off");
        }
      }
    }
  });

  it("gates on the route before the tier, so an off-route low tier gets no fallback either", () => {
    expect(risoGrainMode({ quality: "low", reducedMotion: false, route: "/deep-wave" })).toBe("off");
  });
});

describe("shouldEnableRisoGrain / shouldAnimateRisoGrain", () => {
  it("enables the GPU pass only for the two GL modes", () => {
    expect(shouldEnableRisoGrain({ quality: "high", reducedMotion: false, route: "/" })).toBe(true);
    expect(shouldEnableRisoGrain({ quality: "high", reducedMotion: true, route: "/" })).toBe(true);
    expect(shouldEnableRisoGrain({ quality: "medium", reducedMotion: false, route: "/" })).toBe(true);
    expect(shouldEnableRisoGrain({ quality: "medium", reducedMotion: true, route: "/" })).toBe(true);
  });

  it("never enables the GPU pass on the low tier or off-route", () => {
    expect(shouldEnableRisoGrain({ quality: "low", reducedMotion: false, route: "/" })).toBe(false);
    expect(shouldEnableRisoGrain({ quality: "low", reducedMotion: true, route: "/" })).toBe(false);
    expect(shouldEnableRisoGrain({ quality: "high", reducedMotion: false, route: "/deep-wave" })).toBe(
      false
    );
  });

  it("advances the clock only when motion is allowed on a GL tier", () => {
    expect(shouldAnimateRisoGrain({ quality: "high", reducedMotion: false, route: "/" })).toBe(true);
    expect(shouldAnimateRisoGrain({ quality: "medium", reducedMotion: false, route: "/" })).toBe(true);
    expect(shouldAnimateRisoGrain({ quality: "high", reducedMotion: true, route: "/" })).toBe(false);
    expect(shouldAnimateRisoGrain({ quality: "low", reducedMotion: false, route: "/" })).toBe(false);
    expect(shouldAnimateRisoGrain({ quality: "high", reducedMotion: false, route: "/refer" })).toBe(
      false
    );
  });
});

describe("isRisoGrainRoute", () => {
  it("accepts the landing route with a query string or hash attached", () => {
    expect(isRisoGrainRoute("/")).toBe(true);
    expect(isRisoGrainRoute("/?utm_source=x")).toBe(true);
    expect(isRisoGrainRoute("/#flavors")).toBe(true);
  });

  it("ignores a trailing slash on a nested route rather than matching it", () => {
    expect(isRisoGrainRoute("/deep-wave/")).toBe(false);
    expect(isRisoGrainRoute("/deep-wave")).toBe(false);
  });

  it("rejects routes that merely start with the riso route", () => {
    expect(isRisoGrainRoute("/refer")).toBe(false);
    expect(RISO_GRAIN_ROUTE).toBe("/");
  });
});

/* -------------------------------------------------------------------------- */

/** All `uniform <type> <name>;` declarations in a GLSL source, in order. */
function declaredUniforms(source: string): string[] {
  const names: string[] = [];
  const re = /^\s*uniform\s+\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/gm;
  let match = re.exec(source);
  while (match !== null) {
    names.push(match[1]);
    match = re.exec(source);
  }
  return names;
}

describe("RISO_GRAIN_FRAGMENT_SHADER", () => {
  it("declares exactly the uniforms the class owns, in the documented order", () => {
    expect(declaredUniforms(RISO_GRAIN_FRAGMENT_SHADER)).toEqual([...RISO_GRAIN_UNIFORM_NAMES]);
  });

  it("declares every uniform its own body references", () => {
    const declared = new Set(declaredUniforms(RISO_GRAIN_FRAGMENT_SHADER));
    const referenced = RISO_GRAIN_FRAGMENT_SHADER.match(/\bu[A-Z]\w*/g) ?? [];
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of new Set(referenced)) {
      expect(declared.has(name), `${name} is used but never declared`).toBe(true);
    }
  });

  it("does not redeclare postprocessing's injected built-ins", () => {
    const declared = declaredUniforms(RISO_GRAIN_FRAGMENT_SHADER);
    for (const builtin of ["resolution", "texelSize", "aspect", "time", "inputBuffer"]) {
      expect(declared).not.toContain(builtin);
    }
  });

  it("exposes the mainImage entry point postprocessing merges effects through", () => {
    expect(RISO_GRAIN_FRAGMENT_SHADER).toMatch(
      /void\s+mainImage\s*\(\s*const\s+in\s+vec4\s+inputColor\s*,\s*const\s+in\s+vec2\s+uv\s*,\s*out\s+vec4\s+outputColor\s*\)/
    );
  });

  it("reuses the shared simplex chunk instead of carrying a private copy", () => {
    expect(RISO_GRAIN_FRAGMENT_SHADER).toContain(simplex3d);
    // exactly one definition — a second copy would fail to link
    const definitions = RISO_GRAIN_FRAGMENT_SHADER.match(/float\s+simplex3d\s*\(\s*vec3/g) ?? [];
    expect(definitions).toHaveLength(1);
  });

  it("concatenates simplex3d before fbm, which calls it", () => {
    const simplexAt = RISO_GRAIN_FRAGMENT_SHADER.indexOf("float simplex3d(vec3 v)");
    const fbmAt = RISO_GRAIN_FRAGMENT_SHADER.indexOf("float fbm(vec3 p)");
    expect(simplexAt).toBeGreaterThan(-1);
    expect(fbmAt).toBeGreaterThan(simplexAt);
  });

  it("is ink-coverage grain, not an additive white-noise film overlay", () => {
    // multiplicative coverage against the input, quantised into drum cells
    expect(RISO_GRAIN_FRAGMENT_SHADER).toContain("inputColor.rgb * coverage");
    expect(RISO_GRAIN_FRAGMENT_SHADER).toMatch(/floor\s*\(\s*p\s*\/\s*cellSize\s*\)/);
    // no hash-noise film grain
    expect(RISO_GRAIN_FRAGMENT_SHADER).not.toMatch(/fract\s*\(\s*sin\s*\(/);
  });

  it("steps the grain clock rather than sliding it continuously", () => {
    expect(RISO_GRAIN_FRAGMENT_SHADER).toMatch(/floor\s*\(\s*uTime\s*\*\s*max\s*\(\s*uSpeed/);
  });

  it("misregisters the three channels in three different directions", () => {
    const offsets = RISO_GRAIN_FRAGMENT_SHADER.match(/vec2 d[RGB] = vec2\([^)]*\) \* uMisregistration;/g);
    expect(offsets).toHaveLength(3);
    expect(new Set(offsets).size).toBe(3);
  });

  it("holds the paper tooth off the animated clock", () => {
    // the tooth's noise axis is a literal, so it cannot drift with uTime
    expect(RISO_GRAIN_FRAGMENT_SHADER).toMatch(/fbm\(vec3\(px \* [\d.]+, 17\.0\)\)/);
  });
});

describe("RISO_GRAIN_DEFAULTS", () => {
  it("keeps normalised amounts inside 0..1", () => {
    expect(RISO_GRAIN_DEFAULTS.intensity).toBeGreaterThan(0);
    expect(RISO_GRAIN_DEFAULTS.intensity).toBeLessThanOrEqual(1);
    expect(RISO_GRAIN_DEFAULTS.paperTooth).toBeGreaterThan(0);
    expect(RISO_GRAIN_DEFAULTS.paperTooth).toBeLessThanOrEqual(1);
  });

  it("keeps the ink cell coarse enough to read as a print screen", () => {
    expect(RISO_GRAIN_DEFAULTS.scale).toBeGreaterThanOrEqual(1.5);
    expect(RISO_GRAIN_DEFAULTS.scale).toBeLessThan(16);
  });

  it("keeps misregistration sub-pixel-ish rather than a visible ghost", () => {
    expect(RISO_GRAIN_DEFAULTS.misregistration).toBeGreaterThan(0);
    expect(RISO_GRAIN_DEFAULTS.misregistration).toBeLessThanOrEqual(2);
  });

  it("boils slower than the frame rate, so the grain visibly holds between rolls", () => {
    expect(RISO_GRAIN_DEFAULTS.speed).toBeGreaterThan(0);
    expect(RISO_GRAIN_DEFAULTS.speed).toBeLessThan(30);
  });
});

/* -------------------------------------------------------------------------- */

const NO_RENDERER = null as never;

describe("RisoGrainEffect", () => {
  it("registers exactly the declared uniforms with the default values", () => {
    const effect = new RisoGrainEffect();
    expect([...effect.uniforms.keys()].sort()).toEqual([...RISO_GRAIN_UNIFORM_NAMES].sort());
    expect(effect.uniforms.get("uIntensity")?.value).toBe(RISO_GRAIN_DEFAULTS.intensity);
    expect(effect.uniforms.get("uScale")?.value).toBe(RISO_GRAIN_DEFAULTS.scale);
    expect(effect.uniforms.get("uMisregistration")?.value).toBe(RISO_GRAIN_DEFAULTS.misregistration);
    expect(effect.uniforms.get("uPaperTooth")?.value).toBe(RISO_GRAIN_DEFAULTS.paperTooth);
    expect(effect.uniforms.get("uSpeed")?.value).toBe(RISO_GRAIN_DEFAULTS.speed);
    expect(effect.uniforms.get("uTime")?.value).toBe(0);
    effect.dispose();
  });

  it("accepts overrides and clamps them into the shader's usable range", () => {
    const effect = new RisoGrainEffect({
      intensity: 5,
      scale: 0.2,
      misregistration: -3,
      paperTooth: 0.5,
      speed: 12,
    });
    expect(effect.uniforms.get("uIntensity")?.value).toBe(1);
    expect(effect.uniforms.get("uScale")?.value).toBe(1.5);
    expect(effect.uniforms.get("uMisregistration")?.value).toBe(0);
    expect(effect.uniforms.get("uPaperTooth")?.value).toBe(0.5);
    expect(effect.uniforms.get("uSpeed")?.value).toBe(12);
    effect.dispose();
  });

  it("advances uTime by the frame delta while animated", () => {
    const effect = new RisoGrainEffect({ animated: true });
    effect.update(NO_RENDERER, NO_RENDERER, 0.25);
    effect.update(NO_RENDERER, NO_RENDERER, 0.25);
    expect(effect.time).toBeCloseTo(0.5, 6);
    expect(effect.uniforms.get("uTime")?.value).toBeCloseTo(0.5, 6);
    effect.dispose();
  });

  it("leaves uTime pinned at zero when not animated", () => {
    const effect = new RisoGrainEffect({ animated: false });
    effect.update(NO_RENDERER, NO_RENDERER, 0.25);
    effect.update(NO_RENDERER, NO_RENDERER, 10);
    expect(effect.animated).toBe(false);
    expect(effect.time).toBe(0);
    expect(effect.uniforms.get("uTime")?.value).toBe(0);
    effect.dispose();
  });

  it("ignores a negative or non-finite delta instead of rewinding the clock", () => {
    const effect = new RisoGrainEffect();
    effect.update(NO_RENDERER, NO_RENDERER, 1);
    effect.update(NO_RENDERER, NO_RENDERER, -5);
    effect.update(NO_RENDERER, NO_RENDERER, Number.NaN);
    expect(effect.time).toBe(1);
    effect.dispose();
  });

  it("rewinds to a deterministic still frame when animation is switched off mid-session", () => {
    const effect = new RisoGrainEffect();
    effect.update(NO_RENDERER, NO_RENDERER, 3);
    expect(effect.time).toBe(3);
    effect.setAnimated(false);
    expect(effect.time).toBe(0);
    expect(effect.uniforms.get("uTime")?.value).toBe(0);
    effect.update(NO_RENDERER, NO_RENDERER, 1);
    expect(effect.time).toBe(0);
    effect.setAnimated(true);
    effect.update(NO_RENDERER, NO_RENDERER, 1);
    expect(effect.time).toBe(1);
    effect.dispose();
  });

  it("tracks the backbuffer size in uResolution", () => {
    const effect = new RisoGrainEffect();
    effect.setSize(1440, 810);
    const resolution = (effect.uniforms.get("uResolution") as Uniform<Vector2>).value;
    expect(resolution.x).toBe(1440);
    expect(resolution.y).toBe(810);
    effect.setSize(800, 600);
    expect(resolution.x).toBe(800);
    expect(resolution.y).toBe(600);
    effect.dispose();
  });

  it("clamps runtime setters the same way the constructor does", () => {
    const effect = new RisoGrainEffect();
    effect.setIntensity(-1);
    effect.setScale(999);
    effect.setMisregistration(100);
    effect.setPaperTooth(2);
    effect.setSpeed(-4);
    expect(effect.uniforms.get("uIntensity")?.value).toBe(0);
    expect(effect.uniforms.get("uScale")?.value).toBe(64);
    expect(effect.uniforms.get("uMisregistration")?.value).toBe(8);
    expect(effect.uniforms.get("uPaperTooth")?.value).toBe(1);
    expect(effect.uniforms.get("uSpeed")?.value).toBe(0);
    effect.dispose();
  });
});

describe("createRisoGrainEffect", () => {
  it("builds an animated effect on a GL tier with motion allowed", () => {
    const effect = createRisoGrainEffect({ quality: "high", reducedMotion: false, route: "/" });
    expect(effect).toBeInstanceOf(RisoGrainEffect);
    expect(effect?.animated).toBe(true);
    effect?.dispose();
  });

  it("builds a frozen effect under reduced motion and ignores an opposing option", () => {
    const effect = createRisoGrainEffect(
      { quality: "medium", reducedMotion: true, route: "/" },
      { animated: true }
    );
    expect(effect?.animated).toBe(false);
    effect?.update(NO_RENDERER, NO_RENDERER, 1);
    expect(effect?.time).toBe(0);
    effect?.dispose();
  });

  it("forwards tuning options through to the uniforms", () => {
    const effect = createRisoGrainEffect(
      { quality: "high", reducedMotion: false, route: "/" },
      { intensity: 0.5, scale: 4 }
    );
    expect(effect?.uniforms.get("uIntensity")?.value).toBe(0.5);
    expect(effect?.uniforms.get("uScale")?.value).toBe(4);
    effect?.dispose();
  });

  it("returns null for the low tier and for other routes", () => {
    expect(createRisoGrainEffect({ quality: "low", reducedMotion: false, route: "/" })).toBeNull();
    expect(createRisoGrainEffect({ quality: "low", reducedMotion: true, route: "/" })).toBeNull();
    expect(
      createRisoGrainEffect({ quality: "high", reducedMotion: false, route: "/deep-wave" })
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("the low-tier fallback descriptor", () => {
  it("carries a tiling percent-encoded SVG turbulence tile", () => {
    expect(RISO_GRAIN_FALLBACK.kind).toBe("css-overlay");
    expect(RISO_GRAIN_FALLBACK.dataUri.startsWith("data:image/svg+xml,")).toBe(true);
    const decoded = decodeURIComponent(
      RISO_GRAIN_FALLBACK.dataUri.slice("data:image/svg+xml,".length)
    );
    expect(decoded).toBe(RISO_GRAIN_FALLBACK.svg);
    expect(decoded).toContain("<feTurbulence");
    expect(decoded).toContain('stitchTiles="stitch"');
    expect(decoded).toContain(`id="${RISO_GRAIN_FALLBACK.filterId}"`);
    expect(decoded).toContain(`filter="url(#${RISO_GRAIN_FALLBACK.filterId})"`);
  });

  it("percent-encodes the characters that break a bare data: URI", () => {
    expect(RISO_GRAIN_FALLBACK.dataUri).not.toContain("<");
    expect(RISO_GRAIN_FALLBACK.dataUri).not.toContain("#");
    expect(RISO_GRAIN_FALLBACK.dataUri).not.toContain('"');
  });

  it("is static, so it needs no reduced-motion variant of its own", () => {
    expect(RISO_GRAIN_FALLBACK.svg).not.toContain("<animate");
    expect(RISO_GRAIN_FALLBACK.svg).not.toContain("dur=");
  });

  it("produces a spreadable, non-interactive overlay style", () => {
    const { style, tileSize, dataUri } = RISO_GRAIN_FALLBACK;
    expect(style.backgroundImage).toBe(`url("${dataUri}")`);
    expect(style.backgroundRepeat).toBe("repeat");
    expect(style.backgroundSize).toBe(`${tileSize}px ${tileSize}px`);
    expect(style.mixBlendMode).toBe("multiply");
    expect(style.pointerEvents).toBe("none");
    const opacity = Number(style.opacity);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });

  it("declares the tile size once and uses it for the SVG and the background", () => {
    const fallback = buildRisoGrainFallback({ tileSize: 96 });
    expect(fallback.tileSize).toBe(96);
    expect(fallback.svg).toContain('width="96"');
    expect(fallback.svg).toContain('viewBox="0 0 96 96"');
    expect(fallback.style.backgroundSize).toBe("96px 96px");
  });

  it("clamps out-of-range build options", () => {
    const fallback = buildRisoGrainFallback({ opacity: 4, tileSize: 2, baseFrequency: 99 });
    expect(fallback.style.opacity).toBe("1");
    expect(fallback.tileSize).toBe(16);
    expect(fallback.svg).toContain('baseFrequency="4"');
  });

  it("honours a custom base frequency", () => {
    expect(buildRisoGrainFallback({ baseFrequency: 0.9 }).svg).toContain('baseFrequency="0.9"');
  });

  it("returns a fresh descriptor per call rather than mutating the shared default", () => {
    const custom = buildRisoGrainFallback({ opacity: 0.4 });
    expect(custom.style.opacity).toBe("0.4");
    expect(RISO_GRAIN_FALLBACK.style.opacity).toBe("0.18");
  });
});
