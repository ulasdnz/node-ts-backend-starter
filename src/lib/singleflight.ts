const inflight = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` at most once per key at a time: callers asking for a key while a call for it is running
 * share that call's result. Prevents a thundering herd on a cold cache. Scoped to this process.
 */
export const singleflight = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const flight = fn().finally(() => inflight.delete(key));
  inflight.set(key, flight);
  return flight;
};
