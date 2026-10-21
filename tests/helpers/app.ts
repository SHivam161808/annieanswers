import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import { Redis } from 'ioredis';
import { inject } from 'vitest';
import { buildApp, type AppDeps } from '../../src/app.js';
import { loadConfigStore } from '../../src/clients/config-store.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { createLogger } from '../../src/observability/logger.js';
import type { GhlClient } from '../../src/ghl/client.js';
import { createMetrics } from '../../src/observability/metrics.js';
import { createRedis } from '../../src/store/redis.js';

export const TEST_SECRET = 'test-webhook-secret-0123456789abcdef';
export const TEST_METRICS_TOKEN = 'test-metrics-token-0123456789abcdef';
/** Location id of the DEMO client, read from its config so tests follow the file. */
export const DEMO_LOCATION = (
  parseYaml(readFileSync('config/clients/demo.yaml', 'utf8')) as { ghl_location_id: string }
).ghl_location_id;

/**
 * A Redis URL on a logical database no other test in this run uses, allocated by an atomic
 * counter in db 0, so parallel test files can flush their database without affecting others.
 */
export async function isolatedRedisUrl(): Promise<string> {
  const base = inject('redisUrl');
  const counter = new Redis(`${base}/0`);
  try {
    const n = await counter.incr('test:db-allocator');
    // Respect the server's database count (local test server: 64; stock Redis, e.g. CI: 16).
    const [, configured] = (await counter.config('GET', 'databases')) as [string, string];
    const usable = Math.max(1, Number(configured) - 1);
    return `${base}/${1 + ((n - 1) % usable)}`;
  } finally {
    counter.disconnect();
  }
}

export async function testEnv(overrides: Record<string, string> = {}): Promise<Env> {
  return loadEnv({
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    REDIS_URL: await isolatedRedisUrl(),
    WEBHOOK_SECRETS: TEST_SECRET,
    METRICS_TOKEN: TEST_METRICS_TOKEN,
    CLIENT_CONFIG_DIR: path.resolve('config/clients'),
    ...overrides,
  });
}

export interface TestApp {
  app: FastifyInstance;
  redis: Redis;
  close: () => Promise<void>;
}

export async function startTestApp(
  options: {
    env?: Record<string, string>;
    now?: () => Date;
    logStream?: DestinationStream;
    ghl?: GhlClient;
    /** Extra dependencies (alerts, templates, postCall, knowledge); may use the test Redis. */
    deps?: (redis: Redis) => Partial<AppDeps>;
  } = {},
): Promise<TestApp> {
  const env = await testEnv(options.env);
  const redis = createRedis(env.REDIS_URL);
  await redis.connect();
  await redis.flushdb();
  const logger = createLogger(
    {
      level: options.logStream ? 'debug' : env.LOG_LEVEL,
      appEnv: env.APP_ENV,
      version: 'test',
    },
    options.logStream,
  );
  const app = await buildApp({
    env,
    logger,
    redis,
    configStore: await loadConfigStore(env.CLIENT_CONFIG_DIR),
    metrics: createMetrics(),
    now: options.now,
    ghl: options.ghl,
    ...options.deps?.(redis),
  });
  await app.ready();
  return {
    app,
    redis,
    close: async () => {
      await app.close();
      redis.disconnect();
    },
  };
}

export function authHeaders(): Record<string, string> {
  return { 'x-annie-secret': TEST_SECRET, 'content-type': 'application/json' };
}

export { Redis };
