import { describe, expect, it } from 'vitest';
import { normalisePostcode, parseOutcode } from '../../src/domain/postcode.js';
import {
  ServiceAreaParseError,
  isInServiceArea,
  parseServiceAreaPattern,
} from '../../src/domain/service-area.js';
import { extractEnvelope } from '../../src/routes/ghl-envelope.js';
import { isAuthorised } from '../../src/security/auth.js';
import { rng } from '../helpers/random.js';

const RUNS = 5000;
const VALID = /^([A-Z]{1,2}[0-9][A-Z0-9]?) ([0-9][ABD-HJLNP-UW-Z]{2})$/;

describe('fuzz: postcode normaliser', () => {
  it('never throws, and returns either null or a well-formed postcode/outcode', () => {
    const r = rng(1);
    for (let i = 0; i < RUNS; i++) {
      const input = r.string(30);
      const out = normalisePostcode(input);
      if (out === null) continue;
      if (out.postcode !== null)
        expect(out.postcode === 'GIR 0AA' || VALID.test(out.postcode), input).toBe(true);
      expect(parseOutcode(out.outcode) ?? out.outcode === 'GIR', input).toBeTruthy();
    }
  });

  it('is idempotent: normalising a normalised postcode returns it unchanged', () => {
    const r = rng(2);
    const letters = 'ABDEFGHJLNPQRSTUWXYZ';
    for (let i = 0; i < RUNS; i++) {
      const area = r.pick(['LS', 'M', 'B', 'EC', 'WF', 'SW', 'G', 'BT', 'CF', 'OL']);
      const pc = `${area}${1 + r.int(29)} ${r.int(10)}${letters[r.int(letters.length)]}${letters[r.int(letters.length)]}`;
      const once = normalisePostcode(pc);
      expect(once?.postcode, pc).toBe(pc);
      expect(normalisePostcode(once!.postcode!)?.postcode).toBe(pc);
      // Same postcode spoken with spaces between every character must normalise identically.
      expect(normalisePostcode(pc.replace(/ /g, '').split('').join(' '))?.postcode, pc).toBe(pc);
    }
  });

  it('never accepts more than 64 characters (bounded work per request)', () => {
    expect(normalisePostcode(`LS6 2AB${' '.repeat(100)}`)).toBeNull();
  });
});

describe('fuzz: service area patterns', () => {
  it('either parses or throws ServiceAreaParseError — never anything else', () => {
    const r = rng(3);
    for (let i = 0; i < RUNS; i++) {
      const pattern = r.string(12);
      try {
        const rule = parseServiceAreaPattern(pattern);
        const pc = normalisePostcode('LS6 2AB')!;
        expect(typeof isInServiceArea([rule], pc)).toBe('boolean');
      } catch (err) {
        expect(err, pattern).toBeInstanceOf(ServiceAreaParseError);
      }
    }
  });
});

describe('fuzz: GHL envelope parser', () => {
  it('never throws on arbitrary bodies, headers and queries, and ids are always safe', () => {
    const r = rng(4);
    for (let i = 0; i < RUNS; i++) {
      const env = extractEnvelope(
        r.value(),
        { 'x-ghl-location-id': r.string(30) as string },
        r.value(),
      );
      for (const id of [env.callId, env.locationId, env.contactId]) {
        if (id !== null) expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
      }
      expect(typeof env.params).toBe('object');
    }
  });

  it('is not vulnerable to prototype pollution through customData', () => {
    extractEnvelope(
      JSON.parse('{"customData":{"__proto__":{"polluted":true}},"__proto__":{"x":1}}'),
      {},
      {},
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('fuzz: authentication', () => {
  it('never authorises random credentials and never throws', () => {
    const r = rng(5);
    const secrets = ['a-real-secret-that-is-long-enough-0001'];
    for (let i = 0; i < RUNS; i++) {
      const headers = r.pick([
        { 'x-annie-secret': r.string(50) },
        { authorization: r.string(50) },
        { authorization: `Bearer ${r.string(50)}` },
        { 'x-annie-secret': [r.string(10), r.string(10)] },
        {},
      ]);
      expect(isAuthorised(headers, secrets)).toBe(false);
    }
  });
});
