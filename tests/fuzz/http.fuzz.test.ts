import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_LOCATION, TEST_SECRET, startTestApp, type TestApp } from '../helpers/app.js';
import { rng } from '../helpers/random.js';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp({ env: { RATE_LIMIT_PER_MINUTE: '1000000' } });
});
afterAll(() => t.close());

const ROUTES = [
  'check-service-area',
  'call-context',
  'escalation',
  'unknown',
  '../admin',
  '%00',
  'check-service-area/extra',
];
const CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'text/plain',
  'application/xml',
  undefined,
];

describe('fuzz: HTTP API never returns 5xx for bad input', () => {
  it('handles 2000 random requests with only 2xx/4xx and a JSON error envelope', async () => {
    const r = rng(6);
    for (let i = 0; i < 2000; i++) {
      const method = r.pick(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) as 'GET';
      const contentType = r.pick(CONTENT_TYPES);
      const body =
        method === 'GET'
          ? undefined
          : r.pick([JSON.stringify(r.value()), r.string(200), '', '{"a":']);
      const query = r.pick([
        '',
        `?location_id=${DEMO_LOCATION}`,
        `?location_id=${encodeURIComponent(r.string(20))}&postcode=${encodeURIComponent(r.string(15))}&trigger=${encodeURIComponent(r.string(8))}`,
      ]);
      const headers: Record<string, string> = {};
      if (contentType && body !== undefined) headers['content-type'] = contentType;
      if (r.next() > 0.2) headers.authorization = r.next() > 0.3 ? TEST_SECRET : r.string(30);
      const res = await t.app.inject({
        method,
        url: `/v1/actions/${r.pick(ROUTES)}${query}`,
        headers,
        payload: body,
      });
      expect(res.statusCode, `request ${i}`).toBeLessThan(500);
      if (res.statusCode >= 400) expect(res.json().error.code, `request ${i}`).toBeTypeOf('string');
    }
  });
});
