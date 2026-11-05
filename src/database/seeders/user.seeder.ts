import { faker } from '@faker-js/faker';
import { hashPassword } from '../../modules/user/password.js';
import User from '../../modules/user/user.model.js';

/** Every seeded account signs in with this password. Development data only. */
export const SEED_PASSWORD = 'Password123!';
export const SEED_ADMIN_EMAIL = 'admin@example.com';

// A fixed faker seed and reference date give the same people on every run
const FAKER_SEED = 20261105;
const BIRTHDATE_REFERENCE = '2026-01-01T00:00:00Z';

/**
 * Replaces every user with an admin (`admin@example.com`) and `count` regular users
 * (`user1@example.com` onwards), all signing in with SEED_PASSWORD.
 */
export const seedUsers = async (count = 10): Promise<{ adminEmail: string }> => {
  faker.seed(FAKER_SEED);
  const password = await hashPassword(SEED_PASSWORD);

  // A deliberate bypass of the model: soft delete blocks deleteMany() on it, and seeding has to
  // remove soft-deleted users as well, which every model query skips
  await User.collection.deleteMany({});

  const users = Array.from({ length: count }, (_, index) => {
    const gender = faker.helpers.arrayElement(['male', 'female'] as const);
    return {
      name: faker.person.firstName(gender),
      surname: faker.person.lastName(),
      email: `user${index + 1}@example.com`,
      password,
      role: 'user' as const,
      gender,
      countryCode: faker.location.countryCode(),
      birthDate: faker.date.birthdate({
        min: 18,
        max: 65,
        mode: 'age',
        refDate: BIRTHDATE_REFERENCE,
      }),
    };
  });

  await User.insertMany([
    { name: 'Ada', surname: 'Admin', email: SEED_ADMIN_EMAIL, password, role: 'admin' as const },
    ...users,
  ]);

  return { adminEmail: SEED_ADMIN_EMAIL };
};
