import { describe, expect, it } from 'vitest';
import { extractEnvelope } from '../../src/routes/ghl-envelope.js';
import { isAuthorised } from '../../src/security/auth.js';

const SECRETS = ['current-secret-0123456789abcdef0123', 'previous-secret-0123456789abcdef01'];

describe('isAuthorised', () => {
  it('accepts the current and previous secret (rotation)', () => {
    expect(isAuthorised({ 'x-annie-secret': SECRETS[0] }, SECRETS)).toBe(true);
    expect(isAuthorised({ 'x-annie-secret': SECRETS[1] }, SECRETS)).toBe(true);
  });

  it('accepts a bare Authorization value (GHL custom action authentication)', () => {
    expect(isAuthorised({ authorization: SECRETS[0] }, SECRETS)).toBe(true);
  });

  it('accepts a Bearer token', () => {
    expect(isAuthorised({ authorization: `Bearer ${SECRETS[0]}` }, SECRETS)).toBe(true);
  });

  it.each([
    {},
    { 'x-annie-secret': '' },
    { 'x-annie-secret': 'wrong' },
    { authorization: 'Bearer ' },
    { authorization: `Basic ${SECRETS[0]}` },
    { 'x-annie-secret': ['a', 'b'] },
  ])('rejects %j', (headers) => {
    expect(isAuthorised(headers, SECRETS)).toBe(false);
  });
});

describe('extractEnvelope', () => {
  it('reads ids from the top-level body', () => {
    const env = extractEnvelope(
      { call_id: 'call_1', location_id: 'loc_1', contact_id: 'c_1', postcode: 'LS6 2AB' },
      {},
      {},
    );
    expect(env).toMatchObject({ callId: 'call_1', locationId: 'loc_1', contactId: 'c_1' });
    expect(env.params.postcode).toBe('LS6 2AB');
  });

  it('reads workflow-webhook customData and nested location', () => {
    const env = extractEnvelope(
      { location: { id: 'loc_2' }, customData: { callId: 'call_2', outcome: 'BOOKED' } },
      {},
      {},
    );
    expect(env).toMatchObject({ callId: 'call_2', locationId: 'loc_2' });
    expect(env.params.outcome).toBe('BOOKED');
    expect(env.params.customData).toBeUndefined();
  });

  it('falls back to headers and query', () => {
    expect(extractEnvelope({}, { 'x-ghl-location-id': 'loc_h' }, {}).locationId).toBe('loc_h');
    expect(extractEnvelope({}, {}, { location_id: 'loc_q' }).locationId).toBe('loc_q');
  });

  it('ignores ids with unsafe characters', () => {
    const env = extractEnvelope({ call_id: '../../etc', location_id: 'a b' }, {}, {});
    expect(env.callId).toBeNull();
    expect(env.locationId).toBeNull();
  });

  it('tolerates non-object bodies', () => {
    expect(extractEnvelope('nope', {}, undefined).params).toEqual({});
    expect(extractEnvelope(null, {}, null).locationId).toBeNull();
  });
});
