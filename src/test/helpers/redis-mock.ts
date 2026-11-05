import { vi } from 'vitest';

/**
 * In-memory stand-in for the ioredis commands the request path uses. Expiry arguments are accepted
 * and ignored; behaviour that depends on real Redis semantics (TTLs, Lua, BullMQ) is out of scope.
 */
export function createRedisMock() {
  const store = new Map<string, string>();

  return {
    status: 'ready' as string,
    get: vi.fn(async (key: string): Promise<string | null> => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ..._args: unknown[]): Promise<'OK'> => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]): Promise<number> => {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) removed += 1;
      }
      return removed;
    }),
    ping: vi.fn(async (): Promise<'PONG'> => 'PONG'),
    quit: vi.fn(async (): Promise<'OK'> => 'OK'),
    disconnect: vi.fn(),
    _store: store,
    _clear: () => store.clear(),
  };
}

export type RedisMock = ReturnType<typeof createRedisMock>;
