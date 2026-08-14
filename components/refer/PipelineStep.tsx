"use client";

import TerminalLog, { type LogLine } from "./TerminalLog";
import { TitledPanel } from "./ConsoleChrome";

const TRANSFORMS = [
  "RESUME.pdf",
  "strip_buzzwords",
  "detect_actual_skills",
  "add_buzzwords",
  "REFERRAL",
] as const;

const lines: LogLine[] = [
  { text: "> building pipeline: referral_v1" },
  { text: "> compiling transform: strip_buzzwords" },
  { text: '>   removed "synergy" ......... 0 occurrences' },
  { text: '>   removed "rockstar" ........ 0 occurrences' },
  { text: '>   removed "10x" ............. 0 occurrences' },
  { text: ">   input was already clean. suspicious." },
  { text: "> compiling transform: detect_actual_skills" },
  { text: ">   found: TypeScript, React, systems debugging", tone: "ok" },
  { text: '>   found: "can be trusted with prod"', tone: "ok" },
  { text: "> compiling transform: add_buzzwords" },
  { text: ">   skipped at operator's request" },
  { text: "> BUILD SUCCEEDED in 0.4s", tone: "ok" },
  { text: "> 1 artifact ready for deployment: REFERRAL", tone: "warn" },
];

export default function PipelineStep() {
  return (
    <div className="flex flex-col gap-4">
      <TitledPanel title="Transform Chain" aside="5 Stages">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-3 font-mono text-xs">
          {TRANSFORMS.map((name, index) => (
            <li key={name} className="flex items-center gap-2">
              <span
                className={`border px-2.5 py-1.5 ${
                  index === 0 || index === TRANSFORMS.length - 1
                    ? "border-console-amber text-console-amber"
                    : "border-console-line text-console-bright"
                }`}
              >
                {name}
              </span>
              {index < TRANSFORMS.length - 1 ? (
                <span aria-hidden="true" className="text-console-dim">
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </TitledPanel>

      <TitledPanel title="Build Output" aside="Exit 0">
        <TerminalLog lines={lines} />
      </TitledPanel>
    </div>
  );
}
