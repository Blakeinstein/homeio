import "server-only";

/**
 * Reuses the result of `load` for `ttlMs`, and lets concurrent callers share the
 * call in flight. An expensive probe (one that spawns commands, say) then runs
 * at most once per `ttlMs`, however many requests and streams ask for it.
 *
 * A call that throws is not cached: the next caller tries again.
 */
export function memoizeAsync<T>(load: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let cached: { value: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;

  return function memoized() {
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.value);
    }

    inFlight ??= load()
      .then((value) => {
        cached = { value, expiresAt: Date.now() + ttlMs };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };
}
