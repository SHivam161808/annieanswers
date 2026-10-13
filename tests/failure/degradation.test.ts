import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_LOCATION, authHeaders, startTestApp, type TestApp } from '../helpers/app.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const call = (app: TestApp['app']) =>
  app.inject({
    method: 'POST',
    url: '/v1/actions/check-service-area',
    headers: authHeaders(),
    payload: { location_id: DEMO_LOCATION, postcode: 'LS6 2AB' },
  });

describe('failure behaviour', () => {
  it('TC060 rate-limits per location with a retryable 429', async () => {
    t = await startTestApp({ env: { RATE_LIMIT_PER_MINUTE: '3' } });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await call(t.app)).statusCode);
    expect(statuses).toEqual([200, 200, 200, 429]);
    const limited = await call(t.app);
    expect(limited.json().error).toMatchObject({ code: 'rate_limited', retryable: true });
  });

  it('TC061 keeps serving read-only actions when Redis is down; readiness reports it', async () => {
    t = await startTestApp();
    t.redis.disconnect();
    const res = await call(t.app);
    expect(res.statusCode).toBe(200);
    expect(res.json().in_service_area).toBe(true);

    const ready = await t.app.inject({ url: '/readyz' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json().checks.redis).toBe(false);
  });

  it('TC062 a fresh instance serves identically (no in-process call state)', async () => {
    t = await startTestApp();
    const before = (await call(t.app)).json();
    await t.close();
    t = await startTestApp();
    expect((await call(t.app)).json()).toEqual(before);
  });
});
