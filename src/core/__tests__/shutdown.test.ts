import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShutdownManager } from '../shutdown.js';

const setup = (timeoutMs = 1000) => {
  const manager = createShutdownManager();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const exit = vi.fn();
  const run = (reason = 'SIGTERM') => manager.shutdown(reason, { logger: logger, timeoutMs, exit });
  return { manager, logger, exit, run };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createShutdownManager', () => {
  it('runs hooks in reverse registration order', async () => {
    const { manager, run } = setup();
    const calls: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      manager.onShutdown(name, () => {
        calls.push(name);
      });
    }

    await run();

    expect(calls).toEqual(['c', 'b', 'a']);
  });

  it('keeps running hooks when one fails and exits with 1', async () => {
    const { manager, logger, exit, run } = setup();
    const calls: string[] = [];
    manager.onShutdown('a', () => {
      calls.push('a');
    });
    manager.onShutdown('b', () => {
      throw new Error('quit failed');
    });
    manager.onShutdown('c', async () => {
      calls.push('c');
    });

    await run();

    expect(calls).toEqual(['c', 'a']);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'shutdown.hook.failed', hook: 'b' }),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits with 0 when every hook succeeds', async () => {
    const { manager, exit, run } = setup();
    manager.onShutdown('a', async () => {});

    await run();

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('ignores a second shutdown request', async () => {
    const { manager, logger, run } = setup();
    const hook = vi.fn();
    manager.onShutdown('a', hook);

    await Promise.all([run('SIGTERM'), run('SIGINT')]);

    expect(hook).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'shutdown.duplicate', reason: 'SIGINT' }),
    );
  });

  it('forces exit(1) when hooks exceed the timeout', async () => {
    vi.useFakeTimers();
    const { manager, exit, run } = setup(500);
    manager.onShutdown('stuck', () => new Promise<void>(() => {}));

    void run();
    await vi.advanceTimersByTimeAsync(500);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('reports shutting down as soon as shutdown starts', () => {
    const { manager, run } = setup();
    expect(manager.isShuttingDown()).toBe(false);

    void run();

    expect(manager.isShuttingDown()).toBe(true);
  });
});
