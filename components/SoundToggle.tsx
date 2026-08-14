// components/SoundToggle.tsx
//
// The opt-in switch for the origin film's procedural soundscape.
//
// This file is deliberately tiny and deliberately has NO static import of
// `lib/audio/soundscape` — the synth graph is pulled in with `await import()`
// inside the enable path only. Web Audio already refuses to make noise outside
// a user gesture, so there is nothing a static import could buy: it would only
// add the whole synth (and the origin timeline it reads) to route "/"'s
// first-load JS for every visitor who never turns sound on. The dynamic edge
// keeps that cost on the people who opted in.
//
// The soundscape's shape is declared locally as `SoundscapeHandle` rather than
// imported as a type, so no edge to that module exists in this file at all.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const SOUNDSCAPE_STORAGE_KEY = "mateina.soundscape";

/** Structural view of `Soundscape` from lib/audio/soundscape.ts. */
export interface SoundscapeHandle {
  start(): Promise<void>;
  setProgress(progress: number): void;
  dispose(): Promise<void>;
}

export interface SoundToggleProps {
  /** Film progress, 0..1. Pushed to the soundscape whenever it changes. */
  progress?: number;
  /**
   * Receives the live soundscape when it starts and `null` when it stops, so a
   * caller with a per-frame progress source (a MotionValue subscription, say)
   * can drive `setProgress` without re-rendering this button.
   */
  onSoundscapeChange?: (soundscape: SoundscapeHandle | null) => void;
  className?: string;
}

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function readStoredPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUNDSCAPE_STORAGE_KEY) === "on";
  } catch {
    // Private-mode Safari and storage-blocked embeds throw on access.
    return false;
  }
}

function writeStoredPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUNDSCAPE_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // A soundscape that can't remember itself is still a working soundscape.
  }
}

export default function SoundToggle({
  progress = 0,
  onSoundscapeChange,
  className,
}: SoundToggleProps) {
  // Always false on the first render, on the server and on the client alike —
  // the stored preference is read in an effect so hydration cannot mismatch.
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const handleRef = useRef<SoundscapeHandle | null>(null);
  const startingRef = useRef(false);
  const progressRef = useRef(progress);
  const changeRef = useRef(onSoundscapeChange);

  /** Turns the control back off after a start that could not be completed, so
   * `aria-pressed` never claims sound that isn't playing. */
  const failStart = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    writeStoredPreference(false);
    changeRef.current?.(null);
  }, []);

  const startSoundscape = useCallback(async () => {
    if (handleRef.current || startingRef.current) return;
    startingRef.current = true;

    const Ctor = audioContextCtor();
    if (!Ctor) {
      startingRef.current = false;
      failStart();
      return;
    }

    // The AudioContext is constructed and resumed HERE — synchronously, before
    // the dynamic import — and handed to the synth ready-made. WebKit only
    // unlocks a context that is created or resumed while it is still
    // processing the user gesture, and `await import()` is a network/parse
    // boundary that ends that window. Constructing it on the far side left
    // iOS with a permanently suspended context: silent audio behind a control
    // already reporting `aria-pressed="true"`.
    let context: AudioContext;
    try {
      context = new Ctor();
      void context.resume?.().catch(() => {});
    } catch {
      startingRef.current = false;
      failStart();
      return;
    }

    try {
      const { createSoundscape } = await import("@/lib/audio/soundscape");
      if (!enabledRef.current) {
        await context.close?.();
        return;
      }

      const soundscape = createSoundscape({ createContext: () => context });
      handleRef.current = soundscape;
      soundscape.setProgress(progressRef.current);
      await soundscape.start();

      if (!enabledRef.current) {
        handleRef.current = null;
        await soundscape.dispose();
        return;
      }

      changeRef.current?.(soundscape);
    } catch {
      // A failed chunk fetch or a rejected start used to escape as an
      // unhandled rejection AND leave the button pressed over silence — the
      // `finally` below only ever reset the in-flight flag.
      handleRef.current = null;
      failStart();
      await context.close?.().catch(() => {});
    } finally {
      startingRef.current = false;
    }
  }, [failStart]);

  const stopSoundscape = useCallback(async () => {
    const soundscape = handleRef.current;
    handleRef.current = null;
    changeRef.current?.(null);
    if (soundscape) await soundscape.dispose();
  }, []);

  // Restore the stored preference. A restored "on" updates the control's state
  // but never starts audio: it arms a one-shot gesture listener instead, so
  // this component can never autoplay, however the visitor arrived.
  useEffect(() => {
    if (!readStoredPreference()) return;

    enabledRef.current = true;
    setEnabled(true);

    const onGesture = () => {
      if (enabledRef.current) void startSoundscape();
    };

    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });

    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [startSoundscape]);

  useEffect(() => {
    changeRef.current = onSoundscapeChange;
  }, [onSoundscapeChange]);

  useEffect(() => {
    progressRef.current = progress;
    handleRef.current?.setProgress(progress);
  }, [progress]);

  useEffect(() => {
    return () => {
      enabledRef.current = false;
      void stopSoundscape();
    };
  }, [stopSoundscape]);

  function toggle() {
    const next = !enabledRef.current;
    enabledRef.current = next;
    setEnabled(next);
    writeStoredPreference(next);

    if (next) void startSoundscape();
    else void stopSoundscape();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      // 44x44 is the WCAG 2.5.8 target minimum, pinned inline so it survives
      // whatever padding a caller passes through `className`.
      style={{ minHeight: 44, minWidth: 44 }}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-full border border-current px-4 font-body text-xs uppercase tracking-[0.18em]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden="true">{enabled ? "((•))" : "(•)"}</span>
      Ambient sound
    </button>
  );
}
