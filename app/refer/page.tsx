import type { Metadata, Viewport } from "next";
import ReferralOntology from "@/components/refer/ReferralOntology";

export const metadata: Metadata = {
  title: "Referral Ontology — 1 Unresolved Link",
  description:
    "A five-step enterprise workflow for resolving exactly one link in a personal network graph. The link is a job referral. The enterprise is imaginary.",
};

// The root layout pins themeColor to Mateína cream (app/layout.tsx:39-41).
// Override it here so mobile browser chrome matches the dark console instead
// of framing it in cream.
export const viewport: Viewport = {
  themeColor: "#0A0C10",
};

export default function ReferPage() {
  return <ReferralOntology />;
}
