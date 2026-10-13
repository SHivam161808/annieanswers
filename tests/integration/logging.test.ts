import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_LOCATION, authHeaders, startTestApp, type TestApp } from '../helpers/app.js';

const lines: Record<string, unknown>[] = [];
const sink = new Writable({
  write(chunk: Buffer, _enc, cb) {
    for (const line of chunk.toString().split('\n').filter(Boolean)) lines.push(JSON.parse(line));
    cb();
  },
});

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp({ logStream: sink });
});
afterAll(() => t.close());

describe('structured request logging', () => {
  it('logs one line per request with ids, status and latency, and no caller data', async () => {
    lines.length = 0;
    await t.app.inject({
      method: 'POST',
      url: '/v1/actions/check-service-area',
      headers: { ...authHeaders(), 'x-correlation-id': 'corr-logging-1' },
      payload: {
        location_id: DEMO_LOCATION,
        call_id: 'call_log_1',
        postcode: 'LS6 2AB',
        phone: '+447700900999',
        name: 'Jane Caller',
      },
    });

    const completed = lines.filter((l) => l.msg === 'request_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      level: 'info',
      service: 'annie-api',
      correlation_id: 'corr-logging-1',
      ghl_call_id: 'call_log_1',
      location_id: DEMO_LOCATION,
      action: 'check-service-area',
      status: 200,
      route: '/v1/actions/check-service-area',
    });
    expect(typeof completed[0]?.latency_ms).toBe('number');

    const all = JSON.stringify(lines);
    expect(all).not.toContain('LS6 2AB');
    expect(all).not.toContain('+447700900999');
    expect(all).not.toContain('Jane Caller');
    expect(all).not.toContain('test-webhook-secret');
  });

  it('logs the error code for rejected requests', async () => {
    lines.length = 0;
    await t.app.inject({ method: 'POST', url: '/v1/actions/call-context', payload: {} });
    expect(lines.find((l) => l.msg === 'request_completed')).toMatchObject({
      status: 401,
      error_code: 'unauthorized',
    });
  });
});
