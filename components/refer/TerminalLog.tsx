"use client";

import { useTimedLog } from "./useTimedLog";

export type LogLine = {
  text: string;
  /** `warn` renders amber, `ok` renders bright. Default is dim body text. */
  tone?: "warn" | "ok";
};

const TONE_CLASS: Record<NonNullable<LogLine["tone"]>, string> = {
  warn: "text-console-amber",
  ok: "text-console-bright",
};

const LINE_DELAY_MS = 180;

/**
 * A fake terminal that types itself out. Shared by the CLEARANCE and
 * PIPELINE BUILD steps so both inherit the same reduced-motion behavior from
 * useTimedLog (see that file for why the timer has to gate itself).
 *
 * The whole log is announced as one `aria-live="polite"` region rather than
 * per-line, so a screen reader gets the finished text once instead of a
 * ten-line stutter.
 */
export default function TerminalLog({ lines }: { lines: LogLine[] }) {
  const visible = useTimedLog(lines.length, LINE_DELAY_MS);

  return (
    <div
      aria-live="polite"
      className="min-h-[15rem] overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed sm:text-sm"
    >
      {lines.slice(0, visible).map((line) => (
        <p key={line.text} className={line.tone ? TONE_CLASS[line.tone] : undefined}>
          {line.text}
        </p>
      ))}
      {visible < lines.length ? (
        <span aria-hidden="true" className="text-console-amber">
          ▋
        </span>
      ) : null}
    </div>
  );
}
