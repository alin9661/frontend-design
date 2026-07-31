// test/engine/gl/post.test.ts
//
// gl/post.ts's `Post` class wraps postprocessing's EffectComposer, which
// hard-requires a real THREE.WebGLRenderer the moment a pass is added
// (calls `renderer.getDrawingBufferSize` internally) — unavailable in jsdom
// (no WebGL2), and there is no RendererLike-style mock seam for it (see the
// module's own comment). `shouldEnablePost` is the pure piece of this
// module's logic (design doc §4/§6: "disabled on low tier + reduced
// motion") and is fully covered here, both branches per axis.

import { describe, expect, it } from "vitest";
import { shouldEnablePost } from "@/lib/engine/gl/post";

describe("shouldEnablePost", () => {
  it("is enabled on high/medium tier with motion allowed", () => {
    expect(shouldEnablePost("high", false)).toBe(true);
    expect(shouldEnablePost("medium", false)).toBe(true);
  });

  it("is disabled on the low tier regardless of reduced motion", () => {
    expect(shouldEnablePost("low", false)).toBe(false);
    expect(shouldEnablePost("low", true)).toBe(false);
  });

  it("is disabled under reduced motion regardless of tier", () => {
    expect(shouldEnablePost("high", true)).toBe(false);
    expect(shouldEnablePost("medium", true)).toBe(false);
  });

  it("is enabled only when both conditions are favorable", () => {
    expect(shouldEnablePost("medium", false)).toBe(true);
  });
});
