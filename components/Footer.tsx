"use client";

import { motion } from "framer-motion";
import { CTA_SPRING, REVEAL, REVEAL_SLOW } from "@/lib/motion";

// Single parent + variants pattern (matches Hero's container/item split):
// staggerChildren replaces the old hand-stacked per-element delays
// (0/0.08/0.16/0.24), so the sequence stays correct even if a child is
// added, removed, or reordered.
const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { y: 40, opacity: 0 },
  show: { y: 0, opacity: 1, transition: REVEAL },
};

const itemSmall = {
  hidden: { y: 20, opacity: 0 },
  show: { y: 0, opacity: 1, transition: REVEAL },
};

export default function Footer() {
  return (
    <footer className="relative bg-forest-deep text-cream pt-32 overflow-hidden">
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.25 }}
        variants={container}
        className="relative z-10 flex flex-col items-center text-center px-6"
      >
        <motion.h2
          variants={item}
          className="font-display uppercase text-[clamp(3rem,10vw,8rem)] leading-[0.9]"
        >
          FEEL THE LIFT
        </motion.h2>

        <motion.p
          variants={item}
          className="mt-6 font-body text-lg md:text-xl text-cream/80"
        >
          Zero sugar. Organic. Fair trade forever.
        </motion.p>

        <motion.div variants={item} className="mt-10">
          <motion.a
            href="https://drinkmateina.com"
            target="_blank"
            rel="noopener noreferrer"
            // D6 fix: this ternary was redundant with app/providers.tsx's
            // `<MotionConfig reducedMotion="user">`, which already
            // suppresses framer transform animations globally — Hero's
            // identical CTA never had one. MotionConfig is now the single
            // documented source of reduced-motion truth for framer-driven
            // transforms; a reduced-motion branch only belongs here if it
            // governs something MotionConfig can't reach (e.g.
            // FloatingItem's raw keyframe arrays, or LoadingScreen's raw
            // CSS transition — see that file's A1 fix).
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            transition={CTA_SPRING}
            // E1 fix: see Hero.tsx's identical CTA for the full rationale —
            // a cream ring (this pill's own text color) with a forest-deep
            // offset so the ring reads against this pill's own
            // cream-on-forest-deep background instead of Hero's
            // forest-on-cream one.
            className="inline-block bg-cream text-forest-deep font-display uppercase tracking-wide text-xl md:text-2xl px-10 py-5 rounded-full shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-cream focus-visible:ring-offset-forest-deep"
          >
            SHOP MATEÍNA
          </motion.a>
        </motion.div>

        <motion.p
          variants={itemSmall}
          className="mt-16 text-cream/50 text-xs font-body"
        >
          © 2026 Mateína concept — unofficial fan advertisement. All
          trademarks belong to Mateina US Inc.
        </motion.p>
      </motion.div>

      <motion.div
        aria-hidden="true"
        initial={{ y: 60, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        viewport={{ once: true, amount: 0.2 }}
        // D5 fix: was a bespoke `{ duration: 0.8, ease: EASE_OUT }` — now
        // the named REVEAL_SLOW token (same values), so this oversized
        // wordmark reveal and any other "big/slow" reveal stay in sync if
        // the shared timing ever gets retuned.
        transition={{ ...REVEAL_SLOW, delay: 0.1 }}
        className="select-none pointer-events-none text-center font-display uppercase text-[clamp(6rem,22vw,20rem)] leading-none text-cream/10 whitespace-nowrap mt-24 -mb-[0.25em]"
      >
        MATEÍNA
      </motion.div>
    </footer>
  );
}
