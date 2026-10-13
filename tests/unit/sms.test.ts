import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { CONTACT_FIELDS } from '../../config/schema/contact-fields.js';

const templateSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]+$/),
    workflow: z.string().regex(/^WF-(0[2-9]|1[0-3])$/),
    to: z.enum(['customer', 'owner']),
    status: z.enum(['draft', 'approved']),
    body: z.string().min(1),
  })
  .strict();

const templates = z
  .object({ templates: z.array(templateSchema).min(1) })
  .parse(parse(readFileSync('ghl/sms-templates.yaml', 'utf8'))).templates;

const MERGE = /\{\{\s*([a-z_]+\.[a-z0-9_]+)\s*\}\}/g;
const ALLOWED_FIELDS = new Set([
  'custom_values.business_name',
  'appointment.start_time',
  'contact.first_name',
  'contact.phone',
  'message.body',
  ...CONTACT_FIELDS.map((f) => `contact.${f.key}`),
]);

/** Realistic, deliberately long values for length checks. */
const SAMPLE: Record<string, string> = {
  'custom_values.business_name': 'Smith & Sons Plumbing Ltd',
  'appointment.start_time': 'Tuesday, October 14, 2026 9:00 AM',
  'contact.first_name': 'Jane',
  'contact.phone': '+447700900123',
  'message.body':
    'Can you come a bit earlier? I have to leave for work at 9 and the key is with my neighbour at 12.',
  'contact.ai_issue_summary': 'Dripping kitchen tap for a week, getting worse. Booked Tuesday 9am.',
  'contact.ai_call_outcome': 'CALLBACK_REQUESTED',
  'contact.ai_urgency': 'P2',
  'contact.job_postcode': 'LS6 2AB',
  'contact.preferred_window': 'Tuesday morning or Wednesday after lunch',
};

const render = (body: string) =>
  body.replace(MERGE, (_m, key: string) => SAMPLE[key] ?? 'x'.repeat(20));

// GSM 03.38 basic set (+ € and common extension chars). Anything else forces UCS-2 (70 chars/segment).
const GSM7 =
  /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;

describe('SMS templates (Build Plan SMS rules)', () => {
  it('have unique ids', () => {
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
  });

  it.each(templates.map((t) => [t.id, t]))('%s: business name comes first', (_id, t) => {
    expect(t.body.startsWith('{{custom_values.business_name}}')).toBe(true);
  });

  it.each(templates.map((t) => [t.id, t]))('%s: uses only known merge fields', (_id, t) => {
    for (const [, field] of t.body.matchAll(MERGE)) expect(ALLOWED_FIELDS, field).toContain(field);
    expect(t.body.replace(MERGE, '')).not.toMatch(/\{\{|\}\}/);
  });

  it.each(templates.map((t) => [t.id, t]))(
    '%s: GSM-7 characters only (no curly quotes or emoji)',
    (_id, t) => {
      expect(render(t.body)).toMatch(GSM7);
    },
  );

  it.each(templates.filter((t) => t.to === 'customer').map((t) => [t.id, t]))(
    '%s: customer SMS fits one 160-character segment with realistic values',
    (_id, t) => {
      expect(render(t.body).length).toBeLessThanOrEqual(160);
    },
  );

  it.each(templates.filter((t) => t.to === 'owner').map((t) => [t.id, t]))(
    '%s: owner alert fits two segments (306 characters)',
    (_id, t) => {
      expect(render(t.body).length).toBeLessThanOrEqual(306);
    },
  );

  it.each(templates.map((t) => [t.id, t]))(
    '%s: transactional only, no marketing (PECR)',
    (_id, t) => {
      expect(t.body).not.toMatch(
        /\b(offer|discount|deal|sale|promo|% off|win|free gift|subscribe|https?:\/\/)/i,
      );
    },
  );

  it('customer texts never include internal codes or other customers', () => {
    for (const t of templates.filter((x) => x.to === 'customer')) {
      expect(t.body).not.toMatch(/ai_call_outcome|ai_urgency|ai_job_notes|contact\.phone/);
    }
  });

  it('covers every SMS-sending workflow', () => {
    const workflows = new Set(templates.map((t) => t.workflow));
    for (const wf of [
      'WF-02',
      'WF-03',
      'WF-04',
      'WF-05',
      'WF-06',
      'WF-07',
      'WF-09',
      'WF-11',
      'WF-13',
    ]) {
      expect(workflows).toContain(wf);
    }
  });
});
