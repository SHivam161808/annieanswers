import { z } from 'zod';

/** Process configuration. Secrets come only from the environment, never from source. */
const envSchema = z.object({
  APP_ENV: z.enum(['dev', 'qa', 'production', 'test']).default('dev'),
  RELEASE_VERSION: z.string().default('0.0.0-dev'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REDIS_URL: z.string().url(),
  /** Comma-separated; first is current, the rest are accepted during rotation. Min 32 chars each. */
  WEBHOOK_SECRETS: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(32)).min(1)),
  METRICS_TOKEN: z.string().min(32),
  CLIENT_CONFIG_DIR: z.string().default('config/clients'),
  KNOWLEDGE_DIR: z.string().default('knowledge/boilers'),
  ACTION_DEADLINE_MS: z.coerce.number().int().min(100).max(10_000).default(1800),
  /** Reschedule/cancel need a read, a GHL write (~1.3 s measured) and a read-back. */
  BOOKING_ACTION_DEADLINE_MS: z.coerce.number().int().min(500).max(10_000).default(4000),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(1_048_576).default(16_384),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
  MAX_EVENT_LOOP_DELAY_MS: z.coerce.number().int().min(10).default(250),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(10_000),
  /** JSON map locationId -> GHL Private Integration token (one per sub-account served). */
  GHL_TOKENS: z.string().optional(),
  /** Single-location fallback (local development). */
  GHL_PRIVATE_TOKEN: z.string().optional(),
  GHL_LOCATION_ID: z.string().optional(),
  /** Demo/testing only: JSON locationId -> phone that receives owner alerts instead of config. */
  ALERT_SMS_OVERRIDES: z.string().optional(),
  /** In-process post-call processing interval (ms); 0 disables (use the /v1/jobs endpoint). */
  POST_CALL_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment: ${issues.join('; ')}`);
    this.name = 'EnvError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Report variable names only; values may be secrets.
    throw new EnvError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}
