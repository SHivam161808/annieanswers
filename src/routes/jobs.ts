import type { FastifyInstance } from 'fastify';
import type { ConfigStore } from '../clients/config-store.js';
import { AppError } from '../core/errors.js';
import type { GhlClient } from '../ghl/client.js';
import type { PostCallProcessor, PostCallSummary } from '../jobs/post-call.js';

export interface JobDeps {
  configStore: ConfigStore;
  postCall?: PostCallProcessor | undefined;
  ghl?: GhlClient | undefined;
}

/**
 * Scheduled jobs, triggered every minute by Cloud Scheduler / Fly cron / GitHub Actions with the
 * same shared secret as the actions (all /v1 routes are authenticated). Stateless: safe to call
 * on any instance, concurrently.
 */
export function registerJobRoutes(app: FastifyInstance, deps: JobDeps): void {
  app.post('/v1/jobs/post-call', async (request) => {
    if (!deps.postCall || !deps.ghl) {
      throw new AppError('config_unavailable', 'Post-call processing needs GHL credentials');
    }
    const query = (request.query ?? {}) as { location_id?: string };
    const locations = query.location_id
      ? [query.location_id]
      : deps.configStore.locations().filter((l) => deps.ghl!.hasLocation(l));
    const results: PostCallSummary[] = [];
    for (const locationId of locations) {
      const client = deps.configStore.get(locationId);
      if (!client || !deps.ghl.hasLocation(locationId)) {
        throw new AppError(
          'config_unavailable',
          'No configuration or credentials for this location',
        );
      }
      results.push(await deps.postCall.run(locationId, client.config));
    }
    request.annie.action = 'post-call-job';
    return { results };
  });
}
