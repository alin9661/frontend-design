"use client";

import { MotionConfig } from "framer-motion";

// Wraps the app in a single MotionConfig with reducedMotion="user", which
// makes framer-motion itself respect the visitor's OS-level
// prefers-reduced-motion setting for every animate/initial/whileInView/
// variants prop tree-wide — no more per-component
// `prefersReducedMotion ? undefined : {...}` ternaries needed for those.
//
// Why this file has to exist and be "use client": MotionConfig is a client
// component, so it can't be rendered directly inside the (server) root
// layout — it needs this thin client boundary in between.
export default function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
