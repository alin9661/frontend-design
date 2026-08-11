// DECISION POINT: everything personal about the ask lives here. Fill in the
// three FILL_ME values below and the whole page follows — console headers,
// graph node labels, and the blurb the final button copies to the clipboard.
//
// Swapping `friend` is also how you re-aim this page at a different person
// without touching a single component.

export type ReferralConfig = {
  /** The person being referred. Rendered as a graph node and named in the blurb. */
  candidate: string;
  /** The person being asked. Addressed directly on the final step. */
  friend: string;
  /** Role being targeted. Doubles as the punchline on step 1. */
  role: string;
  /** Employer — the third node in the graph. */
  company: string;
  /** Optional. When omitted, the blurb drops its résumé line entirely. */
  resumeUrl?: string;
  /** How the friend's recruiter reaches the candidate. */
  contact: string;
};

export const referral: ReferralConfig = {
  candidate: "Aaron Lin",
  friend: "FILL_ME", // ← your friend's first name, e.g. "Priya"
  role: "Forward Deployed Engineer",
  company: "Palantir",
  resumeUrl: undefined, // ← optional, e.g. "https://aaronlin.dev/resume.pdf"
  contact: "aaronlin098@gmail.com",
};

/**
 * Builds the text the final button drops on the clipboard. Written in the
 * friend's voice, because they're the one pasting it into the internal
 * referral form.
 *
 * Pure (config in, string out) so the one part of this page that actually has
 * to be correct is cheap to test — the jokes can live in JSX where tests would
 * only be brittle.
 */
export function buildReferralBlurb(config: ReferralConfig): string {
  const { candidate, role, contact, resumeUrl } = config;

  // Deliberately pronoun-free beyond they/them: this is a template, and it
  // should read correctly whoever `candidate` ends up being.
  const lines = [
    `Referring ${candidate} for ${role}.`,
    "",
    `I've worked alongside ${candidate} and would vouch for them without hedging — careful, finishes what they start, and exactly who I'd want debugging something with me at 2am.`,
  ];

  if (resumeUrl) {
    lines.push("", `Résumé: ${resumeUrl}`);
  }

  lines.push("", `Best way to reach them: ${contact}`);

  return lines.join("\n");
}
