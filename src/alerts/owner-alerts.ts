import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import type { BusinessConfig } from '../../config/schema/business-config.js';
import { normalisePhone } from '../domain/phone.js';
import { GhlError, type GhlClient } from '../ghl/client.js';
import type { Metrics } from '../observability/metrics.js';
import type { Deadline } from '../observability/timing.js';

/**
 * Sends SMS alerts to the business owner through GHL Conversations (the business's own two-way
 * number), so they also appear in the plumber's GHL inbox. GHL workflows cannot be created via
 * the API, so the middleware sends the alerts that matter most (emergency, enquiry, failure).
 *
 * Guarantees: one alert per (key) — duplicates from retries are dropped; "sent" only when GHL
 * returns a message id; the owner contact is found or created by phone and cached.
 */

export type AlertResult = 'sent' | 'duplicate' | 'failed' | 'no_number';

const OWNER_CACHE_TTL_S = 30 * 24 * 60 * 60;
const SENT_TTL_S = 7 * 24 * 60 * 60;

export interface OwnerAlertsOptions {
  ghl: GhlClient;
  redis: Redis;
  log: Logger;
  metrics: Metrics;
  /** Development/demo only: locationId -> number that replaces the config alert number. */
  overrides?: ReadonlyMap<string, string>;
}

export class OwnerAlerts {
  constructor(private readonly o: OwnerAlertsOptions) {}

  ownerNumber(locationId: string, cfg: BusinessConfig): string | null {
    const raw = this.o.overrides?.get(locationId) ?? cfg.alert_sms_number;
    return normalisePhone(raw)?.e164 ?? null;
  }

  async send(
    locationId: string,
    cfg: BusinessConfig,
    text: string,
    key: string,
    deadline: Deadline,
  ): Promise<AlertResult> {
    const number = this.ownerNumber(locationId, cfg);
    if (!number) return this.record('no_number', key);

    const sentKey = `alert:${locationId}:${key}`;
    const claimed = await this.o.redis.set(sentKey, 'sending', 'EX', SENT_TTL_S, 'NX');
    if (claimed !== 'OK') return this.record('duplicate', key);

    try {
      const contactId = await this.ownerContact(locationId, cfg, number, deadline);
      const res = await this.o.ghl.request<{ messageId?: string; messageIds?: string[] }>({
        method: 'POST',
        path: '/conversations/messages',
        version: '2021-04-15',
        locationId,
        deadline,
        operation: 'send_owner_sms',
        body: { type: 'SMS', contactId, message: text },
      });
      if (!res.messageId && !res.messageIds?.length)
        throw new GhlError('http_5xx', null, 'GHL did not return a message id');
      await this.o.redis.set(sentKey, 'sent', 'EX', SENT_TTL_S);
      return this.record('sent', key);
    } catch (err) {
      // Release so the next attempt (retry or post-call job) can send it.
      await this.o.redis.del(sentKey).catch(() => undefined);
      this.o.log.error(
        { alert_key: key, error_code: err instanceof GhlError ? err.failure : (err as Error).name },
        'owner_alert_failed',
      );
      return this.record('failed', key);
    }
  }

  private async ownerContact(
    locationId: string,
    cfg: BusinessConfig,
    number: string,
    deadline: Deadline,
  ): Promise<string> {
    const cacheKey = `owner-contact:${locationId}:${number}`;
    const cached = await this.o.redis.get(cacheKey);
    if (cached) return cached;

    let contactId: string | null = null;
    try {
      const found = await this.o.ghl.request<{ contact?: { id: string } | null }>({
        method: 'GET',
        path: `/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&number=${encodeURIComponent(number)}`,
        version: '2021-07-28',
        locationId,
        deadline,
        operation: 'owner_contact_lookup',
      });
      contactId = found.contact?.id ?? null;
    } catch (err) {
      if (!(err instanceof GhlError && err.httpStatus === 404)) throw err;
    }
    if (!contactId) {
      const created = await this.o.ghl.request<{ contact: { id: string } }>({
        method: 'POST',
        path: '/contacts/',
        version: '2021-07-28',
        locationId,
        deadline,
        operation: 'owner_contact_create',
        body: {
          locationId,
          firstName: cfg.owner_first_name,
          lastName: '(business owner)',
          phone: number,
          tags: ['business-owner'],
        },
      });
      contactId = created.contact.id;
    }
    await this.o.redis.set(cacheKey, contactId, 'EX', OWNER_CACHE_TTL_S);
    return contactId;
  }

  private record(result: AlertResult, key: string): AlertResult {
    this.o.metrics.ownerAlerts.inc({ result });
    this.o.log.info({ alert_key: key, result }, 'owner_alert');
    return result;
  }
}

/** Parses ALERT_SMS_OVERRIDES ('{"<locationId>":"+44..."}') for demo/testing. */
export function parseAlertOverrides(json: string | undefined): Map<string, string> {
  if (!json) return new Map();
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ALERT_SMS_OVERRIDES must be a JSON object of locationId -> phone number');
  }
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'string' || !normalisePhone(v))
      throw new Error(`ALERT_SMS_OVERRIDES: invalid number for ${k}`);
    out.set(k, v);
  }
  return out;
}
