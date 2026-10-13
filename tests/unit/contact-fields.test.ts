import { describe, expect, it } from 'vitest';
import { CONTACT_FIELDS, MAX_EXTRACT_LENGTH } from '../../config/schema/contact-fields.js';
import { JOB_TYPES } from '../../src/core/job-types.js';
import { OUTCOME_CODES, isOutcomeCode } from '../../src/core/outcome.js';
import { URGENCY_LEVELS } from '../../src/core/urgency.js';

const field = (key: string) => CONTACT_FIELDS.find((f) => f.key === key);

describe('universal contact fields', () => {
  it('has unique keys in GHL-safe form', () => {
    const keys = CONTACT_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]{2,40}$/);
  });

  it('covers every Build Plan field filled by extraction', () => {
    for (const key of [
      'ai_issue_type',
      'ai_urgency',
      'ai_issue_summary',
      'job_postcode',
      'job_address',
      'in_service_area',
      'property_type',
      'caller_role',
      'access_notes',
      'preferred_window',
      'ai_call_outcome',
    ]) {
      expect(field(key), key).toBeDefined();
    }
  });

  it('adds engineer job notes from the receptionist research', () => {
    expect(field('ai_job_notes')?.extract).toMatch(/never add a diagnosis/i);
  });

  it('lists every outcome code, and only valid codes as examples', () => {
    const outcome = field('ai_call_outcome')!;
    for (const code of OUTCOME_CODES) expect(outcome.extract).toContain(code);
    for (const ex of outcome.examples) expect(isOutcomeCode(ex)).toBe(true);
  });

  it('lists every job type and urgency level for their fields', () => {
    for (const code of JOB_TYPES) expect(field('ai_issue_type')!.extract).toContain(code);
    for (const ex of field('ai_issue_type')!.examples) expect(JOB_TYPES).toContain(ex);
    for (const ex of field('ai_urgency')!.examples) expect(URGENCY_LEVELS).toContain(ex);
  });

  it('respects GHL extraction limits (1–5 examples, description length)', () => {
    for (const f of CONTACT_FIELDS) {
      expect(f.extract.length, f.key).toBeLessThanOrEqual(MAX_EXTRACT_LENGTH);
      expect(f.examples.length).toBeGreaterThanOrEqual(1);
      expect(f.examples.length).toBeLessThanOrEqual(5);
    }
  });

  it('never asks the extractor for phone numbers or emails in free text', () => {
    expect(field('ai_issue_summary')!.extract).toMatch(/no phone numbers or email/i);
  });
});
