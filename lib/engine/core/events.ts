// lib/engine/core/events.ts
//
// Tiny typed emitter (design doc §4, core/events.ts) used internally by
// scroll.ts and any other core module that needs a subscribe/unsubscribe
// event surface without pulling in a dependency. Pure TS — no DOM.

/** Map of event name -> payload type, e.g. `{ scroll: ScrollState }`. Any
 * plain object shape works as `Events` — this alias is just documentation,
 * not a generic constraint (constraining against `Record<string, unknown>`
 * would force every `Events` interface to declare an index signature). */
export type EventMap = Record<string, unknown>;

export type Listener<T> = (payload: T) => void;

export class Emitter<Events> {
  private listeners = new Map<keyof Events, Set<Listener<Events[keyof Events]>>>();

  /** Subscribes `cb` to `event`. Returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, cb: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as Listener<Events[keyof Events]>);
    return () => this.off(event, cb);
  }

  /** Removes a specific listener from `event`. Safe to call if not subscribed. */
  off<K extends keyof Events>(event: K, cb: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(cb as Listener<Events[keyof Events]>);
  }

  /** Synchronously invokes every listener subscribed to `event`. */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot: a listener unsubscribing itself (or another listener)
    // mid-emit must not affect this dispatch pass.
    for (const cb of [...set]) {
      (cb as Listener<Events[K]>)(payload);
    }
  }

  /** Removes every listener from every event. */
  clear(): void {
    this.listeners.clear();
  }
}
