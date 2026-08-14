"use client";

import { referral } from "@/lib/referral";
import TerminalLog, { type LogLine } from "./TerminalLog";
import { TitledPanel } from "./ConsoleChrome";

const lines: LogLine[] = [
  { text: "> initializing REFERRAL ONTOLOGY v4.7.2 (build 88301)" },
  { text: "> establishing secure channel .................. OK", tone: "ok" },
  { text: `> verifying operator identity: ${referral.friend.toUpperCase()}` },
  { text: "> cross-referencing badge photo vs LinkedIn .... MATCH (0.87)", tone: "ok" },
  { text: "> checking operator job title .................. NONE FOUND" },
  { text: "> re-checking operator job title ............... NONE FOUND" },
  { text: ">   note: this is correct and intentional" },
  { text: "> loading ontology: PERSONAL_NETWORK" },
  { text: ">   objects: 1,204     links: 8,891" },
  { text: ">   unresolved links: 1", tone: "warn" },
  { text: "> WARNING: unresolved link is 4 years old", tone: "warn" },
  { text: "> escalating to operator.", tone: "ok" },
];

export default function ClearanceStep() {
  return (
    <TitledPanel title="Secure Session" aside="Clearance Granted">
      <TerminalLog lines={lines} />
    </TitledPanel>
  );
}
