import { describe, expect, it } from 'vitest';
import { registerSchema } from '../user.validators.js';

const registration = { name: 'Valid', surname: 'User', email: 'valid@example.com' };

describe('registerSchema', () => {
  it('accepts a 64-character ASCII password', () => {
    expect(registerSchema.safeParse({ ...registration, password: 'a'.repeat(64) }).success).toBe(
      true,
    );
  });

  it('rejects a 65-character password', () => {
    const result = registerSchema.safeParse({ ...registration, password: 'a'.repeat(65) });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'validation.password_policy_max',
    );
  });

  it('rejects a password over 72 UTF-8 bytes even within 64 characters', () => {
    // bcrypt ignores everything after the first 72 bytes; 40 × "ş" is 80 bytes
    const result = registerSchema.safeParse({ ...registration, password: 'ş'.repeat(40) });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'validation.password_policy_bytes',
    );
  });

  it('normalizes the email to lower case without surrounding spaces', () => {
    const parsed = registerSchema.parse({
      ...registration,
      email: '  Valid@Example.COM ',
      password: 'a'.repeat(8),
    });

    expect(parsed.email).toBe('valid@example.com');
  });
});
