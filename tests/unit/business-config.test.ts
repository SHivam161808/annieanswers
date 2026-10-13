import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ConfigValidationError, validateClientConfig } from '../../src/clients/config-store.js';

const demo = parse(readFileSync('config/clients/demo.yaml', 'utf8')) as Record<string, unknown>;

function issuesFor(overrides: Record<string, unknown>): string[] {
  try {
    validateClientConfig({ ...demo, ...overrides }, 'test.yaml');
    return [];
  } catch (err) {
    if (err instanceof ConfigValidationError) return err.issues;
    throw err;
  }
}

describe('business configuration model', () => {
  it('accepts the DEMO client', () => {
    expect(issuesFor({})).toEqual([]);
  });

  it('pre-parses service area rules', () => {
    const client = validateClientConfig(demo, 'demo.yaml');
    expect(client.serviceAreaRules).toHaveLength(2);
  });

  it.each([
    ['business_name', undefined],
    ['owner_first_name', undefined],
    ['transfer_number_primary', undefined],
    ['callback_promise', undefined],
    ['quote_policy', undefined],
  ])('requires %s', (key, value) => {
    expect(issuesFor({ [key]: value }).join()).toContain(key);
  });

  it('rejects unknown keys (typos must not be silently ignored)', () => {
    expect(issuesFor({ busines_name: 'x' }).length).toBeGreaterThan(0);
  });

  it('rejects non-E.164 numbers', () => {
    expect(issuesFor({ transfer_number_primary: '07700 900123' }).join()).toContain('E.164');
  });

  it('rejects a service both offered and not offered', () => {
    expect(issuesFor({ services_not_offered: ['leak_repair'] }).join()).toContain('leak_repair');
  });

  it('rejects gas work without Gas Safe registration', () => {
    const issues = issuesFor({
      services_offered: ['leak_repair', 'gas_boiler'],
      services_not_offered: [],
    });
    expect(issues.join()).toContain('gas_safe_registered');
  });

  it('allows gas work when Gas Safe registered', () => {
    expect(
      issuesFor({
        services_offered: ['leak_repair', 'gas_boiler'],
        services_not_offered: [],
        gas_safe_registered: true,
      }),
    ).toEqual([]);
  });

  it('rejects invalid service area patterns', () => {
    expect(issuesFor({ service_area: ['LS1-WF3'] }).join()).toContain('service_area');
  });

  it('requires extended_hours when cover is extended', () => {
    expect(issuesFor({ emergency_cover: 'extended' }).join()).toContain('extended_hours');
  });

  it('rejects external booking mode in V1', () => {
    expect(issuesFor({ booking_mode: 'external' }).join()).toContain('not built in V1');
  });

  it('requires calendar fields for calendar booking modes', () => {
    const issues = issuesFor({ calendar_id: undefined, appointment_types: [] });
    expect(issues.join()).toContain('calendar_id');
    expect(issues.join()).toContain('appointment_types');
  });

  it('allows request mode without a calendar', () => {
    expect(
      issuesFor({
        booking_mode: 'request_mode',
        calendar_id: undefined,
        appointment_types: [],
        job_appointment_types: {},
      }),
    ).toEqual([]);
  });

  it('rejects out-of-hours transfer triggers other than P1/P2', () => {
    const issues = issuesFor({
      transfer_rules: { in_hours: ['P1'], out_of_hours: ['P1', 'asks_for_owner'] },
    });
    expect(issues.join()).toContain('asks_for_owner');
  });

  it('rejects approved sentences containing template syntax', () => {
    expect(issuesFor({ callback_promise: 'Call {{owner}} back' }).join()).toContain(
      'callback_promise',
    );
  });

  it('rejects opening windows that end before they start', () => {
    expect(
      issuesFor({ opening_hours: { mon: [{ open: '17:00', close: '09:00' }] } }).join(),
    ).toContain('opening_hours');
  });

  it('rejects backup transfer number equal to primary', () => {
    expect(issuesFor({ transfer_number_backup: demo.transfer_number_primary }).join()).toContain(
      'transfer_number_backup',
    );
  });

  it('validates job -> appointment type mapping (T-501)', () => {
    expect(issuesFor({ job_appointment_types: { leak_repair: 'assessment' } })).toEqual([]);
    expect(issuesFor({ job_appointment_types: { leak_repair: 'full_day' } }).join()).toContain(
      'job_appointment_types',
    );
    expect(
      issuesFor({ job_appointment_types: { not_a_job: 'assessment' } }).length,
    ).toBeGreaterThan(0);
  });
});
