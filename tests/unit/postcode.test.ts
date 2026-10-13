import { describe, expect, it } from 'vitest';
import { normalisePostcode, spokenReadback } from '../../src/domain/postcode.js';
import { INVALID_POSTCODES, POSTCODE_CASES } from '../fixtures/postcodes.js';

describe('normalisePostcode', () => {
  it.each(POSTCODE_CASES)('normalises "$spoken" -> $expected', ({ spoken, expected }) => {
    expect(normalisePostcode(spoken)?.postcode).toBe(expected);
  });

  it('recognises at least 95% of the recognition set (Build Plan target)', () => {
    const correct = POSTCODE_CASES.filter(
      (c) => normalisePostcode(c.spoken)?.postcode === c.expected,
    ).length;
    expect(correct / POSTCODE_CASES.length).toBeGreaterThanOrEqual(0.95);
  });

  it.each(INVALID_POSTCODES)('rejects invalid input %#', (input) => {
    expect(normalisePostcode(input)).toBeNull();
  });

  it('accepts an outcode on its own for the early area check', () => {
    expect(normalisePostcode('LS6')).toMatchObject({
      postcode: null,
      outcode: 'LS6',
      area: 'LS',
      districtNumber: 6,
    });
  });

  it('parses sub-districts', () => {
    expect(normalisePostcode('EC1A 1BB')).toMatchObject({
      outcode: 'EC1A',
      area: 'EC',
      districtNumber: 1,
      subDistrict: 'A',
    });
  });

  it('reads back in two parts, character by character', () => {
    const pc = normalisePostcode('LS6 2AB');
    expect(pc && spokenReadback(pc)).toBe('L S 6... 2 A B');
  });

  it('rejects non-string input defensively', () => {
    expect(normalisePostcode(42 as unknown as string)).toBeNull();
  });
});
