"use client";

import { useState } from "react";
import { m } from "framer-motion";
import { referral } from "@/lib/referral";
import { REVEAL, CTA_SPRING } from "@/lib/motion";
import ClearanceStep from "./ClearanceStep";
import LinkAnalysisStep from "./LinkAnalysisStep";
import EntityResolutionStep from "./EntityResolutionStep";
import PipelineStep from "./PipelineStep";
import SubmitReferralStep from "./SubmitReferralStep";

// The step machine. `advance` is null on the last step because the payoff
// screen carries its own terminal action (copy to clipboard) instead.
const STEPS = [
  { id: "clearance", label: "Clearance", advance: "Begin Analysis" },
  { id: "link-analysis", label: "Link Analysis", advance: "Resolve Link" },
  { id: "entity-resolution", label: "Entity Resolution", advance: "Commit Object" },
  { id: "pipeline", label: "Pipeline Build", advance: "Deploy Artifact" },
  { id: "submit", label: "Action · Submit Referral", advance: null },
] as const;

export default function ReferralOntology() {
  const [step, setStep] = useState(0);
  // Lives here rather than inside EntityResolutionStep so that all of the
  // step machine's gating logic stays in one readable place.
  const [acknowledged, setAcknowledged] = useState(false);

  const current = STEPS[step];
  const blockedOnAcknowledgement = current.id === "entity-resolution" && !acknowledged;
  const configIncomplete = referral.friend === "FILL_ME";

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-svh bg-console-ink font-mono text-console-dim"
    >
      <div className="mx-auto flex min-h-svh max-w-4xl flex-col px-4 py-6 sm:px-6">
        {configIncomplete ? (
          <p className="mb-4 border border-console-amber px-4 py-3 text-xs text-console-amber">
            Setup — fill in `friend`, `role`, and `resumeUrl` in lib/referral.ts
            before sending this link. This notice disappears on its own.
          </p>
        ) : null}

        <header className="flex flex-wrap items-center justify-between gap-3 border border-console-line px-4 py-3">
          <span className="text-[0.625rem] uppercase tracking-[0.25em] text-console-bright">
            {referral.company} · Referral Ontology
          </span>
          <ol className="flex items-center gap-2" aria-hidden="true">
            {STEPS.map((s, index) => (
              <li
                key={s.id}
                className={`h-1.5 w-1.5 rounded-full ${
                  index === step
                    ? "bg-console-amber"
                    : index < step
                      ? "bg-console-dim"
                      : "bg-console-line"
                }`}
              />
            ))}
          </ol>
        </header>

        <h1 className="mt-6 text-xs uppercase tracking-[0.25em] text-console-bright">
          <span className="text-console-dim">
            Step {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
            {" — "}
          </span>
          {current.label}
        </h1>

        <m.div
          key={current.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={REVEAL}
          className="mt-4 flex-1"
        >
          {current.id === "clearance" ? <ClearanceStep /> : null}
          {current.id === "link-analysis" ? <LinkAnalysisStep /> : null}
          {current.id === "entity-resolution" ? (
            <EntityResolutionStep
              acknowledged={acknowledged}
              onAcknowledgedChange={setAcknowledged}
            />
          ) : null}
          {current.id === "pipeline" ? <PipelineStep /> : null}
          {current.id === "submit" ? <SubmitReferralStep /> : null}
        </m.div>

        <nav className="mt-6 flex items-center justify-between gap-4 border-t border-console-line pt-4">
          <button
            type="button"
            onClick={() => setStep((n) => Math.max(0, n - 1))}
            disabled={step === 0}
            className="text-[0.625rem] uppercase tracking-[0.2em] text-console-dim disabled:opacity-30"
          >
            ← Back
          </button>

          {current.advance ? (
            <m.button
              type="button"
              onClick={() => setStep((n) => Math.min(STEPS.length - 1, n + 1))}
              disabled={blockedOnAcknowledgement}
              whileHover={blockedOnAcknowledgement ? undefined : { scale: 1.02 }}
              whileTap={blockedOnAcknowledgement ? undefined : { scale: 0.98 }}
              transition={CTA_SPRING}
              className="border border-console-amber px-5 py-2.5 text-[0.625rem] uppercase tracking-[0.2em] text-console-amber disabled:border-console-line disabled:text-console-dim/50"
            >
              {blockedOnAcknowledgement
                ? "Acknowledge to continue"
                : `${current.advance} →`}
            </m.button>
          ) : null}
        </nav>

        <p className="mt-6 text-[0.625rem] leading-relaxed text-console-dim/60">
          Unaffiliated parody, made by one friend for another. Not a{" "}
          {referral.company} product, not endorsed by anyone, and connected to no
          system of any kind. No data was ontologized in the making of this page.
        </p>
      </div>
    </main>
  );
}
