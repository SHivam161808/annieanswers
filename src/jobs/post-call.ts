import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import type { BusinessConfig } from '../../config/schema/business-config.js';
import type { OwnerAlerts } from '../alerts/owner-alerts.js';
import { renderTemplate, type SmsTemplate } from '../alerts/templates.js';
import { isOutcomeCode, pipelineStageFor, type OutcomeCode } from '../core/outcome.js';
import { GhlError, type GhlClient } from '../ghl/client.js';
import { Deadline } from '../observability/timing.js';

/**
 * Post-call processor: what workflow WF-01 (outcome router) would do, run by the middleware so it
 * works without hand-built workflows. Every minute it picks up finished Voice AI calls once each:
 * tags the contact, updates ai_last_call_at / ai_call_count, moves the enquiry in the
 * "AI Receptionist Enquiries" pipeline (if it exists) and sends the owner the alert for the outcome.
 *
 * Safe to run on many instances at once (per-location lock) and to re-run (per-call done marker,
 * set only after every step succeeded; owner alerts are separately de-duplicated).
 */

export const PIPELINE_NAME = 'AI Receptionist Enquiries';

const OWNER_TEMPLATE: Partial<Record<OutcomeCode, string>> = {
  BOOKED: 'enquiry_alert_owner',
  BOOKING_REQUESTED: 'request_mode_owner',
  CALLBACK_REQUESTED: 'enquiry_alert_owner',
  MESSAGE_TAKEN: 'enquiry_alert_owner',
  EMERGENCY_ALERTED: 'emergency_alert_owner',
};

export interface CallLog {
  id: string;
  createdAt: string;
  contactId?: string;
  trialCall?: boolean;
  extractedData?: Record<string, unknown>;
}

interface Contact {
  id: string;
  firstName?: string | null;
  phone?: string | null;
  customFields?: { id: string; value?: unknown }[];
}

export interface PostCallOptions {
  ghl: GhlClient;
  redis: Redis;
  alerts: OwnerAlerts;
  templates: ReadonlyMap<string, SmsTemplate>;
  log: Logger;
  now?: () => number;
  /** How far back each run looks for finished calls. */
  lookbackMs?: number;
  /** Process calls only after this delay (lets GHL post-call extraction finish). */
  settleMs?: number;
  /** After this long without an extracted outcome, process the call as missing an outcome. */
  outcomeWaitMs?: number;
  maxCallsPerRun?: number;
}

export interface PostCallSummary {
  locationId: string;
  scanned: number;
  processed: number;
  skipped: number;
  failed: number;
  alerts: Record<string, number>;
}

export class PostCallProcessor {
  private readonly now: () => number;

  constructor(private readonly o: PostCallOptions) {
    this.now = o.now ?? Date.now;
  }

  async run(locationId: string, cfg: BusinessConfig): Promise<PostCallSummary> {
    const summary: PostCallSummary = {
      locationId,
      scanned: 0,
      processed: 0,
      skipped: 0,
      failed: 0,
      alerts: {},
    };
    const lockKey = `postcall:lock:${locationId}`;
    if ((await this.o.redis.set(lockKey, '1', 'PX', 55_000, 'NX')) !== 'OK') {
      this.o.log.info({ location_id: locationId }, 'post_call_locked');
      return summary;
    }
    try {
      const now = this.now();
      const deadline = new Deadline(45_000);
      const logs = await this.fetchLogs(
        locationId,
        now - (this.o.lookbackMs ?? 6 * 3600_000),
        now,
        deadline,
      );
      summary.scanned = logs.length;
      if (logs.length === 0) return summary; // nothing to do: no field or pipeline lookups
      const fields = await this.fieldIds(locationId, deadline);
      const pipeline = await this.pipeline(locationId, deadline);
      const settle = this.o.settleMs ?? 90_000;

      for (const log of logs.slice(0, this.o.maxCallsPerRun ?? 100)) {
        const doneKey = `postcall:done:${locationId}:${log.id}`;
        if (
          log.trialCall ||
          !log.contactId ||
          Date.parse(log.createdAt) > now - settle ||
          (await this.o.redis.exists(doneKey))
        ) {
          summary.skipped++;
          continue;
        }
        try {
          if (await this.processCall(locationId, cfg, log, fields, pipeline, deadline, summary)) {
            await this.o.redis.set(doneKey, '1', 'EX', 14 * 24 * 3600);
            summary.processed++;
          } else {
            summary.skipped++;
          }
        } catch (err) {
          summary.failed++;
          this.o.log.error(
            {
              ghl_call_id: log.id,
              error_code: err instanceof GhlError ? err.failure : (err as Error).message,
            },
            'post_call_failed',
          );
        }
      }
      this.o.log.info({ ...summary }, 'post_call_run');
      return summary;
    } finally {
      await this.o.redis.del(lockKey).catch(() => undefined);
    }
  }

  private async processCall(
    locationId: string,
    cfg: BusinessConfig,
    log: CallLog,
    fields: Map<string, string>,
    pipeline: { id: string; stages: Map<string, string> } | null,
    deadline: Deadline,
    summary: PostCallSummary,
  ): Promise<boolean> {
    const contact = (
      await this.o.ghl.request<{ contact: Contact }>({
        method: 'GET',
        path: `/contacts/${encodeURIComponent(log.contactId!)}`,
        version: '2021-07-28',
        locationId,
        deadline,
        operation: 'post_call_contact',
      })
    ).contact;
    const field = (key: string): string | null => {
      const id = fields.get(key);
      const v = id ? contact.customFields?.find((f) => f.id === id)?.value : undefined;
      return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : null;
    };
    const extracted = log.extractedData?.ai_call_outcome;
    const rawOutcome = typeof extracted === 'string' ? extracted.trim() : field('ai_call_outcome');
    const outcome: OutcomeCode | null = isOutcomeCode(rawOutcome) ? rawOutcome : null;
    if (
      !outcome &&
      Date.parse(log.createdAt) > this.now() - (this.o.outcomeWaitMs ?? 10 * 60_000)
    ) {
      return false; // extraction may still be running; try again on the next run
    }

    const tag = outcome
      ? `outcome-${outcome.toLowerCase().replaceAll('_', '-')}`
      : 'outcome-missing';
    await this.o.ghl.request({
      method: 'POST',
      path: `/contacts/${encodeURIComponent(contact.id)}/tags`,
      version: '2021-07-28',
      locationId,
      deadline,
      operation: 'post_call_tags',
      body: { tags: ['ai-call', tag] },
    });

    const updates: { id: string; field_value: string | number }[] = [];
    const lastAtId = fields.get('ai_last_call_at');
    const countId = fields.get('ai_call_count');
    if (lastAtId) updates.push({ id: lastAtId, field_value: log.createdAt.slice(0, 10) });
    if (countId)
      updates.push({ id: countId, field_value: Number(field('ai_call_count') ?? 0) + 1 });
    if (updates.length) {
      await this.o.ghl.request({
        method: 'PUT',
        path: `/contacts/${encodeURIComponent(contact.id)}`,
        version: '2021-07-28',
        locationId,
        deadline,
        operation: 'post_call_fields',
        body: { customFields: updates },
      });
    }

    const stageName = outcome
      ? pipelineStageFor(outcome, Boolean(contact.phone))
      : 'Callback needed';
    const stageId = stageName && pipeline ? pipeline.stages.get(stageName) : undefined;
    if (pipeline && stageId) {
      await this.upsertOpportunity(locationId, contact, pipeline.id, stageId, field, deadline);
    }

    const text = this.ownerText(cfg, outcome, contact, field);
    if (text) {
      const result = await this.o.alerts.send(
        locationId,
        cfg,
        text,
        `${log.id}:post-call`,
        deadline,
      );
      summary.alerts[result] = (summary.alerts[result] ?? 0) + 1;
      if (result === 'failed') throw new Error('owner_alert_failed');
    }
    return true;
  }

  private ownerText(
    cfg: BusinessConfig,
    outcome: OutcomeCode | null,
    contact: Contact,
    field: (k: string) => string | null,
  ): string | null {
    if (!outcome) {
      return `${cfg.business_name}: a call ended without an outcome. Please check the AI receptionist calls.`;
    }
    if (outcome === 'TECH_FAILURE') {
      return `${cfg.business_name}: the AI receptionist couldn't complete a call${contact.phone ? ` from ${contact.phone}` : ''}. Please ring them back.`;
    }
    const id = OWNER_TEMPLATE[outcome];
    const template = id ? this.o.templates.get(id) : undefined;
    if (!template) return null;
    const values: Record<string, string | null> = {
      'custom_values.business_name': cfg.business_name,
      'contact.first_name': contact.firstName ?? 'A caller',
      'contact.phone': contact.phone ?? 'number not given',
      'contact.ai_call_outcome': outcome,
    };
    for (const key of ['ai_urgency', 'ai_issue_summary', 'job_postcode', 'preferred_window']) {
      values[`contact.${key}`] = field(key);
    }
    return renderTemplate(template.body, values);
  }

  private async upsertOpportunity(
    locationId: string,
    contact: Contact,
    pipelineId: string,
    stageId: string,
    field: (k: string) => string | null,
    deadline: Deadline,
  ): Promise<void> {
    const found = await this.o.ghl.request<{
      opportunities?: { id: string; pipelineId: string }[];
    }>({
      method: 'GET',
      path: `/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contact.id)}&pipeline_id=${encodeURIComponent(pipelineId)}`,
      version: '2021-07-28',
      locationId,
      deadline,
      operation: 'post_call_opportunity_search',
    });
    const existing = found.opportunities?.find((o) => o.pipelineId === pipelineId);
    if (existing) {
      await this.o.ghl.request({
        method: 'PUT',
        path: `/opportunities/${encodeURIComponent(existing.id)}`,
        version: '2021-07-28',
        locationId,
        deadline,
        operation: 'post_call_opportunity_update',
        body: { pipelineId, pipelineStageId: stageId, status: 'open' },
      });
      return;
    }
    await this.o.ghl.request({
      method: 'POST',
      path: '/opportunities/',
      version: '2021-07-28',
      locationId,
      deadline,
      operation: 'post_call_opportunity_create',
      body: {
        pipelineId,
        locationId,
        contactId: contact.id,
        pipelineStageId: stageId,
        status: 'open',
        name: `${contact.firstName ?? 'Caller'} – ${field('ai_issue_type') ?? 'enquiry'}`.slice(
          0,
          100,
        ),
      },
    });
  }

  private async fetchLogs(
    locationId: string,
    from: number,
    to: number,
    deadline: Deadline,
  ): Promise<CallLog[]> {
    const logs: CallLog[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await this.o.ghl.request<{
        callLogs?: CallLog[];
        totalRecords?: number;
        total?: number;
      }>({
        method: 'GET',
        path: `/voice-ai/dashboard/call-logs?locationId=${encodeURIComponent(locationId)}&startDate=${from}&endDate=${to}&page=${page}&pageSize=50`,
        version: 'v3',
        locationId,
        deadline,
        operation: 'post_call_logs',
      });
      logs.push(...(res.callLogs ?? []));
      // GHL returns `totalRecords` (live API, Oct 2026); `total` kept as a fallback.
      const total = res.totalRecords ?? res.total ?? 0;
      if (!res.callLogs?.length || logs.length >= total) break;
    }
    return logs.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  private async fieldIds(locationId: string, deadline: Deadline): Promise<Map<string, string>> {
    const cacheKey = `postcall:fields:${locationId}`;
    const cached = await this.o.redis.get(cacheKey);
    if (cached) return new Map(Object.entries(JSON.parse(cached) as Record<string, string>));
    const res = await this.o.ghl.request<{ customFields?: { id: string; name: string }[] }>({
      method: 'GET',
      path: `/locations/${encodeURIComponent(locationId)}/customFields?model=contact`,
      version: '2021-07-28',
      locationId,
      deadline,
      operation: 'post_call_field_ids',
    });
    // Stryker disable next-line ArrayDeclaration: a nameless placeholder entry is never looked up or cached (JSON drops it).
    const map = new Map((res.customFields ?? []).map((f) => [f.name, f.id]));
    await this.o.redis.set(cacheKey, JSON.stringify(Object.fromEntries(map)), 'EX', 3600);
    return map;
  }

  private async pipeline(
    locationId: string,
    deadline: Deadline,
  ): Promise<{ id: string; stages: Map<string, string> } | null> {
    const res = await this.o.ghl.request<{
      pipelines?: { id: string; name: string; stages: { id: string; name: string }[] }[];
    }>({
      method: 'GET',
      path: `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
      version: '2021-07-28',
      locationId,
      deadline,
      operation: 'post_call_pipelines',
    });
    const p = res.pipelines?.find((x) => x.name === PIPELINE_NAME);
    if (!p) {
      this.o.log.warn({ location_id: locationId }, 'pipeline_missing');
      return null;
    }
    return { id: p.id, stages: new Map(p.stages.map((s) => [s.name, s.id])) };
  }
}
