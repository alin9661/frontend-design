"use client";

import { motion, useReducedMotion, useTransform } from "framer-motion";
import ParallaxScene, { useParallax, PARALLAX_SHIFT_PX } from "@/components/ParallaxScene";
import FloatingItem from "@/components/FloatingItem";
import { CTA_SPRING, REVEAL } from "@/lib/motion";
import Leaf from "@/components/svg/Leaf";
import Citrus from "@/components/svg/Citrus";
import Berry from "@/components/svg/Berry";
import Can from "@/components/svg/Can";
import { flavorById, decor } from "@/lib/flavors";

const mint = flavorById("mint");
const raspberry = flavorById("raspberry");

const container = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 40 },
  show: {
    opacity: 1,
    y: 0,
    transition: { ...REVEAL, duration: 0.7 },
  },
};

// Headline gets a whisper of its own parallax (depth 0.3) so it feels
// cohesive with the floating field around it, without leaving flow.
function HeadlineParallax() {
  const reduceMotion = useReducedMotion();
  const { mx, my } = useParallax();
  const depth = 0.3;
  const translateX = useTransform(mx, (v) => v * depth * PARALLAX_SHIFT_PX);
  const translateY = useTransform(my, (v) => v * depth * PARALLAX_SHIFT_PX);

  return (
    <motion.h1
      variants={item}
      style={
        reduceMotion ? undefined : { x: translateX, y: translateY }
      }
      className="font-display uppercase text-forest text-[clamp(2.5rem,10.5vw,9.5rem)] leading-[0.9] text-center w-screen max-w-none px-6"
    >
      <span className="block whitespace-nowrap">SMOOTH LIFT.</span>
      <span className="block whitespace-nowrap">ZERO CRASH.</span>
    </motion.h1>
  );
}

export default function Hero() {
  return (
    <section className="relative min-h-svh bg-cream overflow-hidden">
      <ParallaxScene className="min-h-svh w-full flex items-center justify-center px-6">
        {/* Depth-blurred blob behind headline */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-forest/10 blur-3xl"
        />

        {/* ---------- Floating decor field ---------- */}

        {/* Depth tier 0.6 (far/subtle) */}
        <FloatingItem
          depth={0.6}
          x="8%"
          y="14%"
          className="hidden md:block w-16 md:w-20"
        >
          <Leaf color={decor.leafDark} className="w-full -rotate-[18deg]" />
        </FloatingItem>
        <FloatingItem
          depth={0.6}
          x="88%"
          y="10%"
          className="hidden md:block w-14 md:w-16"
        >
          <Leaf color={decor.leafLight} className="w-full rotate-[24deg]" />
        </FloatingItem>
        <FloatingItem
          depth={0.6}
          x="4%"
          y="70%"
          className="hidden md:block w-24 md:w-28"
        >
          <Leaf color={decor.leafLight} className="w-full rotate-[10deg]" />
        </FloatingItem>
        <FloatingItem
          depth={0.6}
          x="92%"
          y="66%"
          className="hidden md:block w-10 md:w-12"
        >
          <Citrus color={decor.citrusLemon} className="w-full -rotate-[12deg]" />
        </FloatingItem>

        {/* Depth tier 1.2 (mid) */}
        <FloatingItem
          depth={1.2}
          x="16%"
          y="24%"
          className="hidden md:block w-10 md:w-14"
        >
          <Leaf color={decor.leafDark} className="w-full rotate-[8deg]" />
        </FloatingItem>
        <FloatingItem
          depth={1.2}
          x="80%"
          y="30%"
          className="hidden md:block w-16 md:w-20"
        >
          <Berry color={decor.berry} className="w-full -rotate-[6deg]" />
        </FloatingItem>
        <FloatingItem
          depth={1.2}
          x="10%"
          y="50%"
          className="hidden md:block w-8 md:w-10"
        >
          <Citrus color={decor.citrusPeach} className="w-full rotate-[16deg]" />
        </FloatingItem>
        <FloatingItem depth={1.2} x="5%" y="62%" className="w-fit">
          <Can
            body={mint.can}
            accent={mint.accent}
            label={mint.name}
            className="h-56 md:h-80 w-auto -rotate-[8deg] drop-shadow-xl"
          />
        </FloatingItem>

        {/* Depth tier 2 (near) */}
        <FloatingItem
          depth={2}
          x="24%"
          y="8%"
          className="hidden md:block w-8"
        >
          <Leaf color={decor.leafLight} className="w-full -rotate-[30deg]" />
        </FloatingItem>
        <FloatingItem depth={1.6} x="85%" y="60%" className="w-fit">
          <Can
            body={raspberry.can}
            accent={raspberry.accent}
            label={raspberry.name}
            className="h-48 md:h-80 w-auto rotate-[10deg] drop-shadow-xl"
          />
        </FloatingItem>

        {/* ---------- Center content ---------- */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center text-center"
        >
          <motion.p
            variants={item}
            className="font-body tracking-[0.15em] min-[380px]:tracking-[0.2em] md:tracking-[0.3em] text-xs md:text-sm text-forest/80 mb-6 whitespace-normal min-[380px]:whitespace-nowrap"
          >
            ORGANIC YERBA MATE · ZERO SUGAR
          </motion.p>

          <HeadlineParallax />

          <motion.p
            variants={item}
            className="font-body max-w-xl mx-auto mt-8 text-base md:text-lg text-forest/80"
          >
            Clean, sustained energy brewed from organic yerba mate grown in
            the forests of Misiones, Argentina. No sugar. No jitters. No
            compromise.
          </motion.p>

          <motion.div
            variants={item}
            className="mt-10 flex flex-col sm:flex-row items-center gap-6"
          >
            <motion.a
              href="#flavors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
              transition={CTA_SPRING}
              className="inline-flex items-center justify-center rounded-full bg-forest px-10 py-4 font-display uppercase tracking-wide text-cream text-lg"
            >
              SHOP THE FLAVORS
            </motion.a>
            <a
              href="#benefits"
              className="font-body text-sm tracking-[0.15em] uppercase text-forest/80 underline underline-offset-4 decoration-forest/40 transition-colors hover:text-forest"
            >
              WHAT IS YERBA MATE? ↓
            </a>
          </motion.div>
        </motion.div>
      </ParallaxScene>
    </section>
  );
}
