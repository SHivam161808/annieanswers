import type { Logger } from 'pino';
import { Pool, type Dispatcher } from 'undici';
import { AppError } from '../core/errors.js';
import type { Metrics } from '../observability/metrics.js';
import { elapsedMs, type Deadline } from '../observability/timing.js';

/**
 * GHL API client for the request path. Every call is bounded by the caller's deadline, retried
 * only when that is safe, measured, and logged without bodies (they can hold caller PII).
 *
 * Retry policy:
 *  - GET / PUT / DELETE (idempotent): retried on network errors, timeouts, 5xx and 429.
 *  - POST: never retried (a retried create can duplicate), unless the caller marks it idempotent.
 *  - 429: honours Retry-After when it fits in the remaining deadline, otherwise fails fast.
 * Circuit breaker: after `breakerThreshold` consecutive failures the client fails fast for
 * `breakerCooldownMs`, so a GHL outage turns into instant request-mode fallbacks instead of
 * every call waiting for its timeout. (Breaker state is per process; it is not call state.)
 */

export const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

export type GhlFailure =
  'timeout' | 'network' | 'rate_limited' | 'http_4xx' | 'http_5xx' | 'circuit_open' | 'deadline';

export class GhlError extends AppError {
  constructor(
    readonly failure: GhlFailure,
    readonly httpStatus: number | null,
    message: string,
    /** For rate_limited: how long GHL asked us to wait (per request, never shared). */
    readonly retryAfterMs = 0,
  ) {
    super('dependency_failed', message, failure !== 'http_4xx');
    this.name = 'GhlError';
  }
}

export interface GhlRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  version: string;
  /** Sub-account the call is for; selects the token. */
  locationId: string;
  body?: unknown;
  deadline: Deadline;
  /** Metric/log label, e.g. "find_appointments". Never include ids. */
  operation: string;
  /** Allow retries for a POST known to be idempotent. */
  idempotent?: boolean;
}

export interface GhlClientOptions {
  /** locationId -> Private Integration token (from the secret manager). */
  tokens: ReadonlyMap<string, string>;
  dispatcher?: Dispatcher;
  baseUrl?: string;
  /** Upper bound for a single attempt, also capped by the remaining deadline. */
  attemptTimeoutMs?: number;
  maxAttempts?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  metrics: Metrics;
  log: Logger;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const RETRYABLE: ReadonlySet<GhlFailure> = new Set([
  'timeout',
  'network',
  'http_5xx',
  'rate_limited',
]);
const MIN_ATTEMPT_MS = 150;

export class GhlClient {
  private readonly dispatcher: Dispatcher;
  private readonly baseUrl: string;
  private readonly attemptTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(private readonly options: GhlClientOptions) {
    this.baseUrl = options.baseUrl ?? GHL_BASE_URL;
    this.dispatcher =
      options.dispatcher ??
      new Pool(this.baseUrl, { connections: 64, keepAliveTimeout: 30_000, pipelining: 1 });
    // GHL writes take ~1.3 s (measured); the request deadline still caps every attempt.
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? 2500;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.breakerThreshold = options.breakerThreshold ?? 5;
    this.breakerCooldownMs = options.breakerCooldownMs ?? 10_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
  }

  hasLocation(locationId: string): boolean {
    return this.options.tokens.has(locationId);
  }

  async request<T>(req: GhlRequest): Promise<T> {
    const token = this.options.tokens.get(req.locationId);
    if (!token) throw new AppError('config_unavailable', 'No GHL credentials for this location');

    if (this.now() < this.openUntil) {
      this.observe(req.operation, 'circuit_open', 0);
      throw new GhlError('circuit_open', null, 'GHL temporarily unavailable (circuit open)');
    }

    const retryable = req.method !== 'POST' || req.idempotent === true;
    let lastError: GhlError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      // Whole milliseconds: Node timers and AbortSignal.timeout reject fractional values.
      const budget = Math.floor(Math.min(this.attemptTimeoutMs, req.deadline.remainingMs()));
      if (budget < MIN_ATTEMPT_MS) {
        throw lastError ?? new GhlError('deadline', null, 'Not enough time left to call GHL');
      }
      if (attempt > 1)
        this.options.metrics.dependencyRetries.inc({ dependency: 'ghl', operation: req.operation });

      try {
        const result = await this.attempt<T>(req, token, budget);
        this.consecutiveFailures = 0;
        return result;
      } catch (err) {
        if (!(err instanceof GhlError)) throw err;
        lastError = err;
        if (err.failure !== 'http_4xx' && err.failure !== 'rate_limited') this.recordFailure();
        if (!retryable || !RETRYABLE.has(err.failure) || attempt === this.maxAttempts) throw err;

        const wait = err.failure === 'rate_limited' ? err.retryAfterMs : this.backoffMs(attempt);
        if (wait + MIN_ATTEMPT_MS > req.deadline.remainingMs()) throw err;
        await this.sleep(wait);
      }
    }
    throw lastError ?? new GhlError('deadline', null, 'GHL request did not complete');
  }

  private async attempt<T>(req: GhlRequest, token: string, budgetMs: number): Promise<T> {
    const start = performance.now();
    let outcome = 'ok';
    let errorDetail: string | undefined;
    try {
      const res = await this.dispatcher.request({
        origin: this.baseUrl,
        path: req.path,
        method: req.method,
        headers: {
          authorization: `Bearer ${token}`,
          version: req.version,
          accept: 'application/json',
          ...(req.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        headersTimeout: budgetMs,
        bodyTimeout: budgetMs,
        signal: AbortSignal.timeout(budgetMs),
      });
      const text = await res.body.text();

      if (res.statusCode === 429) {
        outcome = 'rate_limited';
        const header = res.headers['retry-after'];
        const seconds = Number(Array.isArray(header) ? header[0] : header);
        const retryAfterMs =
          Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 5000) : 500;
        throw new GhlError('rate_limited', 429, 'GHL rate limit', retryAfterMs);
      }
      if (res.statusCode >= 500) {
        outcome = 'http_5xx';
        throw new GhlError('http_5xx', res.statusCode, `GHL ${res.statusCode}`);
      }
      if (res.statusCode >= 400) {
        outcome = 'http_4xx';
        throw new GhlError('http_4xx', res.statusCode, `GHL ${res.statusCode}`);
      }
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        outcome = 'http_5xx';
        throw new GhlError('http_5xx', res.statusCode, 'GHL returned invalid JSON');
      }
    } catch (err) {
      if (err instanceof GhlError) throw err;
      const name = (err as Error).name;
      // Name and code only: messages can contain URLs with caller data.
      errorDetail = `${name}${(err as { code?: string }).code ? `:${(err as { code?: string }).code}` : ''}`;
      outcome =
        name === 'TimeoutError' || name === 'AbortError' || /Timeout/.test(name)
          ? 'timeout'
          : 'network';
      throw new GhlError(outcome as GhlFailure, null, `GHL ${outcome}`);
    } finally {
      this.observe(req.operation, outcome, elapsedMs(start), errorDetail);
    }
  }

  private observe(
    operation: string,
    result: string,
    latencyMs: number,
    errorDetail?: string,
  ): void {
    this.options.metrics.dependencyDuration.observe(
      { dependency: 'ghl', operation, result },
      latencyMs / 1000,
    );
    const level = result === 'ok' ? 'debug' : 'warn';
    this.options.log[level](
      {
        dependency: 'ghl',
        operation,
        status: result,
        latency_ms: latencyMs,
        error_detail: errorDetail,
      },
      'dependency_call',
    );
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.breakerThreshold) {
      this.openUntil = this.now() + this.breakerCooldownMs;
      this.consecutiveFailures = 0;
      this.options.log.error(
        { dependency: 'ghl', cooldown_ms: this.breakerCooldownMs },
        'circuit_opened',
      );
    }
  }

  private backoffMs(attempt: number): number {
    const base = 100 * 2 ** (attempt - 1);
    return base + Math.floor(Math.random() * base);
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
  }
}

/** Parses GHL_TOKENS ('{"<locationId>":"<token>"}') with a single-location fallback. */
export function parseGhlTokens(env: {
  GHL_TOKENS?: string | undefined;
  GHL_PRIVATE_TOKEN?: string | undefined;
  GHL_LOCATION_ID?: string | undefined;
}): Map<string, string> {
  const tokens = new Map<string, string>();
  if (env.GHL_TOKENS) {
    const parsed = JSON.parse(env.GHL_TOKENS) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('GHL_TOKENS must be a JSON object of locationId -> token');
    }
    for (const [location, token] of Object.entries(parsed)) {
      if (typeof token !== 'string' || !token)
        throw new Error('GHL_TOKENS values must be non-empty strings');
      tokens.set(location, token);
    }
  }
  if (env.GHL_PRIVATE_TOKEN && env.GHL_LOCATION_ID && !tokens.has(env.GHL_LOCATION_ID)) {
    tokens.set(env.GHL_LOCATION_ID, env.GHL_PRIVATE_TOKEN);
  }
  return tokens;
}
