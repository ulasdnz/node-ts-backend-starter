import { envSchema, type Config } from './env.schema.js';

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // The logger is configured from this config, so invalid settings can only go to stderr
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`- ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const config: Config = parsed.data;
export type { Config };
