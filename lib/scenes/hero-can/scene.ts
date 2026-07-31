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
import { springStep } from "@/lib/engine/core/pointer";
import { buildCan, getCanLayout, type BuiltCan } from "./can-geometry";
import { createLabelTexture } from "./label-texture";

const HERO_FLAVOR = flavorById("mint");

const IDLE_SPIN_SPEED = 0.18; // rad/s
const TILT_MAX = 0.22; // rad
const TILT_STIFFNESS = 60;
const TILT_DAMPING = 14;
/** World units (== CSS px at z=0, per the engine's per-view camera convention) the camera pulls back over scroll progress 0..1. */
const SCROLL_CAMERA_PULL = 220;
const AMBIENT_INTENSITY = 0.65;
const KEY_LIGHT_INTENSITY = 1.4;
const RIM_EMISSIVE_INTENSITY = 1.6;

const HEADLINE_LINES = ["SMOOTH LIFT.", "ZERO CRASH."] as const;
const HEADLINE_FONT_SIZE = 64; // px (world units)
const HEADLINE_COLOR = 0xf9f9ee; // brand.cream
const HEADLINE_GLOW = 1.4;

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

  init(ctx: ViewContext): void {
    // Re-runnable: tear down any previous build first (context-loss restore
    // calls init() again on the same instance — SceneModule contract).
    this.dispose();

    this.labelTexture = createLabelTexture(HERO_FLAVOR);
    this.built = buildCan(HERO_FLAVOR, { labelTexture: this.labelTexture });
    this.group = this.built.group;
    ctx.scene.add(this.group);

    this.setupLighting(ctx);
    this.setupRim();
    this.tryRegisterEnvironmentJob(ctx);

    this.baseCameraZ = ctx.camera.position.z;
    this.tiltX = { pos: 0, vel: 0 };
    this.tiltZ = { pos: 0, vel: 0 };
    this.spinAngle = 0;

    this.loadToken += 1;
    void this.loadHeadlineText(ctx, this.loadToken);
  }

  update(dt: number, ctx: ViewContext): void {
    if (!this.group) return;

    // Scroll pulls the camera back — a deliberate scroll response (not an
    // "auto" animation), kept unconditional of reducedMotion. In practice
    // the current hosts (worker/host.ts, worker/render.worker.ts) only call
    // Stage.update() at all when !reducedMotion, so under reduced motion
    // this line simply doesn't run either — see the workstream report.
    ctx.camera.position.z = this.baseCameraZ + ctx.scroll.progress * SCROLL_CAMERA_PULL;

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
      headlineGroup.position.set(0, layout.topOpeningY + layout.height * 0.18, layout.bodyRadius * 0.05);

      let cursorY = 0;
      const built: Array<{ dispose(): void }> = [];
      for (const line of HEADLINE_LINES) {
        const glText = new textMod.GlText(font, {
          text: line,
          fontSize: HEADLINE_FONT_SIZE,
          color: HEADLINE_COLOR,
          align: "center",
          glow: HEADLINE_GLOW,
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
