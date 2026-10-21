import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import underPressure from '@fastify/under-pressure';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { ConfigStore } from './clients/config-store.js';
import type { Env } from './config/env.js';
import { AppError, ERROR_CODES, type ErrorCode } from './core/errors.js';
import type { GhlClient } from './ghl/client.js';
import type { KnowledgeLibrary } from './knowledge/library.js';
import { EMPTY_SYMPTOM_LIBRARY, type SymptomLibrary } from './knowledge/symptoms.js';
import type { OwnerAlerts } from './alerts/owner-alerts.js';
import type { SmsTemplate } from './alerts/templates.js';
import type { PostCallProcessor } from './jobs/post-call.js';
import { registerJobRoutes } from './routes/jobs.js';
import type { Metrics } from './observability/metrics.js';
import { IdempotencyStore } from './store/idempotency.js';
import { registerActionRoutes } from './routes/actions.js';
import { extractEnvelope, type GhlEnvelope } from './routes/ghl-envelope.js';
import { registerHealthRoutes } from './routes/health.js';
import { isAuthorised } from './security/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    annie: {
      /** GHL call metadata and parameters, parsed once before rate limiting and handlers. */
      envelope: GhlEnvelope | null;
      action: string | null;
      callId: string | null;
      locationId: string | null;
      outcome: string | null;
      errorCode: string | null;
    };
  }
}

export interface AppDeps {
  env: Env;
  logger: Logger;
  redis: Redis;
  configStore: ConfigStore;
  metrics: Metrics;
  now?: () => Date;
  /** GHL API client; absent when no GHL credentials are configured. */
  ghl?: GhlClient;
  /** Technical knowledge library; empty when none is deployed. */
  knowledge?: KnowledgeLibrary;
  /** Symptom guidance library; empty when none is deployed. */
  symptoms?: SymptomLibrary;
  alerts?: OwnerAlerts;
  templates?: ReadonlyMap<string, SmsTemplate>;
  postCall?: PostCallProcessor;
}

const CORRELATION_HEADER = 'x-correlation-id';
const CORRELATION_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

function errorBody(code: ErrorCode, message: string, retryable: boolean) {
  return { error: { code, message, retryable } };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env, metrics } = deps;

  const app = Fastify({
    // pino's Logger is a FastifyBaseLogger; the cast keeps FastifyInstance at its default generics.
    loggerInstance: deps.logger as FastifyBaseLogger,
    // Fastify's own request logs are off; onResponse writes one structured line per request.
    logController: new Fastify.LogController({
      disableRequestLogging: true,
      requestIdLogLabel: 'correlation_id',
    }),
    bodyLimit: env.BODY_LIMIT_BYTES,
    genReqId: (req) => {
      const supplied = req.headers[CORRELATION_HEADER];
      return typeof supplied === 'string' && CORRELATION_PATTERN.test(supplied)
        ? supplied
        : randomUUID();
    },
  });

  // Initialised per request in onRequest; null default keeps the request shape stable.
  // GHL may post form-encoded bodies; parse them into the same flat object as JSON.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: env.BODY_LIMIT_BYTES },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  app.decorateRequest('annie', null as unknown as FastifyRequest['annie']);
  app.addHook('onRequest', async (request, reply) => {
    request.annie = {
      envelope: null,
      action: null,
      callId: null,
      locationId: null,
      outcome: null,
      errorCode: null,
    };
    reply.header(CORRELATION_HEADER, request.id);
  });

  // Authenticate every business endpoint before any parsing work is done.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return;
    if (!isAuthorised(request.headers, env.WEBHOOK_SECRETS)) {
      metrics.rejected.inc({ reason: 'unauthorized' });
      request.annie.errorCode = 'unauthorized';
      return reply.code(401).send(errorBody('unauthorized', 'Unauthorized', false));
    }
  });

  await app.register(underPressure, {
    maxEventLoopDelay: env.MAX_EVENT_LOOP_DELAY_MS,
    retryAfter: 1,
    pressureHandler: (request, reply) => {
      metrics.rejected.inc({ reason: 'overloaded' });
      request.annie.errorCode = 'overloaded';
      void reply
        .code(503)
        .header('retry-after', '1')
        .send(errorBody('overloaded', 'Service is busy, retry shortly', true));
    },
  });

  // Runs before the rate limiter (hooks run in registration order) so every log line, including
  // rejected requests, carries the call and location ids.
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/v1/')) return;
    const envelope = extractEnvelope(request.body, request.headers, request.query);
    request.annie.envelope = envelope;
    request.annie.callId = envelope.callId;
    request.annie.locationId = envelope.locationId;
    request.annie.action = request.routeOptions.url?.split('/').at(-1) ?? null;
  });

  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: 60_000,
    redis: deps.redis,
    nameSpace: 'rl:',
    skipOnError: true, // rate limiting fails open; it must never take the call path down
    allowList: (request) => !request.url.startsWith('/v1/'),
    keyGenerator: (request) => {
      const locationId = request.annie.locationId;
      return locationId ? `loc:${locationId}` : `ip:${request.ip}`;
    },
    onExceeded: (request) => {
      metrics.rejected.inc({ reason: 'rate_limited' });
      request.annie.errorCode = 'rate_limited';
    },
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      ...errorBody('rate_limited', `Rate limit exceeded, retry in ${context.after}`, true),
    }),
  });

  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    let code: ErrorCode;
    let message: string;
    let retryable = false;

    if (err instanceof AppError) {
      ({ code, message, retryable } = err);
    } else if (err.statusCode === 429) {
      code = 'rate_limited';
      message = err.message;
      retryable = true;
    } else if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      code = 'payload_too_large';
      message = 'Payload too large';
    } else if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500) {
      code = 'validation_failed';
      message = 'Malformed request';
    } else {
      code = 'internal_error';
      message = 'Internal error';
      retryable = true;
      request.log.error({ err, error_code: code }, 'unhandled_error');
    }

    request.annie.errorCode = code;
    return reply.code(ERROR_CODES[code]).send(errorBody(code, message, retryable));
  });

  app.setNotFoundHandler((request, reply) => {
    request.annie.errorCode = 'not_found';
    return reply.code(404).send(errorBody('not_found', 'Not found', false));
  });

  // One structured line per request: ids, status, error code and latency. Never bodies.
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched';
    const latencyMs = Math.round(reply.elapsedTime * 10) / 10;
    metrics.httpDuration.observe(
      { route, method: request.method, status: String(reply.statusCode) },
      latencyMs / 1000,
    );
    if (route === '/healthz' || route === '/readyz' || route === '/metrics') return;
    const { action, callId, locationId, outcome, errorCode } = request.annie;
    request.log.info(
      {
        route,
        method: request.method,
        status: reply.statusCode,
        latency_ms: latencyMs,
        action,
        ghl_call_id: callId,
        location_id: locationId,
        outcome,
        error_code: errorCode,
      },
      'request_completed',
    );
  });

  registerHealthRoutes(app, deps);
  registerActionRoutes(app, {
    configStore: deps.configStore,
    metrics,
    now: deps.now ?? (() => new Date()),
    actionDeadlineMs: env.ACTION_DEADLINE_MS,
    bookingDeadlineMs: env.BOOKING_ACTION_DEADLINE_MS,
    ghl: deps.ghl,
    idempotency: new IdempotencyStore(deps.redis),
    knowledge: deps.knowledge ?? { manufacturers: new Map(), servedEntries: 0 },
    symptoms: deps.symptoms ?? EMPTY_SYMPTOM_LIBRARY,
    alerts: deps.alerts,
    templates: deps.templates,
  });

  registerJobRoutes(app, { configStore: deps.configStore, postCall: deps.postCall, ghl: deps.ghl });

  return app;
}
