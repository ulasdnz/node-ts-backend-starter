import { describe, expect, it, vi } from 'vitest';
import { singleflight } from '../singleflight.js';

describe('singleflight', () => {
  it('shares one execution between concurrent callers', async () => {
    let resolve!: (value: string) => void;
    const load = vi.fn(
      () =>
        new Promise<string>((settle) => {
          resolve = settle;
        }),
    );

    const calls = [singleflight('key', load), singleflight('key', load), singleflight('key', load)];
    resolve('value');

    await expect(Promise.all(calls)).resolves.toEqual(['value', 'value', 'value']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('releases the key after a failure', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');

    await expect(singleflight('flaky', load)).rejects.toThrow('boom');
    await expect(singleflight('flaky', load)).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
