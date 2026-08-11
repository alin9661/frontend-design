"use client";

import { domAnimation, LazyMotion, MotionConfig } from "framer-motion";

// Wraps the app in a single MotionConfig with reducedMotion="user", which
// makes framer-motion itself respect the visitor's OS-level
// prefers-reduced-motion setting for every animate/initial/whileInView/
// variants prop tree-wide — no more per-component
// `prefersReducedMotion ? undefined : {...}` ternaries needed for those.
//
// Why this file has to exist and be "use client": MotionConfig is a client
// component, so it can't be rendered directly inside the (server) root
// layout — it needs this thin client boundary in between.
//
// LazyMotion + `m.*` instead of `motion.*`: importing `motion` pulls
// framer-motion's whole renderer into every route's shared chunk. Loading a
// feature bundle explicitly and rendering the lightweight `m` components
// instead cut "/" first-load JS from 164,731 to 145,737 gzip bytes against
// the 165,000 CI budget (scripts/check-bundle.ts).
//
// Why domAnimation and not domMax: domAnimation covers animations, variants,
// exit animations and tap/hover/focus gestures — everything the site
// currently uses. domMax adds drag, layout animations and layout projection,
// which nothing renders today (test/motion.test.ts scans every .tsx under
// components/, app/ and lib/ and fails if a drag/layout prop appears,
// because under domAnimation those props DON'T throw — they silently do
// nothing). The planned drag-to-inspect can (concept C4) is the one known
// feature that would force domMax; that trade gets made when the code exists.
//
// `strict` makes rendering a full `motion.*` element inside this tree throw,
// so a reverted import fails loudly instead of quietly restoring the payload.
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
