// test/test-utils/render-in-app.tsx
//
// Renders a tree through the app's REAL provider stack (app/providers.tsx:
// strict LazyMotion + MotionConfig reducedMotion="user"), which is what
// app/layout.tsx wraps every route in.
//
// Why this exists: after the LazyMotion migration, `m.*` elements still
// render their static/initial styles without a LazyMotion ancestor, so a
// route test that renders bare would keep passing even if a component
// reverted to a full `motion.*` element — which THROWS in the browser under
// `strict`. Rendering route tests through the production providers turns
// that class of regression into a failing test instead of a runtime crash
// only a human clicking the site would find.
import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import Providers from "@/app/providers";

/** Drop-in replacement for Testing Library's `render` that mounts `ui`
 * inside <Providers>. Uses RTL's `wrapper` option so `rerender` keeps the
 * providers too. */
export function renderInApp(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return rtlRender(ui, { wrapper: Providers, ...options });
}
