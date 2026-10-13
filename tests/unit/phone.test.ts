import { describe, expect, it } from 'vitest';
import { normalisePhone, spokenPhone } from '../../src/domain/phone.js';
import { rng } from '../helpers/random.js';

describe('normalisePhone', () => {
  it.each([
    ['07700 900123', '+447700900123', '07700 900123'],
    ['07700900123', '+447700900123', '07700 900123'],
    ['+44 7700 900123', '+447700900123', '07700 900123'],
    ['+44 (0)7700 900123', '+447700900123', '07700 900123'],
    ['0044 7700 900123', '+447700900123', '07700 900123'],
    ['447700900123', '+447700900123', '07700 900123'],
    ['0117 463 3467', '+441174633467', '0117 463 3467'],
    ['(0117) 4633467', '+441174633467', '0117 463 3467'],
    ['020 7946 0018', '+442079460018', '020 7946 0018'],
    ['oh seven seven double oh nine oh oh one two three', '+447700900123', '07700 900123'],
    ['zero one one seven, four six three, three four six seven', '+441174633467', '0117 463 3467'],
    ['0 7 7 0 0 - 9 0 0 - 1 2 3', '+447700900123', '07700 900123'],
  ])('%s -> %s', (input, e164, national) => {
    expect(normalisePhone(input)).toEqual({ e164, isUk: true, national });
  });

  it('accepts international E.164 (e.g. an Indian mobile)', () => {
    expect(normalisePhone('+91 98765 43210')).toEqual({
      e164: '+919876543210',
      isUk: false,
      national: null,
    });
  });

  it.each([
    '',
    '123',
    '0770090012',
    '077009001234',
    '+44 1',
    'call me',
    '+0123456789',
    'x'.repeat(65),
    '01174633467 ext 2',
  ])('rejects %j', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(normalisePhone(7700900123)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
  });

  it('fuzz: never throws; output is always valid E.164', () => {
    const r = rng(11);
    for (let i = 0; i < 5000; i++) {
      const out = normalisePhone(r.string(25));
      if (out) expect(out.e164).toMatch(/^\+[1-9]\d{7,14}$/);
    }
  });

  it('round-trips: normalising the national form gives the same E.164', () => {
    const r = rng(12);
    for (let i = 0; i < 1000; i++) {
      const nsn = `7${String(r.int(1e9)).padStart(9, '0')}`;
      const once = normalisePhone(`0${nsn}`)!;
      expect(normalisePhone(once.national!)!.e164).toBe(once.e164);
      expect(normalisePhone(once.e164)!.e164).toBe(once.e164);
    }
  });
});

describe('spokenPhone', () => {
  it('reads back in UK groups with "double"', () => {
    expect(spokenPhone('07700 900123')).toBe(
      'oh double seven double oh, nine double oh, one two three',
    );
    expect(spokenPhone('0117 463 3467')).toBe(
      'oh double one seven, four six three, three four six seven',
    );
  });
  it('says "treble" for three in a row and splits longer runs', () => {
    expect(spokenPhone('07000 111222')).toBe('oh seven treble oh, treble one, treble two');
    expect(spokenPhone('00000')).toBe('treble oh double oh');
  });
});

describe('normalisePhone edges (mutation-pinned)', () => {
  it.each([
    ['oh seven seven double 0 nine double oh one two three', '+447700900123'],
    ['nought seven seven treble oh nine oh one two three', '+447700090123'],
    ['o seven seven double oh nine oh oh one two three', '+447700900123'],
    ['zero seven seven double oh, nine oh oh, one two three', '+447700900123'],
    ['0 7 7 0 0, 9 0 0 1 2 3', '+447700900123'],
    ['44 7700 900123', '+447700900123'],
  ])('%s -> %s', (input, e164) => {
    expect(normalisePhone(input)?.e164).toBe(e164);
  });

  it('"double" at the end, or before a non-digit word, is not a repeat', () => {
    expect(normalisePhone('07700 90012 double')).toBeNull();
    expect(normalisePhone('double five')).toBeNull();
  });

  it('length limits: 64 characters max; 11-digit 44 prefix minimum; whitespace only', () => {
    expect(normalisePhone(`07700900123${' '.repeat(53)}`)?.e164).toBe('+447700900123');
    expect(normalisePhone(`07700900123${' '.repeat(54)}`)).toBeNull();
    expect(normalisePhone('4477009001')).toBeNull();
    expect(normalisePhone('   ')).toBeNull();
    expect(normalisePhone('+44 07700 900123')?.e164).toBe('+447700900123');
  });

  it('formats national groups: London 020, 011x/01x1 cities, others 5+6', () => {
    expect(normalisePhone('02079460018')?.national).toBe('020 7946 0018');
    expect(normalisePhone('01214960000')?.national).toBe('0121 496 0000');
    expect(normalisePhone('01134960000')?.national).toBe('0113 496 0000');
    expect(normalisePhone('01632960000')?.national).toBe('01632 960000');
    expect(normalisePhone('03001234567')?.national).toBe('03001 234567');
  });

  it('spoken read-back of 4-digit and 7-digit groups', () => {
    expect(spokenPhone('020 7946 0018')).toBe(
      'oh two oh, seven nine four six, oh oh one eight'.replace('oh oh', 'double oh'),
    );
    expect(spokenPhone('01632 9605588')).toBe(
      'oh one six three two, nine six oh, double five double eight',
    );
    expect(spokenPhone('5 8')).toBe('five, eight');
  });

  it('rejects letters mixed into digits and plus signs in the middle', () => {
    expect(normalisePhone('07700 9001x3')).toBeNull();
    expect(normalisePhone('0770+0900123')).toBeNull();
  });
});
