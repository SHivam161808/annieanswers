import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_LOCATION, authHeaders, startTestApp, type TestApp } from '../helpers/app.js';

const MONDAY_10AM = new Date('2026-11-02T10:00:00Z');
let t: TestApp;

beforeAll(async () => {
  t = await startTestApp({ now: () => MONDAY_10AM });
});
afterAll(() => t.close());

function post(action: string, body: Record<string, unknown>) {
  return t.app.inject({
    method: 'POST',
    url: `/v1/actions/${action}`,
    headers: authHeaders(),
    payload: { location_id: DEMO_LOCATION, call_id: 'call_test_1', ...body },
  });
}

describe('POST /v1/actions/check-service-area', () => {
  it('confirms an in-area postcode with a two-part read-back (TC008, TC004)', async () => {
    const res = await post('check-service-area', { postcode: 'ls six 2 a b' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      postcode_valid: true,
      postcode: 'LS6 2AB',
      readback: 'L S 6... 2 A B',
      in_service_area: true,
      needs_full_postcode: false,
      outcome_if_ending: null,
    });
  });

  it('declines out-of-area postcodes before any booking (Build Plan qualification rule 2)', async () => {
    const res = await post('check-service-area', { postcode: 'M1 1AE' });
    expect(res.json()).toMatchObject({
      in_service_area: false,
      outcome_if_ending: 'OUT_OF_AREA',
    });
    expect(res.json().instruction).toContain("doesn't cover");
  });

  it('asks for the rest of the postcode when only the outcode was given', async () => {
    const res = await post('check-service-area', { postcode: 'LS12' });
    expect(res.json()).toMatchObject({ in_service_area: true, needs_full_postcode: true });
  });

  it('asks the caller to repeat an unrecognised postcode instead of guessing', async () => {
    const res = await post('check-service-area', { postcode: 'somewhere near the park' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ postcode_valid: false, in_service_area: null });
  });

  it('treats a missing postcode as unrecognised', async () => {
    expect((await post('check-service-area', {})).json().postcode_valid).toBe(false);
  });

  it('accepts GHL workflow-webhook customData shape', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/actions/check-service-area',
      headers: authHeaders(),
      payload: { location: { id: DEMO_LOCATION }, customData: { postcode: 'WF1 2EE' } },
    });
    expect(res.json().in_service_area).toBe(true);
  });
});

describe('POST /v1/actions/call-context', () => {
  it('returns hours and UK-spoken date/time computed in Europe/London (TC005)', async () => {
    const res = await post('call-context', {});
    expect(res.json()).toEqual({
      in_hours: true,
      emergency_cover_active: true,
      today: 'Monday the 2nd',
      time_now: '10am',
      can_book_live: true,
    });
  });
});

describe('POST /v1/actions/escalation', () => {
  it('P1 gives safety script first and transfer (TC027, TC028, TC031)', async () => {
    const res = await post('escalation', { trigger: 'P1' });
    expect(res.json()).toMatchObject({
      safety_script_first: true,
      action: 'transfer',
      transfer_targets: ['primary', 'backup'],
      outcome: 'EMERGENCY_TRANSFERRED',
      outcome_if_transfer_fails: 'EMERGENCY_ALERTED',
    });
    expect(res.json().instruction).toMatch(/^Deliver the approved safety script first/);
  });

  it('personalises the instruction from config, never from the request', async () => {
    const res = await post('escalation', { trigger: 'complaint', owner: 'Mallory' });
    expect(res.json().instruction).toContain('Dave');
    expect(res.json().instruction).not.toContain('Mallory');
  });

  it('rejects unknown triggers with a validation error', async () => {
    const res = await post('escalation', { trigger: 'P0' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });
});

describe('request handling', () => {
  it('rejects requests without a location id', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/actions/call-context',
      headers: authHeaders(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns config_unavailable for unknown locations', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/actions/call-context',
      headers: authHeaders(),
      payload: { location_id: 'UNKNOWN_LOCATION' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('config_unavailable');
  });

  it('echoes a valid correlation id and generates one otherwise', async () => {
    const withId = await t.app.inject({
      method: 'POST',
      url: '/v1/actions/call-context',
      headers: { ...authHeaders(), 'x-correlation-id': 'corr-12345678' },
      payload: { location_id: DEMO_LOCATION },
    });
    expect(withId.headers['x-correlation-id']).toBe('corr-12345678');
    const generated = await post('call-context', {});
    expect(generated.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('serves health and readiness without auth', async () => {
    expect((await t.app.inject({ url: '/healthz' })).statusCode).toBe(200);
    const ready = await t.app.inject({ url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks).toEqual({ redis: true, config: true });
  });

  it('protects /metrics with its own token and exposes latency histograms', async () => {
    expect((await t.app.inject({ url: '/metrics' })).statusCode).toBe(401);
    await post('call-context', {});
    const res = await t.app.inject({
      url: '/metrics',
      headers: { authorization: 'Bearer test-metrics-token-0123456789abcdef' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(
      'annie_action_duration_seconds_bucket{le="1.5",action="call-context"',
    );
    expect(res.body).toContain('annie_http_request_duration_seconds');
  });
});

describe('form-encoded bodies', () => {
  it('parses application/x-www-form-urlencoded like JSON', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/v1/actions/check-service-area?location_id=${DEMO_LOCATION}`,
      headers: {
        'x-annie-secret': authHeaders()['x-annie-secret']!,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'postcode=LS6+2AB',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().postcode).toBe('LS6 2AB');
  });
});

describe('GET custom actions (GHL passes response fields to the agent only for GET)', () => {
  it('reads parameters from the query string', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/actions/check-service-area?location_id=${DEMO_LOCATION}&postcode=M1%201AE`,
      headers: { authorization: authHeaders()['x-annie-secret']! },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ in_service_area: false, outcome_if_ending: 'OUT_OF_AREA' });
  });

  it('serves escalation over GET', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/v1/actions/escalation?location_id=${DEMO_LOCATION}&trigger=P1`,
      headers: { authorization: authHeaders()['x-annie-secret']! },
    });
    expect(res.json().safety_script_first).toBe(true);
  });
});
