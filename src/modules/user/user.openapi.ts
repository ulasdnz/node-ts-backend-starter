import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { bearerAuth, errorResponses, paginationMetaSchema } from '../../core/openapi.js';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateUserSchema,
  userIdParamSchema,
  userQuerySchema,
} from './user.validators.js';

const timestamp = z.iso.datetime();

/**
 * A user as the API returns it. Every documented field is guaranteed; others may appear too (such as
 * Mongoose's `__v`). The password hash and the token version never do.
 */
export const userSchema = z
  .object({
    _id: z.string().regex(/^[0-9a-f]{24}$/),
    email: z.email(),
    name: z.string(),
    surname: z.string(),
    role: z.enum(['admin', 'user']),
    gender: z.enum(['male', 'female', 'other']).optional(),
    countryCode: z.string().optional(),
    birthDate: timestamp.optional(),
    photoUrl: z.string(),
    isActivated: z.boolean(),
    passwordChangedAt: timestamp.optional(),
    deleted: z.boolean(),
    deletedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .meta({ id: 'User' });

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });

const jsonBody = (schema: z.ZodType) => ({ required: true, ...json(schema) });

// The validators trim and lower-case an email before they check its format, through a pipe, and only
// the first half of a pipe describes what clients send. The format is restated for them here.
const documentedEmail = z.email().meta({
  description: 'Compared without surrounding spaces and regardless of case',
});
const registerBody = registerSchema.extend({ email: documentedEmail });
const loginBody = loginSchema.extend({ email: documentedEmail });
const updateUserBody = updateUserSchema.extend({ email: documentedEmail.optional() });

const userWithMessage = z.object({ data: userSchema, message: z.string() });

export const userPaths: ZodOpenApiPathsObject = {
  '/api/v1/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a user',
      security: [],
      requestBody: jsonBody(registerBody),
      responses: {
        201: { description: 'Registered', ...json(userWithMessage) },
        ...errorResponses(400, 409, 413, 429, 500),
      },
    },
  },
  '/api/v1/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Sign in; restores an account deleted within the retention period',
      description:
        'Repeated failures for one email and IP lock that pair for a while, and each IP has a ' +
        'daily failure budget (429 with Retry-After). The message is present only when the ' +
        'account was restored.',
      security: [],
      requestBody: jsonBody(loginBody),
      responses: {
        200: {
          description: 'Signed in',
          ...json(
            z.object({
              data: z.object({ user: userSchema, token: z.string() }),
              message: z.string().optional(),
            }),
          ),
        },
        ...errorResponses(400, 401, 403, 413, 429, 500),
      },
    },
  },
  '/api/v1/users/me': {
    get: {
      tags: ['Users'],
      summary: 'Get the signed-in user',
      security: bearerAuth,
      responses: {
        200: { description: 'The user', ...json(z.object({ data: userSchema })) },
        ...errorResponses(401, 403, 404, 429, 500),
      },
    },
    patch: {
      tags: ['Users'],
      summary: 'Update the signed-in user',
      security: bearerAuth,
      requestBody: jsonBody(updateUserBody),
      responses: {
        200: { description: 'Updated', ...json(userWithMessage) },
        ...errorResponses(400, 401, 403, 404, 409, 413, 429, 500),
      },
    },
    delete: {
      tags: ['Users'],
      summary: 'Delete the signed-in account',
      description:
        'The account is soft deleted and purged for good after the retention period. Signing in ' +
        'before then restores it. If the purge cannot be scheduled, the deletion is rolled back.',
      security: bearerAuth,
      responses: {
        200: { description: 'Deleted', ...json(z.object({ message: z.string() })) },
        ...errorResponses(401, 403, 404, 429, 500),
      },
    },
  },
  '/api/v1/users/me/password': {
    patch: {
      tags: ['Users'],
      summary: 'Change the password',
      description:
        'Revokes every token issued before, the one used for this request included, and returns ' +
        'a new one. Wrong current passwords count toward the sign-in lock.',
      security: bearerAuth,
      requestBody: jsonBody(changePasswordSchema),
      responses: {
        200: {
          description: 'Changed',
          ...json(z.object({ data: z.object({ token: z.string() }), message: z.string() })),
        },
        ...errorResponses(400, 401, 403, 404, 413, 429, 500),
      },
    },
  },
  '/api/v1/users/me/avatar': {
    patch: {
      tags: ['Users'],
      summary: 'Upload a new avatar',
      description: 'One image file in the photo field; its content decides whether it is an image.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: z.object({ photo: z.string().meta({ format: 'binary' }) }),
          },
        },
      },
      responses: {
        200: { description: 'Avatar updated', ...json(userWithMessage) },
        ...errorResponses(400, 401, 403, 404, 429, 500),
      },
    },
  },
  '/api/v1/users': {
    get: {
      tags: ['Admin'],
      summary: 'List users, page by page',
      description:
        'Sort by a comma-separated list of createdAt, email, name and surname, with "-" for ' +
        'descending order (default "-createdAt"). Ties are broken by id, so pages never overlap.',
      security: bearerAuth,
      requestParams: { query: userQuerySchema },
      responses: {
        200: {
          description: 'One page of users',
          ...json(
            z.object({
              data: z.array(userSchema),
              meta: z.object({ pagination: paginationMetaSchema }),
            }),
          ),
        },
        ...errorResponses(400, 401, 403, 429, 500),
      },
    },
  },
  '/api/v1/users/{id}': {
    get: {
      tags: ['Admin'],
      summary: 'Get a user by id, deleted users included',
      security: bearerAuth,
      requestParams: { path: userIdParamSchema },
      responses: {
        200: { description: 'The user', ...json(z.object({ data: userSchema })) },
        ...errorResponses(400, 401, 403, 404, 429, 500),
      },
    },
  },
};
