import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    MONGO_URI: z
      .string()
      .nonempty('MONGO_URI must be provided')
      .refine((val: string) => val.startsWith('mongodb://') || val.startsWith('mongodb+srv://'), {
        message: 'MONGO_URI must start with mongodb:// or mongodb+srv://',
      }),
    JWT_SECRET: z.string().nonempty('JWT_SECRET must be provided'),
    LOG_LEVEL: z.string().default('info'),
    REDIS_URL: z
      .string()
      .nonempty('REDIS_URL must be provided')
      .refine(
        (val) => {
          try {
            const url = new URL(val);
            return (url.protocol === 'redis:' || url.protocol === 'rediss:') && !!url.host;
          } catch {
            return false;
          }
        },
        {
          message: 'REDIS_URL must be a valid redis URL like redis://host:port',
        },
      ),
    USER_DELETION_RETENTION_DAYS: z.coerce.number().default(30),
  })
  .transform((data) => ({
    ...data,
    USER_DELETION_RETENTION_MS: data.USER_DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  }));

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables');
  for (const issue of parsed.error.issues) {
    console.error(`- ${issue.path.join('.')} : ${issue.message}`);
  }
  process.exit(1);
}
export const config = parsed.data;
