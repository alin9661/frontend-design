// lib/scenes/hero-can/scene.ts
//
// Hero SceneModule (design doc §5 "Hero", CAN CONTRACT): a single
// mint-flavor can (buildCan + createLabelTexture) with idle rotation,
// damped pointer tilt, scroll-driven camera pull-back, and an MSDF/SDF
// headline layer ("SMOOTH LIFT." / "ZERO CRASH.") rendered as a
// bloom-friendly glow above the can. The DOM headline in SectionHero.tsx
// stays permanently visible (see that file's header comment for why) — the
// GL headline is purely additive, so there's nothing for a11y to trip on
// even before/if the GL layer loads.
//
// Default export is a FACTORY (`() => SceneModule`) per the scene-module
// convention (see lib/scenes/placeholder/scene.ts) — scene-registry.ts
// calls it once per view, so each view gets its own instance/state.

import * as THREE from "three";
import type { SceneModule, ViewContext } from "@/lib/engine/types";
import { flavorById } from "@/lib/flavors";
import { easeOutExpo, mapRange, springStep } from "@/lib/engine/core/math";
import { computeProgress } from "@/lib/engine/gl/view";
import { buildCan, getCanLayout, type BuiltCan } from "./can-geometry";
import { createLabelTexture } from "./label-texture";

const HERO_FLAVOR = flavorById("mint");

const IDLE_SPIN_SPEED = 0.18; // rad/s
const TILT_MAX = 0.22; // rad
// Motion-audit fix N5: pointer tilt used to double-smooth (PointerTracker's
// own ~100ms damp on top of this scene's own ~250ms spring), reading as
// ~350ms of mushy lag between moving the pointer and the can visibly
// responding. Stiffened to ζ≈0.85 (still slightly underdamped, so the
// motion keeps a touch of life instead of feeling clamped) for a much
// tighter, single perceptible smoothing stage.
const TILT_STIFFNESS = 140;
const TILT_DAMPING = 20;
/** World units (== CSS px at z=0, per the engine's per-view camera convention) the camera pulls back over the pull-band described by PULL_SPAN below. */
const SCROLL_CAMERA_PULL = 220;
/**
 * H1 fix: the hero is the document's FIRST section, so its own per-view
 * progress (`computeProgress`, gl/view.ts) is ~0.5 at scrollY=0, not 0 —
 * `(viewportH - rect.top) / (viewportH + rect.height)` with `rect.top ≈ 0`
 * and `rect.height ≈ viewportH`. The pull used to assume progress started
 * at 0, so `clamp(p*2,0,1)` was already pegged at 1 on the very first frame
 * — the camera sat fully pulled back before any scrolling happened. The
 * pull now ramps over a band of size PULL_SPAN starting at the section's own
 * REST progress (its progress at scrollY=0, derived per-instance in init()
 * so this stays correct even if the hero ever stops being the first section
 * or its height changes — never hardcode 0.5 here).
 */
const PULL_SPAN = 0.25; // full pull after ~a quarter of the view's own progress span above rest
const AMBIENT_INTENSITY = 0.65;
const KEY_LIGHT_INTENSITY = 1.4;
const RIM_EMISSIVE_INTENSITY = 1.6;

// Composition fix (confirmed design-review finding): the can used to sit
// dead-center behind the DOM copy column, so it photobombed the sub-copy
// and severed the footnote mid-sentence, with no focal hierarchy between
// type/product/stats. Offsetting it right + scaling it up turns it into a
// confident right-side anchor instead, once SectionHero.tsx's copy column
// is left-aligned to match (see that file).
const CAN_X_OFFSET_FACTOR = 0.28; // × ctx.rect.width (CSS px == world units at z=0)
const CAN_SCALE_FACTOR = 1.6;

const HEADLINE_LINES = ["SMOOTH LIFT.", "ZERO CRASH."] as const;
// Watermark treatment (design-review F-001): the GL headline used to render
// at fontSize 64 with its baseline INSIDE the can silhouette (z ≈
// bodyRadius·0.05), so the can occluded the middle of every glyph and the
// fragments poking out around the rim read as a z-fighting bug — while the
// DOM <h1> carried the same words at full strength on the left. The GL
// layer is now an intentional BACKDROP: oversized, low-opacity, pushed well
// behind the can (same pattern as the landing page's giant flavor-name
// watermark behind its can). The DOM <h1> stays the sole full-strength
// headline; this layer is texture, not copy.
const HEADLINE_FONT_SIZE = 150; // px (world units)
const HEADLINE_COLOR = 0x1d423c; // brand.forest (lib/flavors.ts's `brand.forest`)
const HEADLINE_GLOW = 0.25;
const HEADLINE_OPACITY = 0.14;
/** World-z of the watermark plane — comfortably behind the can body
 * (radius 82 × CAN_SCALE_FACTOR 1.6 ≈ 131) so no glyph ever intersects it. */
const HEADLINE_Z = -320;

interface SpringState {
  pos: number;
  vel: number;
}

/**
 * Minimal shape of the TEXT CONTRACT ("@/lib/engine/gl/text") this scene
 * depends on. Imported by type only — the real module is resolved at
 * runtime via a dynamic `import()` in `loadHeadlineText`, guarded by a
 * try/catch, because it "may not exist yet mid-parallel" per the design
 * doc. (`bunx tsc --noEmit` may report an unresolved-module error on that
 * import path until the text workstream lands its file — expected, not a
 * bug in this file; see the workstream report.)
 */
interface TextModuleShape {
  loadFont(assets: ViewContext["assets"]): Promise<{ mode: "msdf" | "sdf"; texture: THREE.Texture }>;
  GlText: new (
    font: { mode: "msdf" | "sdf"; texture: THREE.Texture },
    opts: {
      text: string;
      fontSize: number;
      color?: number;
      align?: "left" | "center";
      maxWidth?: number;
      letterSpacing?: number;
      glow?: number;
      opacity?: number;
    }
  ) => {
    object3d: THREE.Object3D;
    width: number;
    height: number;
    setText(t: string): void;
    setColor(c: number): void;
    dispose(): void;
  };
}

class HeroCanScene implements SceneModule {
  private group: THREE.Group | null = null;
  private built: BuiltCan | null = null;
  private labelTexture: THREE.Texture | null = null;

  private ambientLight: THREE.AmbientLight | null = null;
  private keyLight: THREE.DirectionalLight | null = null;

  private rimGeometry: THREE.TorusGeometry | null = null;
  private rimMaterial: THREE.MeshStandardMaterial | null = null;
  private rimMesh: THREE.Mesh | null = null;

  private headlineGroup: THREE.Group | null = null;
  private headlineTexts: Array<{ dispose(): void }> = [];
  /** Bumped on every init()/dispose(); loadHeadlineText() bails if it's
   * gone stale, so a fast context-loss re-init or unmount can't race an
   * in-flight font/module load into mutating a torn-down instance. */
  private loadToken = 0;

  private baseCameraZ = 0;
  private tiltX: SpringState = { pos: 0, vel: 0 };
  private tiltZ: SpringState = { pos: 0, vel: 0 };
  private spinAngle = 0;
  /**
   * Motion-audit fix C2: per-VIEW progress (0..1 across just this section's
   * own scroll span), fed by `onProgress()` — the SceneModule contract's
   * scrubbable-progress hook (see ../../engine/types.ts), same as every
   * other scene in this codebase. Previously `update()` read
   * `ctx.scroll.progress`, the GLOBAL document scroll fraction — but the
   * hero section is culled from view (and its rect.progress() pegged at 1)
   * after only ~1/6 of the full page's scroll, so the document-wide
   * progress never got anywhere near far enough for the designed 220px pull
   * to actually land while the hero was visible.
   *
   * H1 fix: seeded from the LIVE scroll position in init() (not hardcoded
   * 0) so the very first update() call — before Stage's next frame calls
   * onProgress() — already reflects wherever the page actually is, instead
   * of momentarily rendering at baseCameraZ and popping once the real
   * onProgress() value arrives (see H6).
   */
  private viewProgress = 0;
  /**
   * H1 fix: this view's own progress at scrollY=0 — the floor the pull-band
   * ramps up from. Computed fresh in init() from the live rect/viewport so
   * it stays correct if the hero's position or height ever changes.
   */
  private restProgress = 0;

  init(ctx: ViewContext): void {
    // Re-runnable: tear down any previous build first (context-loss restore
    // calls init() again on the same instance — SceneModule contract).
    this.dispose();

    this.labelTexture = createLabelTexture(HERO_FLAVOR);
    this.built = buildCan(HERO_FLAVOR, { labelTexture: this.labelTexture });
    this.group = this.built.group;
    this.group.position.x = ctx.rect.width * CAN_X_OFFSET_FACTOR;
    this.group.scale.setScalar(CAN_SCALE_FACTOR);
    ctx.scene.add(this.group);

    this.setupLighting(ctx);
    this.setupRim();
    this.tryRegisterEnvironmentJob(ctx);

    this.baseCameraZ = ctx.camera.position.z;
    this.tiltX = { pos: 0, vel: 0 };
    this.tiltZ = { pos: 0, vel: 0 };
    this.spinAngle = 0;
    // H1 fix: this view's progress at scrollY=0 is the pull-band's floor —
    // NOT 0 (see PULL_SPAN's comment for why the hero, being the first
    // section, never actually sees progress 0).
    this.restProgress = computeProgress(ctx.rect, 0, ctx.size.height);
    // H6: seed from the CURRENT scroll (not always 0 — e.g. a context-loss
    // reinit mid-scroll) so the first update() call already lands at the
    // right pull instead of momentarily reading rest and popping once the
    // next onProgress() arrives.
    this.viewProgress = computeProgress(ctx.rect, ctx.scroll.current, ctx.size.height);

    this.loadToken += 1;
    void this.loadHeadlineText(ctx, this.loadToken);
  }

  /** SceneModule contract (see ../../engine/types.ts): per-view scrub progress. */
  onProgress(p: number): void {
    this.viewProgress = p;
  }

  update(dt: number, ctx: ViewContext): void {
    if (!this.group) return;

    // Scroll pulls the camera back — a deliberate scroll response (not an
    // "auto" animation), kept unconditional of reducedMotion. In practice
    // the current hosts (worker/host.ts, worker/render.worker.ts) only call
    // Stage.update() at all when !reducedMotion, so under reduced motion
    // this line simply doesn't run either — see the workstream report.
    //
    // The hero's readable beat is the PULL_SPAN-wide band starting at this
    // view's own rest progress (its progress at scrollY=0 — see restProgress
    // above), so the pull always starts from "no scroll yet" regardless of
    // where in [0,1] that actually sits for a first-in-document section.
    // easeOutExpo front-loads the pull so it reads as a quick, decisive push
    // rather than a linear drift; mapRange's clampOut holds the band's ends
    // flat (0 before rest, 1 once PULL_SPAN is covered) instead of
    // extrapolating past them.
    const pullT = mapRange(
      this.viewProgress,
      this.restProgress,
      Math.min(1, this.restProgress + PULL_SPAN),
      0,
      1,
      true
    );
    const pull = easeOutExpo(pullT);
    ctx.camera.position.z = this.baseCameraZ + pull * SCROLL_CAMERA_PULL;

    if (ctx.reducedMotion) {
      // Static frame: no idle spin, no pointer tilt (§6 a11y).
      return;
    }

    this.spinAngle += dt * IDLE_SPIN_SPEED;

    const targetTiltZ = THREE.MathUtils.clamp(-ctx.pointer.x * TILT_MAX, -TILT_MAX, TILT_MAX);
    const targetTiltX = THREE.MathUtils.clamp(ctx.pointer.y * TILT_MAX, -TILT_MAX, TILT_MAX);
    this.tiltX = springStep(this.tiltX.pos, this.tiltX.vel, targetTiltX, TILT_STIFFNESS, TILT_DAMPING, dt);
    this.tiltZ = springStep(this.tiltZ.pos, this.tiltZ.vel, targetTiltZ, TILT_STIFFNESS, TILT_DAMPING, dt);

    this.group.rotation.y = this.spinAngle;
    this.group.rotation.x = this.tiltX.pos;
    this.group.rotation.z = this.tiltZ.pos;
  }

  dispose(): void {
    this.loadToken += 1; // invalidate any in-flight loadHeadlineText

    if (this.group) {
      this.group.parent?.remove(this.group);
    }
    this.built?.dispose();
    this.built = null;
    this.group = null;

    this.labelTexture?.dispose();
    this.labelTexture = null;

    if (this.ambientLight) this.ambientLight.parent?.remove(this.ambientLight);
    if (this.keyLight) this.keyLight.parent?.remove(this.keyLight);
    this.ambientLight = null;
    this.keyLight = null;

    if (this.rimMesh) this.rimMesh.parent?.remove(this.rimMesh);
    this.rimGeometry?.dispose();
    this.rimMaterial?.dispose();
    this.rimGeometry = null;
    this.rimMaterial = null;
    this.rimMesh = null;

    if (this.headlineGroup) this.headlineGroup.parent?.remove(this.headlineGroup);
    for (const t of this.headlineTexts) t.dispose();
    this.headlineTexts = [];
    this.headlineGroup = null;
  }

  private setupLighting(ctx: ViewContext): void {
    this.ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    ctx.scene.add(this.ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xfff4e0, KEY_LIGHT_INTENSITY);
    this.keyLight.position.set(1.2, 1.6, 1.4);
    ctx.scene.add(this.keyLight);
  }

  /** Thin emissive ring at the can's shoulder — a bloom-friendly rim accent
   * (design doc §5 "Hero"). Reads as a highlight today; feeds gl/Post's
   * bloom pass once Stage wires post-processing per-view (render.worker.ts
   * notes Post isn't attached to per-view scenes yet — a gl/ gap this scene
   * doesn't own). */
  private setupRim(): void {
    if (!this.group) return;
    const layout = getCanLayout();

    this.rimGeometry = new THREE.TorusGeometry(layout.bodyRadius * 0.99, layout.bodyRadius * 0.035, 12, 48);
    this.rimMaterial = new THREE.MeshStandardMaterial({
      color: HERO_FLAVOR.accent,
      emissive: HERO_FLAVOR.accent,
      emissiveIntensity: RIM_EMISSIVE_INTENSITY,
      roughness: 0.4,
      metalness: 0.1,
    });
    this.rimMesh = new THREE.Mesh(this.rimGeometry, this.rimMaterial);
    this.rimMesh.rotation.x = Math.PI / 2;
    this.rimMesh.position.y = layout.labelTopY;
    this.group.add(this.rimMesh);
  }

  /**
   * PMREM (RoomEnvironment) needs a real THREE.WebGLRenderer, which
   * ViewContext does not expose (by design, for the RendererLike test
   * seam — see types.ts). This registers the documented "AssetManager job"
   * defensively in case a future engine revision threads the renderer
   * through the job closure; under the CURRENT wiring both
   * MainThreadHost.init() and render.worker.ts's handleInit() call
   * `assets.start()` synchronously before any view's `init()` can run, so
   * `AssetManager.add()` always throws "cannot add after start()" here —
   * caught below and treated as the contract's documented "renderer
   * unavailable" degrade path: MeshStandardMaterial lit by
   * ambient+directional lights only, no envMap. See the workstream report.
   */
  private tryRegisterEnvironmentJob(ctx: ViewContext): void {
    try {
      ctx.assets.add(`hero-can-pmrem-${Math.random().toString(36).slice(2)}`, 0, async () => null);
    } catch {
      // Expected under the current engine wiring — see the comment above.
    }
  }

  private async loadHeadlineText(ctx: ViewContext, token: number): Promise<void> {
    try {
      const textMod = (await import("@/lib/engine/gl/text")) as unknown as TextModuleShape;
      if (token !== this.loadToken || !this.group) return;

      const font = await textMod.loadFont(ctx.assets);
      if (token !== this.loadToken || !this.group) return;

      const layout = getCanLayout();
      const headlineGroup = new THREE.Group();
      // x follows the can's own composition offset (this.group.position.x,
      // set in init()) so the watermark stays visually paired with the
      // product; z pushes the whole plane behind the can (see HEADLINE_Z)
      // and y centers the two-line block on the can's vertical middle.
      headlineGroup.position.set(
        ctx.rect.width * CAN_X_OFFSET_FACTOR,
        layout.height * 0.5 * 0.4,
        HEADLINE_Z
      );

      let cursorY = 0;
      const built: Array<{ dispose(): void }> = [];
      for (const line of HEADLINE_LINES) {
        const glText = new textMod.GlText(font, {
          text: line,
          fontSize: HEADLINE_FONT_SIZE,
          color: HEADLINE_COLOR,
          align: "center",
          glow: HEADLINE_GLOW,
          opacity: HEADLINE_OPACITY,
        });
        glText.object3d.position.y = cursorY;
        cursorY -= glText.height * 1.15;
        headlineGroup.add(glText.object3d);
        built.push(glText);
      }

      ctx.scene.add(headlineGroup);
      this.headlineGroup = headlineGroup;
      this.headlineTexts = built;
    } catch {
      // "@/lib/engine/gl/text" isn't implemented yet (or its font failed to
      // load) — degrade to can-only. SectionHero.tsx's DOM headline already
      // carries the full, always-visible copy, so this is a silent,
      // fully a11y-safe no-op, not an error state.
    }
  }
}

export function createHeroCanScene(): SceneModule {
  return new HeroCanScene();
}

export default createHeroCanScene;
