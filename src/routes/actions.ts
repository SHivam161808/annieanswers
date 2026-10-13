import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { callContext } from '../actions/call-context.js';
import { escalation } from '../actions/escalation.js';
import { checkServiceArea } from '../actions/service-area.js';
import type { ClientConfig, ConfigStore } from '../clients/config-store.js';
import { AppError } from '../core/errors.js';
import { ESCALATION_TRIGGERS } from '../domain/escalation.js';
import type { Metrics } from '../observability/metrics.js';
import { elapsedMs } from '../observability/timing.js';
import { extractEnvelope } from './ghl-envelope.js';

export interface ActionDeps {
  configStore: ConfigStore;
  metrics: Metrics;
  now: () => Date;
}

const escalationParams = z.object({ trigger: z.enum(ESCALATION_TRIGGERS) });

/**
 * During-call custom actions. All are read-only and computed from in-memory config, so they are
 * naturally idempotent and finish well inside the action deadline.
 */
export function registerActionRoutes(app: FastifyInstance, deps: ActionDeps): void {
  const handle = (
    action: string,
    run: (client: ClientConfig, params: { [key: string]: unknown }) => unknown,
  ) => {
    // GET: GHL only passes response fields to the agent for GET actions (via selectedPaths).
    app.route({
      method: ['GET', 'POST'],
      url: `/v1/actions/${action}`,
      handler: async (request, reply) => {
        const start = performance.now();
        const envelope =
          request.annie.envelope ?? extractEnvelope(request.body, request.headers, request.query);
        // Field names only (never values): records the real GHL payload shape (spike item V2).
        request.log.info(
          {
            action,
            param_keys: Object.keys(envelope.params).sort(),
            header_keys: Object.keys(request.headers).sort(),
            content_type: request.headers['content-type'] ?? null,
          },
          'ghl_request_shape',
        );

        let result = 'ok';
        try {
          if (!envelope.locationId) {
            throw new AppError('validation_failed', 'location_id is required');
          }
          const client = deps.configStore.get(envelope.locationId);
          if (!client) {
            throw new AppError('config_unavailable', 'No configuration for this location');
          }
          return reply.send(run(client, envelope.params));
        } catch (err) {
          result = err instanceof AppError ? err.code : 'internal_error';
          throw err;
        } finally {
          deps.metrics.actionDuration.observe({ action, result }, elapsedMs(start) / 1000);
        }
      },
    });
  };

  handle('check-service-area', (client, params) => checkServiceArea(client, params.postcode));

  handle('call-context', (client) => callContext(client, deps.now()));

  handle('escalation', (client, params) => {
    const parsed = escalationParams.safeParse(params);
    if (!parsed.success) {
      throw new AppError(
        'validation_failed',
        `trigger must be one of: ${ESCALATION_TRIGGERS.join(', ')}`,
      );
    }
    return escalation(client, parsed.data.trigger, deps.now());
  });
}
