import { describe, expect, it } from 'vitest';
import { verifyPassword } from '../../../modules/user/password.js';
import User from '../../../modules/user/user.model.js';
import { setupTestDatabase } from '../../../test/helpers/database.js';
import { SEED_PASSWORD, seedUsers } from '../user.seeder.js';

setupTestDatabase();

describe('seedUsers', () => {
  it('creates the admin and the requested number of users', async () => {
    const { adminEmail } = await seedUsers(3);

    const admin = await User.findOne({ email: adminEmail }).select('+password').orFail();

    expect(adminEmail).toBe('admin@example.com');
    expect(admin.role).toBe('admin');
    expect(await verifyPassword(SEED_PASSWORD, admin.password)).toBe(true);
    expect(await User.countDocuments({ role: 'user' })).toBe(3);
  });

  it('replaces previous seed data when run again', async () => {
    await seedUsers(3);
    const firstEmails = (await User.find().sort({ email: 1 })).map((user) => user.email);

    await seedUsers(3);

    expect(await User.countDocuments()).toBe(4);
    expect((await User.find().sort({ email: 1 })).map((user) => user.email)).toEqual(firstEmails);
  });

  it('also clears soft-deleted users', async () => {
    const { adminEmail } = await seedUsers(1);
    const admin = await User.findOne({ email: adminEmail }).orFail();
    await User.softDeleteById(admin.id);

    await seedUsers(1);

    expect(await User.countDocuments().withDeleted()).toBe(2);
  });
});
