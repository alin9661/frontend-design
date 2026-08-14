"use client";

import { m } from "framer-motion";
import { referral } from "@/lib/referral";
import { EASE_OUT } from "@/lib/motion";
import { TitledPanel } from "./ConsoleChrome";

// Hand-authored graph geometry. Three objects, three links, one of them
// dangling — the dangling one is the entire point of the page.
const NODES = [
  { id: "candidate", x: 20, y: 130, label: referral.candidate.toUpperCase() },
  { id: "friend", x: 300, y: 40, label: referral.friend.toUpperCase() },
  { id: "company", x: 300, y: 220, label: referral.company.toUpperCase() },
] as const;

const NODE_W = 120;
const NODE_H = 40;

function GraphNode({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        className="fill-console-ink stroke-console-dim"
        strokeWidth={1}
      />
      <text
        x={x + NODE_W / 2}
        y={y + NODE_H / 2 + 4}
        textAnchor="middle"
        className="fill-console-bright font-mono"
        fontSize={11}
        letterSpacing={1.5}
      >
        {label}
      </text>
    </g>
  );
}

const drawEdge = (delay: number) => ({
  initial: { pathLength: 0 },
  animate: { pathLength: 1 },
  transition: { duration: 0.7, ease: EASE_OUT, delay },
});

/** Edge labels sit directly on top of the lines they name, so each one gets an
 *  ink-filled plate punched behind it — the same trick real link-analysis tools
 *  use. Monospace at this size runs ~6.4px per character. */
function EdgeLabel({
  x,
  y,
  text,
  accent = false,
  anchor = "middle",
}: {
  x: number;
  y: number;
  text: string;
  accent?: boolean;
  anchor?: "middle" | "start";
}) {
  const width = text.length * 6.4 + 10;
  return (
    <g>
      <rect
        x={anchor === "middle" ? x - width / 2 : x - 5}
        y={y - 9}
        width={width}
        height={13}
        className="fill-console-ink"
      />
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        className={accent ? "fill-console-amber font-mono" : "fill-console-dim font-mono"}
        fontSize={9}
        letterSpacing={1}
      >
        {text}
      </text>
    </g>
  );
}

export default function LinkAnalysisStep() {
  const { candidate, friend, company } = referral;

  return (
    <TitledPanel title="Subgraph · Personal Network" aside="1 Link Unresolved">
      <svg
        viewBox="0 20 440 260"
        className="h-auto w-full"
        role="img"
        aria-label={`Link analysis graph. ${candidate} knows ${friend} with confidence 0.94. ${friend} is employed by ${company}. The link between ${candidate} and ${company} is unresolved.`}
      >
        {/* candidate ── knows ── friend */}
        <m.line
          x1={140}
          y1={150}
          x2={300}
          y2={60}
          className="stroke-console-dim"
          strokeWidth={1}
          {...drawEdge(0)}
        />
        {/* friend ── employed_by ── company */}
        <m.line
          x1={360}
          y1={80}
          x2={360}
          y2={220}
          className="stroke-console-dim"
          strokeWidth={1}
          {...drawEdge(0.15)}
        />
        {/* candidate ╌╌ ? ╌╌ company — the unresolved one. Fades in rather
            than drawing in: framer-motion implements `pathLength` by writing
            strokeDasharray itself, which silently overrides the dashes that
            are the entire visual point of this edge.
            The fade lives on a wrapping <g> because opacity on a bare SVG
            <line> is a presentation attribute, not a style — framer-motion
            reads back `undefined` for it and warns that it can't animate. */}
        <m.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.3 }}
        >
          <line
            x1={140}
            y1={160}
            x2={300}
            y2={245}
            className="stroke-console-amber"
            strokeWidth={1.5}
            strokeDasharray="5 5"
          />
        </m.g>

        <EdgeLabel x={214} y={96} text="KNOWS (0.94)" />
        <EdgeLabel x={370} y={154} text="EMPLOYED_BY" anchor="start" />
        <EdgeLabel x={214} y={207} text="? ? ? UNRESOLVED" accent />

        {NODES.map((node) => (
          <GraphNode key={node.id} x={node.x} y={node.y} label={node.label} />
        ))}
      </svg>

      <p className="mt-4 border-t border-console-line pt-4 text-sm leading-relaxed text-console-dim">
        One (1) link in this subgraph remains unresolved. {company}&apos;s entire
        stated mission is, and has always been, resolving links between objects
        that obviously belong together.
      </p>
    </TitledPanel>
  );
}
