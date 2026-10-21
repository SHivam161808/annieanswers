import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  needsOwnerAlert,
  withAlertResult,
  type EscalationResponse,
} from '../../src/actions/escalation.js';
import { validateClientConfig } from '../../src/clients/config-store.js';

const raw = parse(readFileSync('config/clients/demo.yaml', 'utf8')) as Record<string, unknown>;
const client = validateClientConfig(raw, 'demo'); // owner Dave
const response = (action: string, instruction: string) =>
  ({ action, instruction }) as unknown as EscalationResponse;

describe('needsOwnerAlert', () => {
  it.each([
    ['emergency_alert', true],
    ['urgent_alert', true],
    ['transfer', false],
    ['offer_transfer', false],
    ['message', false],
    ['offer_callback', false],
    ['book', false],
  ])('%s -> %s', (action, expected) =>
    expect(needsOwnerAlert(response(action, 'x'))).toBe(expected),
  );
});

describe('withAlertResult', () => {
  it('without a "Then: " prefix the fallback instruction stands alone', () => {
    const r = withAlertResult(
      response('urgent_alert', 'Tell the caller you are sending Dave an urgent alert now.'),
      client,
      'failed',
    );
    expect(r).toEqual({
      action: 'urgent_alert',
      owner_alerted: false,
      instruction:
        'Take their name and best number. Do not say Dave has been alerted; say the details are going to Dave straight away as urgent.',
    });
  });

  it('a duplicate counts as alerted and keeps the instruction', () => {
    const r = withAlertResult(response('emergency_alert', 'Keep me.'), client, 'duplicate');
    expect(r).toEqual({ action: 'emergency_alert', instruction: 'Keep me.', owner_alerted: true });
  });
});
