"use client";

import { useState } from "react";
import { m } from "framer-motion";
import { referral, buildReferralBlurb } from "@/lib/referral";
import { CTA_SPRING } from "@/lib/motion";
import { TitledPanel, FieldLabel } from "./ConsoleChrome";

type CopyStatus = "idle" | "copied" | "failed";

export default function SubmitReferralStep() {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const { friend, role, company } = referral;
  const blurb = buildReferralBlurb(referral);

  async function copyBlurb() {
    // jsdom, insecure origins, and older Safari all lack this. Surfacing a
    // failure state matters more than usual here: the clipboard IS the
    // delivery mechanism, so a silent no-op would look like a working button
    // and quietly lose the entire point of the page.
    if (!navigator.clipboard?.writeText) {
      setStatus("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(blurb);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <TitledPanel title="Action · Submit_Referral" aside="Awaiting Operator">
      <div className="max-w-2xl space-y-4 text-sm leading-relaxed text-console-bright">
        <p>This is the part where the tool stops pretending.</p>
        <p>
          {friend} — I&apos;d genuinely love a referral for{" "}
          <span className="text-console-amber">{role}</span> at {company}.
          Below is a blurb you can paste straight into the internal form. Edit
          it, ignore it, or delete the whole thing and write two honest
          sentences instead — any of those help more than this page did.
        </p>
        <p className="text-console-dim">
          And if it&apos;s a bad time, or you&apos;d rather not put your name on
          it, that is a completely fine answer. Say no and we never speak of the
          ontology again.
        </p>
      </div>

      <div className="mt-6">
        <FieldLabel>Referral Payload</FieldLabel>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap border border-console-line p-4 font-mono text-xs leading-relaxed text-console-dim">
          {blurb}
        </pre>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <m.button
          type="button"
          onClick={copyBlurb}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={CTA_SPRING}
          className="border border-console-amber bg-console-amber px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-console-ink"
        >
          Submit Referral
        </m.button>

        <span aria-live="polite" className="text-xs uppercase tracking-[0.2em]">
          {status === "copied" ? (
            <span className="text-console-amber">
              Committed · 1 link resolved
            </span>
          ) : null}
          {status === "failed" ? (
            <span className="text-console-bright">
              Clipboard unavailable — copy the payload above manually
            </span>
          ) : null}
        </span>
      </div>
    </TitledPanel>
  );
}
