"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import Leaf from "@/components/svg/Leaf";
import Citrus from "@/components/svg/Citrus";
import Berry from "@/components/svg/Berry";
import { brand, flavorById } from "@/lib/flavors";
import { REVEAL } from "@/lib/motion";

const lemon = flavorById("lemon");
const mint = flavorById("mint");
const raspberry = flavorById("raspberry");

type Benefit = {
  title: string;
  body: string;
  Icon: typeof Leaf;
  iconColor: string;
};

const benefits: Benefit[] = [
  {
    title: "ANTIOXIDANTS & NUTRIENTS",
    body: "More than caffeine — yerba mate is rich in antioxidants, vitamins, and minerals that fuel body and mind.",
    Icon: Leaf,
    iconColor: mint.can,
  },
  {
    title: "MENTAL CLARITY & FOCUS",
    body: "Naturally supports alertness, concentration, and a calm, focused state of mind.",
    Icon: Citrus,
    iconColor: lemon.can,
  },
  {
    title: "SMOOTH, SUSTAINED LIFT",
    body: "A clean, balanced boost — without the jitters or crash of coffee and energy drinks.",
    Icon: Berry,
    iconColor: raspberry.can,
  },
];

const container = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { y: 40, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: REVEAL,
  },
};

export default function Benefits() {
  const sectionRef = useRef<HTMLElement>(null);
  // A4 fix: gates the three infinite decorative bobs so they don't keep
  // running for the whole page lifetime while scrolled far offscreen
  // (framer-motion does not pause offscreen animations on its own).
  // `initial: true` assumes visible until the (real) IntersectionObserver
  // says otherwise. Unlike the pre-fix `animate={isInView ? {...} :
  // undefined}`, the out-of-view target below is an explicit REST pose
  // (`y: 0, rotate: 0`), not `undefined` — `undefined` froze the bob at
  // whatever position it happened to be mid-air when it left the viewport
  // and snapped back on re-entry; animating to rest eases home instead.
  const isInView = useInView(sectionRef, { amount: 0.2, initial: true });

  return (
    <section
      ref={sectionRef}
      id="benefits"
      className="relative overflow-hidden bg-forest py-32 text-cream"
    >
      {/* decorative floating leaves */}
      <motion.div
        className="pointer-events-none absolute -left-8 top-16 w-24 opacity-10 sm:w-32"
        aria-hidden="true"
        animate={isInView ? { y: [0, -14, 0], rotate: [0, 6, 0] } : { y: 0, rotate: 0 }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      >
        <Leaf color={brand.cream} />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute right-4 top-1/3 w-16 opacity-10 sm:w-24"
        aria-hidden="true"
        animate={isInView ? { y: [0, 16, 0], rotate: [0, -8, 0] } : { y: 0, rotate: 0 }}
        transition={{ duration: 8.5, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
      >
        <Leaf color={brand.cream} />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute bottom-10 left-1/4 w-14 opacity-10 sm:w-20"
        aria-hidden="true"
        animate={isInView ? { y: [0, -10, 0], rotate: [0, 5, 0] } : { y: 0, rotate: 0 }}
        transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
      >
        <Leaf color={brand.cream} />
      </motion.div>

      <div className="relative mx-auto max-w-6xl px-6">
        <motion.h2
          initial={{ y: 40, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={REVEAL}
          className="font-display text-[clamp(2.5rem,7vw,5.5rem)] uppercase leading-[0.9]"
        >
          BETTER ENERGY STARTS HERE
        </motion.h2>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={container}
          className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {benefits.map(({ title, body, Icon, iconColor }) => (
            <motion.div
              key={title}
              variants={item}
              className="rounded-3xl bg-forest-deep p-8"
            >
              <Icon className="mb-6 h-8 w-8" color={iconColor} />
              <h3 className="font-display text-2xl uppercase leading-[0.95]">
                {title}
              </h3>
              <p className="mt-4 text-base leading-relaxed text-cream/80">
                {body}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
