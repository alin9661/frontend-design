"use client";

import { motion } from "framer-motion";
import { decor } from "@/lib/flavors";
import { REVEAL } from "@/lib/motion";

const MARQUEE_TEXT = "JOIN THE #MATEINAFAMILIA ★ ".repeat(6);

export default function SocialProof() {
  return (
    <section className="bg-cream">
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

      {/* testimonial */}
      <div className="mx-auto max-w-3xl px-6 py-28 text-center">
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={REVEAL}
        >
          <div
            role="img"
            aria-label="Five out of five stars"
            className="mb-4 flex justify-center gap-1 text-2xl"
            style={{ color: decor.citrusLemon }}
          >
            <span aria-hidden="true">★★★★★</span>
          </div>
          <p className="mb-10 text-sm uppercase tracking-widest text-forest/80">
            Loved by 50,000+ fans
          </p>

          <span
            aria-hidden="true"
            className="font-body block text-7xl leading-none text-forest/15 sm:text-8xl"
          >
            &ldquo;
          </span>

          <blockquote className="mt-2 text-2xl leading-relaxed text-forest sm:text-2xl">
            I&rsquo;ve found it offers the steadiest energy boost without the
            crash, while also keeping me hydrated. Mate&iacute;na stands out
            for its exceptional taste and quality.
          </blockquote>

          <footer className="mt-8">
            <div className="font-display text-lg uppercase tracking-wide text-forest">
              Dr. Andrew Huberman
            </div>
            <div className="mt-1 text-sm text-forest/80">
              Neuroscientist &middot; Host of Huberman Lab
            </div>
          </footer>
        </motion.div>
      </div>
    </section>
  );
}
