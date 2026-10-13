import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { ConfigStore } from '../clients/config-store.js';
import type { Env } from '../config/env.js';
import type { Metrics } from '../observability/metrics.js';
import { isAuthorised } from '../security/auth.js';

export interface HealthDeps {
  env: Env;
  redis: Redis;
  configStore: ConfigStore;
  metrics: Metrics;
}

const READINESS_TIMEOUT_MS = 500;

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  /** Liveness: the process is up and the event loop is responsive. */
  app.get('/healthz', async () => ({ status: 'ok' }));

  /** Readiness: dependencies needed to serve traffic are reachable. */
  app.get('/readyz', async (_request, reply) => {
    const checks = { redis: false, config: deps.configStore.size() > 0 };
    try {
      const pong = await Promise.race([
        deps.redis.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), READINESS_TIMEOUT_MS),
        ),
      ]);
      checks.redis = pong === 'PONG';
    } catch {
      checks.redis = false;
    }
    const ready = checks.redis && checks.config;
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
  });

  app.get('/metrics', async (request, reply) => {
    if (!isAuthorised(request.headers, [deps.env.METRICS_TOKEN])) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Unauthorized' } });
    }
    return reply
      .header('content-type', deps.metrics.registry.contentType)
      .send(await deps.metrics.registry.metrics());
  });
}
