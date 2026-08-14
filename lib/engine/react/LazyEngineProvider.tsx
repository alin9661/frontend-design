"use client";

// lib/engine/react/LazyEngineProvider.tsx
//
// The client boundary that keeps the engine off `/`'s critical path.
//
// A post-mount dynamic import is only expressible inside a Client Component,
// but app/page.tsx must stay a Server Component so every section still
// renders server-side (docs/deep-wave-engine-design.md §6: "engine/three load
// only on /deep-wave (route split + post-mount dynamic import); / first-load
// JS UNCHANGED"). This file is that one-component boundary: everything above
// it stays server-rendered, and the engine chunk — plus the three.js graph it
// reaches — is requested only after the first client commit.
//
// React.lazy + a mounted flag rather than next/dynamic({ ssr: false }): the
// mounted flag is what makes it post-MOUNT (next/dynamic starts its import
// during render), and it keeps the loadable wrapper out of the landing
// bundle, which is measured to the byte by scripts/check-bundle.ts.
//
// Both the server pass and the first client render emit <OriginStory /> with
// no EngineContext above it — its no-context branch is a complete 2D
// rendering path — so markup matches on hydration and the section stays
// readable if WebGL never arrives.

// The second gate is `prefers-reduced-motion`. Post-mount is not the same as
// unconditional: `/`'s only GL view lives in OriginStory's ANIMATED layout, and
// a reduced-motion visitor gets StaticStory instead, which registers no view at
// all. Mounting the provider for them fetched ~226 kB gzip of three.js and
// postprocessing, created a WebGL context and spawned a worker to render
// nothing — and no gate could see it, because none of that is First Load JS.
// framer's `useReducedMotion` (not core/reduced-motion.ts) on purpose: it is
// the exact hook OriginStory branches on, already in this bundle, so the two
// decisions cannot disagree about whether a view will ever exist.
// The reduced-motion branch still paints the riso texture through the tiny
// DOM-only StaticRisoGrain component; it never mounts a canvas or worker.

import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import OriginStory from "@/components/OriginStory";

const EngineProvider = lazy(() => import("./EngineProvider"));
const ReducedMotionGrain = lazy(() =>
  import("./RisoGrainOverlay").then((module) => ({ default: module.StaticRisoGrain })),
);

export default function LazyEngineProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  useEffect(() => setMounted(true), []);

  if (!mounted) return <OriginStory />;

  if (prefersReducedMotion) {
    return (
      <>
        <OriginStory />
        <Suspense fallback={null}>
          <ReducedMotionGrain source="reduced-motion" />
        </Suspense>
      </>
    );
  }

  return (
    <Suspense fallback={<OriginStory />}>
      <EngineProvider>{children}</EngineProvider>
    </Suspense>
  );
}
