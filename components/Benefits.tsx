"use client";

import { m, useReducedMotion } from "framer-motion";
import Leaf from "@/components/svg/Leaf";
import Citrus from "@/components/svg/Citrus";
import Berry from "@/components/svg/Berry";
import { flavorById } from "@/lib/flavors";
import { REVEAL, REVEAL_SLOW } from "@/lib/motion";

const lemon = flavorById("lemon");
const mint = flavorById("mint");
const raspberry = flavorById("raspberry");

const benefitCopy = [
  {
    title: "ANTIOXIDANTS & NUTRIENTS",
    body: "More than caffeine — yerba mate brings antioxidants, vitamins, and minerals to the pour.",
  },
  {
    title: "MENTAL CLARITY & FOCUS",
    body: "Naturally supports alertness, concentration, and a calm, focused state of mind.",
  },
  {
    title: "SMOOTH, SUSTAINED LIFT",
    body: "A clean, balanced boost — without the jitters or crash of coffee and energy drinks.",
  },
] as const;

type RevealProps = {
  children: React.ReactNode;
  className?: string;
  slow?: boolean;
  animated: boolean;
};

function Reveal({ children, className, slow = false, animated }: RevealProps) {
  if (!animated) return <div className={className}>{children}</div>;

  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 48 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={slow ? REVEAL_SLOW : REVEAL}
    >
      {children}
    </m.div>
  );
}

function BenefitsLayout({ animated }: { animated: boolean }) {
  const [density, focus, sustained] = benefitCopy;

  return (
    <section
      id="benefits"
      data-benefits-mode={animated ? "animated" : "static"}
      className="relative overflow-hidden text-cream"
    >
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-forest" />
      <div className="border-b border-cream/20 px-6 py-16 sm:px-10 lg:px-16">
        <Reveal animated={animated} slow className="mx-auto max-w-7xl">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-cream/65">
            What the leaf carries
          </p>
          <h2 className="mt-5 max-w-5xl font-display text-[clamp(2.7rem,7vw,6.5rem)] uppercase leading-[0.84]">
            Yerba mate carries more than caffeine.
          </h2>
        </Reveal>
      </div>

      <article className="relative grid min-h-[100svh] overflow-hidden border-b border-cream/20 px-6 py-20 sm:px-10 lg:grid-cols-12 lg:px-16">
        <Reveal
          animated={animated}
          slow
          className="pointer-events-none absolute -left-[28vw] top-1/2 w-[76vw] -translate-y-1/2 sm:-left-[17vw] sm:w-[58vw] lg:-left-[12vw] lg:w-[48vw]"
        >
          <div aria-hidden="true" data-benefit-art="leaf">
            <Leaf className="h-auto w-full" color={mint.can} />
          </div>
        </Reveal>
        <Reveal animated={animated} className="relative z-10 self-center lg:col-span-5 lg:col-start-8">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-cream/65">
            01 / whole-leaf density
          </p>
          {/* Flavor accents are product data in lib/flavors.ts, not @theme tokens,
              so they are applied inline. A `text-mint` class would silently
              resolve to nothing under Tailwind v4. */}
          <p
            style={{ color: mint.can }}
            className="mt-8 font-display text-[clamp(5rem,13vw,11rem)] leading-none"
          >
            196
          </p>
          <p className="max-w-[12rem] text-sm uppercase tracking-[0.18em] text-cream/70">
            plant compounds in yerba mate
          </p>
          <h3 className="mt-10 max-w-md font-display text-[clamp(2.4rem,4.2vw,4.5rem)] uppercase leading-[0.86]">
            {density.title}
          </h3>
          <p className="mt-5 max-w-md text-base leading-relaxed text-cream/80 sm:text-lg">
            {density.body}
          </p>
        </Reveal>
      </article>

      <article className="relative grid min-h-[100svh] overflow-hidden border-b border-cream/20 px-6 py-20 sm:px-10 lg:grid-cols-12 lg:px-16">
        <Reveal
          animated={animated}
          slow
          className="pointer-events-none absolute -right-[20vw] -top-[17vw] w-[72vw] rotate-[24deg] sm:-right-[12vw] sm:-top-[20vw] sm:w-[54vw] lg:-right-[6vw] lg:-top-[16vw] lg:w-[42vw]"
        >
          <div aria-hidden="true" data-benefit-art="citrus">
            <Citrus className="h-auto w-full" color={lemon.can} />
          </div>
        </Reveal>
        <Reveal animated={animated} className="relative z-10 self-end lg:col-span-6 lg:col-start-2 lg:self-end lg:pb-10">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-cream/65">
            02 / point forward
          </p>
          <div
            style={{ color: lemon.can }}
            className="mt-10 flex items-center gap-4"
            aria-label="Focus moving forward"
          >
            <span className="font-display text-2xl uppercase">Focus</span>
            <span aria-hidden="true" className="h-px w-24 bg-current sm:w-40" />
            <span aria-hidden="true" className="text-4xl leading-none">→</span>
          </div>
          <h3 className="mt-10 max-w-xl font-display text-[clamp(2.4rem,4.8vw,5rem)] uppercase leading-[0.86]">
            {focus.title}
          </h3>
          <p className="mt-5 max-w-md text-base leading-relaxed text-cream/80 sm:text-lg">
            {focus.body}
          </p>
        </Reveal>
      </article>

      <article className="relative grid min-h-[100svh] overflow-hidden px-6 py-20 sm:px-10 lg:grid-cols-12 lg:px-16">
        <Reveal animated={animated} className="relative z-10 lg:col-span-7 lg:col-start-3">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-cream/65">
            03 / avoid the spike
          </p>
          <h3 className="mt-8 max-w-3xl font-display text-[clamp(2.6rem,5.8vw,6rem)] uppercase leading-[0.86]">
            {sustained.title}
          </h3>
          <p className="mt-5 max-w-md text-base leading-relaxed text-cream/80 sm:text-lg">
            {sustained.body}
          </p>
          <div style={{ color: raspberry.can }} className="mt-12 max-w-lg">
            <div className="flex items-end justify-between font-display text-sm uppercase tracking-[0.16em]">
              <span>Now</span>
              <span>Later</span>
            </div>
            <div
              style={{ backgroundColor: raspberry.can }}
              className="mt-3 h-px"
            />
            <p className="mt-3 text-xs uppercase tracking-[0.2em] text-cream/65">
              A longer arc, not a sharp drop
            </p>
          </div>
        </Reveal>
        <Reveal
          animated={animated}
          slow
          className="pointer-events-none absolute bottom-[-5vw] left-1/2 w-40 -translate-x-1/2 sm:w-52 lg:w-64"
        >
          <div aria-hidden="true" data-benefit-art="berry">
            <Berry className="h-auto w-full" color={raspberry.can} />
          </div>
        </Reveal>
      </article>
    </section>
  );
}

export default function Benefits() {
  const prefersReducedMotion = useReducedMotion();

  return <BenefitsLayout animated={!prefersReducedMotion} />;
}
