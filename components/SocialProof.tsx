"use client";

import { m } from "framer-motion";
import { REVEAL } from "@/lib/motion";

const MARQUEE_TEXT = "JOIN THE #MATEINAFAMILIA ★ ".repeat(6);

export default function SocialProof() {
  return (
    <section className="relative">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-cream" />
      {/* marquee strip */}
      <div className="mateina-marquee relative overflow-hidden bg-forest py-4 text-cream">
        {/* Both copies are aria-hidden (they're a decorative, purely visual
            ticker) with a single sr-only span so screen readers hear the
            message once instead of six repeats times two copies. */}
        <span className="sr-only">Join the #MateinaFamilia</span>
        <div className="mateina-marquee-track flex w-max whitespace-nowrap">
          <span
            aria-hidden="true"
            className="font-display px-4 text-xl uppercase tracking-wide sm:text-2xl"
          >
            {MARQUEE_TEXT}
          </span>
          <span
            aria-hidden="true"
            className="font-display px-4 text-xl uppercase tracking-wide sm:text-2xl"
          >
            {MARQUEE_TEXT}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-24 sm:py-28">
        <m.div
          initial={{ y: 40, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={REVEAL}
          className="grid gap-10 border-t border-forest/15 pt-8 md:grid-cols-[minmax(0,1fr)_2fr] md:gap-16"
        >
          <p className="font-display text-sm uppercase tracking-[0.2em] text-forest/65">
            Project note / 2026
          </p>

          <div>
            <h2 className="font-display max-w-2xl text-4xl uppercase leading-[0.95] tracking-tight text-forest sm:text-6xl">
              An unofficial fan advertisement for Mate&iacute;na.
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-forest/80 sm:text-xl">
              This independent concept explores the energy, color, and culture
              around Mate&iacute;na. It is fan-made, not a brand campaign.
            </p>
            <p className="mt-8 border-l-2 border-forest pl-4 text-sm uppercase tracking-[0.16em] text-forest/70">
              Made with admiration. No endorsements, no affiliation.
            </p>
          </div>
        </m.div>
      </div>
    </section>
  );
}
