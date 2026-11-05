import bcrypt from 'bcryptjs';
import { config } from '../../config/index.js';

export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, config.BCRYPT_SALT_ROUNDS);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

let dummyHash: Promise<string> | undefined;

/**
 * Does the same bcrypt work as a real check when there is no account to check against, so response
 * times do not reveal which emails are registered. The dummy hash uses the configured cost, created
 * once on first use. Always resolves false.
 */
export const verifyAgainstDummyHash = async (plain: string): Promise<false> => {
  dummyHash ??= bcrypt.hash('placeholder-password-for-timing', config.BCRYPT_SALT_ROUNDS);
  await bcrypt.compare(plain, await dummyHash);
  return false;
};
