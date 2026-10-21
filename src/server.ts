import { buildApp } from './app.js';
import { loadConfigStore } from './clients/config-store.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './observability/logger.js';
import { GhlClient, parseGhlTokens } from './ghl/client.js';
import { OwnerAlerts, parseAlertOverrides } from './alerts/owner-alerts.js';
import { loadTemplates } from './alerts/templates.js';
import { PostCallProcessor } from './jobs/post-call.js';
import { loadLibrary } from './knowledge/library.js';
import { loadSymptomLibrary } from './knowledge/symptoms.js';
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

  const metrics = createMetrics();
  const tokens = parseGhlTokens(env);
  const ghl = tokens.size ? new GhlClient({ tokens, metrics, log: logger }) : undefined;
  logger.info({ ghl_locations: tokens.size }, 'ghl_client_configured');
  const knowledge = await loadLibrary(env.KNOWLEDGE_DIR);
  logger.info(
    { knowledge_entries: knowledge.servedEntries, manufacturers: knowledge.manufacturers.size },
    'knowledge_loaded',
  );
  const symptoms = await loadSymptomLibrary(env.SYMPTOMS_DIR);
  logger.info(
    { presentations: symptoms.servedPresentations, families: symptoms.families.size },
    'symptoms_loaded',
  );
  const templates = loadTemplates();
  const alerts = ghl
    ? new OwnerAlerts({
        ghl,
        redis,
        log: logger,
        metrics,
        overrides: parseAlertOverrides(env.ALERT_SMS_OVERRIDES),
      })
    : undefined;
  const postCall =
    ghl && alerts
      ? new PostCallProcessor({ ghl, redis, alerts, templates, log: logger })
      : undefined;
  const app = await buildApp({
    env,
    logger,
    redis,
    configStore,
    metrics,
    ghl,
    knowledge,
    symptoms,
    alerts,
    templates,
    postCall,
  });
  await app.listen({ host: env.HOST, port: env.PORT });

  // Post-call processing every minute. Every instance runs the timer; a Redis lock per location
  // means only one actually processes, so scaling out never double-processes a call.
  let timer: NodeJS.Timeout | undefined;
  if (postCall && env.POST_CALL_INTERVAL_MS > 0) {
    const tick = async () => {
      for (const locationId of configStore.locations()) {
        const client = configStore.get(locationId);
        if (!client || !ghl?.hasLocation(locationId)) continue;
        await postCall
          .run(locationId, client.config)
          .catch((err: unknown) =>
            logger.error(
              { location_id: locationId, error_code: (err as Error).name },
              'post_call_tick_failed',
            ),
          );
      }
    };
    timer = setInterval(() => void tick(), env.POST_CALL_INTERVAL_MS);
    timer.unref();
  }

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
    if (timer) clearInterval(timer);
    await app.close(); // stops accepting, drains in-flight requests
    await ghl?.close();
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
