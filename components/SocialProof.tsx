"use client";

import { motion, useReducedMotion } from "framer-motion";

const MARQUEE_TEXT = "JOIN THE #MATEINAFAMILIA ★ ".repeat(6);

export default function SocialProof() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="bg-cream">
      {/* marquee strip */}
      <div className="relative overflow-hidden bg-forest py-4 text-cream">
        <style>{`
          @keyframes mateina-marquee {
            from { transform: translateX(0); }
            to { transform: translateX(-50%); }
          }
          .mateina-marquee-track {
            animation: mateina-marquee 18s linear infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .mateina-marquee-track {
              animation-play-state: paused;
            }
          }
        `}</style>
        <div className="mateina-marquee-track flex w-max whitespace-nowrap">
          <span className="font-display px-4 text-xl uppercase tracking-wide sm:text-2xl">
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
          initial={reduceMotion ? undefined : { y: 40, opacity: 0 }}
          whileInView={reduceMotion ? undefined : { y: 0, opacity: 1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            role="img"
            aria-label="Five out of five stars"
            className="mb-4 flex justify-center gap-1 text-2xl"
            style={{ color: "#F2C94C" }}
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
