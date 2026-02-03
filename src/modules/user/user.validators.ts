import { z } from 'zod';
import { objectIdSchema } from '../../utils/validators.js';

const emailSchema = z.email({ message: 'validation.email_invalid' });

const nameSchema = z
  .string({ message: 'validation.name_required' })
  .trim()
  .min(2, { message: 'validation.name_min' })
  .max(24, { message: 'validation.name_max' });

const surnameSchema = z
  .string({ message: 'validation.surname_required' })
  .trim()
  .min(1, { message: 'validation.surname_required' });

const passwordPolicySchema = z
  .string({ message: 'validation.password_required' })
  .min(8, { message: 'validation.password_policy_min' })
  .max(20, { message: 'validation.password_policy_max' });

const passwordInputSchema = z
  .string({ message: 'validation.password_required' })
  .min(1, { message: 'validation.password_required' }); // since it will be checked with hash function empty check is enough

export const registerSchema = z
  .object({
    name: nameSchema,
    surname: surnameSchema,
    email: emailSchema,
    password: passwordPolicySchema,
  })
  .strict();

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordInputSchema,
});

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    surname: surnameSchema.optional(),
    email: emailSchema.optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    countryCode: z.string().optional(),
    birthDate: z.coerce.date().optional(),
  })
  .strict();

export const userQuerySchema = z.object({
  includeDeleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  onlyDeleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const userIdParamSchema = z.object({
  id: objectIdSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
