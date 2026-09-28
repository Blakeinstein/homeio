import "server-only";

export type MemoizedAsync<T> = (() => Promise<T>) & {
  /**
   * Forgets the cached value, after the thing it describes has been changed.
   * A call already in flight started before the change: its result is not kept.
   */
  invalidate(): void;
};

/**
 * Reuses the result of `load` for `ttlMs`, and lets concurrent callers share the
 * call in flight. An expensive probe (one that spawns commands, say) then runs
 * at most once per `ttlMs`, however many requests and streams ask for it.
 *
 * A call that throws is not cached: the next caller tries again.
 */
export function memoizeAsync<T>(load: () => Promise<T>, ttlMs: number): MemoizedAsync<T> {
  let cached: { value: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;
  let generation = 0;

  const memoized = () => {
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.value);
    }
    if (inFlight) return inFlight;

    const startedIn = generation;
    const call = load()
      .then((value) => {
        if (startedIn === generation) {
          cached = { value, expiresAt: Date.now() + ttlMs };
        }
        return value;
      })
      .finally(() => {
        if (inFlight === call) inFlight = null;
      });
    inFlight = call;
    return call;
  };

  memoized.invalidate = () => {
    generation += 1;
    cached = null;
    inFlight = null;
  };

  return memoized;
}
