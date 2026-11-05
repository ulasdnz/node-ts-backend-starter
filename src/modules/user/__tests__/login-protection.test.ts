import { describe, expect, it } from 'vitest';
import { RateLimitError } from '../../../core/errors/index.js';
import { createLoginProtection, type LoginProtection } from '../login-protection.js';

const createProtection = () =>
  createLoginProtection({
    maxConsecutiveFails: 3,
    blockDurationSeconds: 900,
    maxFailsPerIpPerDay: 5,
  });

const failRepeatedly = async (
  protection: LoginProtection,
  email: string,
  ip: string,
  times: number,
) => {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await protection.recordFailure(email, ip);
  }
};

describe('createLoginProtection', () => {
  it('blocks the email and IP pair after the configured consecutive failures', async () => {
    const protection = createProtection();
    await failRepeatedly(protection, 'a@example.com', '1.1.1.1', 3);

    const rejection: unknown = await protection
      .assertAllowed('a@example.com', '1.1.1.1')
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(RateLimitError);
    expect(rejection).toMatchObject({ message: 'auth.too_many_attempts' });
    expect((rejection as RateLimitError).retryAfterSeconds).toBeGreaterThan(0);
    expect((rejection as RateLimitError).retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it('keeps counting failures that arrive apart in time', async () => {
    const protection = createProtection();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await protection.recordFailure('spread@example.com', '1.1.1.1');
      // Lets timers run between attempts, as they do between real requests
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await expect(protection.assertAllowed('spread@example.com', '1.1.1.1')).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('allows attempts below the limit', async () => {
    const protection = createProtection();
    await failRepeatedly(protection, 'b@example.com', '1.1.1.1', 2);

    await expect(protection.assertAllowed('b@example.com', '1.1.1.1')).resolves.toBeUndefined();
  });

  it('a successful login resets the consecutive counter', async () => {
    const protection = createProtection();
    await failRepeatedly(protection, 'c@example.com', '1.1.1.1', 2);
    await protection.recordSuccess('c@example.com', '1.1.1.1');
    await failRepeatedly(protection, 'c@example.com', '1.1.1.1', 2);

    await expect(protection.assertAllowed('c@example.com', '1.1.1.1')).resolves.toBeUndefined();
  });

  it('blocking one email and IP pair leaves the same email from another IP alone', async () => {
    const protection = createProtection();
    await failRepeatedly(protection, 'd@example.com', '1.1.1.1', 3);

    await expect(protection.assertAllowed('d@example.com', '2.2.2.2')).resolves.toBeUndefined();
  });

  it('blocks an IP after its daily failure budget across emails', async () => {
    const protection = createProtection();
    for (let index = 0; index < 5; index += 1) {
      await protection.recordFailure(`user${index}@example.com`, '3.3.3.3');
    }

    await expect(protection.assertAllowed('fresh@example.com', '3.3.3.3')).rejects.toMatchObject({
      message: 'auth.too_many_attempts',
    });
  });

  it('treats differently cased emails as the same account', async () => {
    const protection = createProtection();
    await failRepeatedly(protection, 'E@Example.com', '1.1.1.1', 3);

    await expect(protection.assertAllowed(' e@example.com', '1.1.1.1')).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});
