import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Latency buckets in seconds, dense around the 1.5 s / 2.5 s targets and the 2 s action budget. */
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 5];

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  return {
    registry,
    httpDuration: new Histogram({
      name: 'annie_http_request_duration_seconds',
      help: 'HTTP request latency from request received to response sent',
      labelNames: ['route', 'method', 'status'] as const,
      buckets: LATENCY_BUCKETS,
      registers: [registry],
    }),
    actionDuration: new Histogram({
      name: 'annie_action_duration_seconds',
      help: 'Voice AI action handler latency',
      labelNames: ['action', 'result'] as const,
      buckets: LATENCY_BUCKETS,
      registers: [registry],
    }),
    dependencyDuration: new Histogram({
      name: 'annie_dependency_duration_seconds',
      help: 'Latency of calls to external dependencies (GHL API, Redis)',
      labelNames: ['dependency', 'operation', 'result'] as const,
      buckets: LATENCY_BUCKETS,
      registers: [registry],
    }),
    dependencyRetries: new Counter({
      name: 'annie_dependency_retries_total',
      help: 'Retries against external dependencies',
      labelNames: ['dependency', 'operation'] as const,
      registers: [registry],
    }),
    idempotency: new Counter({
      name: 'annie_idempotency_events_total',
      help: 'Idempotency store results',
      labelNames: ['result'] as const,
      registers: [registry],
    }),
    rejected: new Counter({
      name: 'annie_requests_rejected_total',
      help: 'Requests rejected before reaching a handler',
      labelNames: ['reason'] as const,
      registers: [registry],
    }),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
