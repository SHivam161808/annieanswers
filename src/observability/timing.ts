import type { Logger } from 'pino';
import type { Metrics } from './metrics.js';

/** Monotonic elapsed milliseconds since `start` (from performance.now()). */
export function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

/**
 * Times a call to an external dependency, records the histogram, and logs one line with the
 * latency. Every boundary the service crosses goes through here so latency is never unmeasured.
 */
export async function timeDependency<T>(
  ctx: { metrics: Metrics; log: Logger },
  dependency: string,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const latency = elapsedMs(start);
    ctx.metrics.dependencyDuration.observe({ dependency, operation, result: 'ok' }, latency / 1000);
    ctx.log.debug({ dependency, operation, status: 'ok', latency_ms: latency }, 'dependency_call');
    return result;
  } catch (err) {
    const latency = elapsedMs(start);
    ctx.metrics.dependencyDuration.observe(
      { dependency, operation, result: 'error' },
      latency / 1000,
    );
    ctx.log.warn(
      {
        dependency,
        operation,
        status: 'error',
        latency_ms: latency,
        error_code: (err as { code?: string }).code ?? (err as Error).name,
      },
      'dependency_call',
    );
    throw err;
  }
}

/** A fixed point in time a request must finish by. */
export class Deadline {
  private readonly endsAt: number;

  constructor(budgetMs: number) {
    this.endsAt = performance.now() + budgetMs;
  }

  remainingMs(): number {
    return Math.max(0, this.endsAt - performance.now());
  }

  expired(): boolean {
    return this.remainingMs() === 0;
  }
}
