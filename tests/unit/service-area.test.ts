import { describe, expect, it } from 'vitest';
import { normalisePostcode } from '../../src/domain/postcode.js';
import {
  ServiceAreaParseError,
  isInServiceArea,
  parseServiceArea,
  parseServiceAreaPattern,
} from '../../src/domain/service-area.js';

function inArea(patterns: string[], postcode: string): boolean {
  const pc = normalisePostcode(postcode);
  if (!pc) throw new Error(`bad fixture ${postcode}`);
  return isInServiceArea(parseServiceArea(patterns), pc);
}

describe('service area', () => {
  const demo = ['LS1-LS29', 'WF1-WF3'];

  it.each([
    ['LS1 4DY', true],
    ['LS6 2AB', true],
    ['LS29 8AB', true],
    ['WF3 1QR', true],
  ])('%s in demo area -> %s', (postcode, expected) => {
    expect(inArea(demo, postcode)).toBe(expected);
  });

  it.each(['WF4 1AA', 'L1 8JQ', 'BD1 1HY', 'M1 1AE'])('%s is outside the demo area', (pc) => {
    expect(inArea(demo, pc)).toBe(false);
  });

  it('does not confuse area L with LS', () => {
    expect(inArea(['L1-L9'], 'LS6 2AB')).toBe(false);
    expect(inArea(['L1-L9'], 'L1 8JQ')).toBe(true);
  });

  it('matches whole areas', () => {
    expect(inArea(['BD'], 'BD1 1HY')).toBe(true);
    expect(inArea(['BD'], 'LS1 4DY')).toBe(false);
  });

  it('matches single districts and sub-districts', () => {
    expect(inArea(['EC1A'], 'EC1A 1BB')).toBe(true);
    expect(inArea(['EC1A'], 'EC1M 1BB')).toBe(false);
    expect(inArea(['EC1'], 'EC1M 1BB')).toBe(true);
    expect(inArea(['EC1-EC4'], 'EC1A 1BB')).toBe(true);
  });

  it('works with an outcode-only lookup', () => {
    expect(inArea(demo, 'LS12')).toBe(true);
    expect(inArea(demo, 'LS30')).toBe(false);
  });

  it.each(['LS1-WF3', 'LS9-LS1', 'LS1-', '12', 'EC1A-EC2A', 'LS1-LS2-LS3'])(
    'rejects invalid pattern %s',
    (pattern) => {
      expect(() => parseServiceAreaPattern(pattern)).toThrow(ServiceAreaParseError);
    },
  );
});
