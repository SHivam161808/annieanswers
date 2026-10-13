import { buildApp } from './app.js';
import { loadConfigStore } from './clients/config-store.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './observability/logger.js';
import { createMetrics } from './observability/metrics.js';
import { createRedis } from './store/redis.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    appEnv: env.APP_ENV,
    version: env.RELEASE_VERSION,
  });

  const configStore = await loadConfigStore(env.CLIENT_CONFIG_DIR);
  logger.info({ clients: configStore.size() }, 'client_config_loaded');

  const redis = createRedis(env.REDIS_URL);
  redis.on('error', (err) => logger.warn({ error_code: err.name }, 'redis_error'));
  await redis.connect();

  const app = await buildApp({ env, logger, redis, configStore, metrics: createMetrics() });
  await app.listen({ host: env.HOST, port: env.PORT });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown_started');
    const force = setTimeout(() => {
      logger.error('shutdown_forced');
      process.exit(1);
    }, env.SHUTDOWN_GRACE_MS);
    force.unref();
    await app.close(); // stops accepting, drains in-flight requests
    await redis.quit().catch(() => redis.disconnect());
    logger.info('shutdown_complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  // Logger may not exist yet (bad env); write a minimal structured line without secrets.
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'startup_failed', error: (err as Error).message })}\n`,
  );
  process.exit(1);
});
