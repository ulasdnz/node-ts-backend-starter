import { z } from 'zod';

const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const;

const isUrlWithProtocol = (value: string, protocols: string[]): boolean => {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && url.host !== '';
  } catch {
    return false;
  }
};

// A browser sends its origin as scheme://host[:port]; anything else (a path, a trailing slash, a
// missing scheme) would never match and silently disable CORS for that client.
const isBareOrigin = (value: string): boolean => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};

const corsOriginsSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .refine((origins) => origins.every(isBareOrigin), {
    message: 'CORS_ORIGINS must list origins like https://app.example.com, without paths',
  });

// Express "trust proxy" as a hop count: how many proxies in front of the app append to
// X-Forwarded-For. Looser values (true, subnet lists) would let clients choose their own req.ip.
const trustProxySchema = z
  .string()
  .trim()
  .refine((value) => value === 'false' || /^(?:\d|10)$/.test(value), {
    message: 'TRUST_PROXY must be "false" or a hop count from 0 to 10',
  })
  .transform((value): false | number =>
    value === 'false' || value === '0' ? false : Number(value),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    MONGO_URI: z
      .string()
      .trim()
      .refine((value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'), {
        message: 'MONGO_URI must start with mongodb:// or mongodb+srv://',
      }),
    REDIS_URL: z
      .string()
      .trim()
      .refine((value) => isUrlWithProtocol(value, ['redis:', 'rediss:']), {
        message: 'REDIS_URL must be a valid redis URL like redis://host:port',
      }),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    USER_DELETION_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    CORS_ORIGINS: corsOriginsSchema,
    TRUST_PROXY: trustProxySchema.optional(),
    RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_DURATION_SECONDS: z.coerce.number().int().positive().default(60),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    // A duration in jsonwebtoken's short format: 15m, 12h, 1d...
    JWT_EXPIRES_IN: z
      .string()
      .trim()
      .regex(/^\d+(ms|s|m|h|d|w|y)?$/, {
        message: 'JWT_EXPIRES_IN must be a duration such as 15m, 12h or 1d',
      })
      .default('1d'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
    AUTH_CONTEXT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    LOGIN_MAX_CONSECUTIVE_FAILS: z.coerce.number().int().positive().default(5),
    LOGIN_BLOCK_DURATION_SECONDS: z.coerce.number().int().positive().default(900),
    LOGIN_MAX_FAILS_PER_IP_PER_DAY: z.coerce.number().int().positive().default(100),
    WORKERS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  })
  .superRefine((env, ctx) => {
    // A wrong default here either lets clients spoof their IP or puts every client behind the
    // proxy's single IP, so production has to state how many proxies sit in front of it
    if (env.NODE_ENV === 'production' && env.TRUST_PROXY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'TRUST_PROXY is required in production (e.g. 1 behind a single load balancer)',
      });
    }
  })
  .transform((env) => ({
    ...env,
    TRUST_PROXY: env.TRUST_PROXY ?? false,
    USER_DELETION_RETENTION_MS: env.USER_DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  }));

export type Config = z.output<typeof envSchema>;
