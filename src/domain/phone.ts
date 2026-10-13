/**
 * Phone number normalisation for contact matching (T-604). GHL stores numbers in E.164, so every
 * number a caller gives (or STT produces) is converted to E.164 before lookup. UK numbers are
 * validated by length; other countries are accepted as E.164 if plausible.
 */

const DIGIT_WORDS: Readonly<Record<string, string>> = {
  zero: '0',
  oh: '0',
  o: '0',
  nought: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};
const REPEAT: Readonly<Record<string, number>> = { double: 2, treble: 3, triple: 3 };
const MAX_INPUT = 64;

export interface NormalisedPhone {
  /** E.164, e.g. +447700900123 */
  e164: string;
  isUk: boolean;
  /** UK numbers grouped the way they are read back, e.g. "07700 900123" */
  national: string | null;
}

function spokenToDigits(input: string): string {
  const tokens = input
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()
    .split(/\s+/);
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    const repeat = REPEAT[t];
    const next = tokens[i + 1];
    if (repeat !== undefined && next !== undefined) {
      const d = DIGIT_WORDS[next] ?? (/^\d$/.test(next) ? next : undefined);
      if (d !== undefined) {
        out += d.repeat(repeat);
        i++;
        continue;
      }
    }
    out += DIGIT_WORDS[t] ?? t;
  }
  return out;
}

function ukNational(nsn: string): string {
  // Mobiles and non-geographic 07/08/03: 5+6. London 020 / 02x: 3+4+4. Others: 5+6.
  const n = `0${nsn}`;
  if (/^02/.test(n)) return `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}`;
  if (/^01[1-9]1/.test(n) || /^011/.test(n))
    return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  return `${n.slice(0, 5)} ${n.slice(5)}`;
}

export function normalisePhone(input: unknown): NormalisedPhone | null {
  if (typeof input !== 'string' || !input.trim() || input.length > MAX_INPUT) return null;
  let raw = spokenToDigits(input).replace(/\(0\)/g, '');
  if (!/^\+?\d+$/.test(raw)) return null;

  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`;
  if (raw.startsWith('+')) {
    const digits = raw.slice(1);
    if (digits.startsWith('44')) return uk(digits.slice(2).replace(/^0/, ''));
    return /^[1-9]\d{7,14}$/.test(digits)
      ? { e164: `+${digits}`, isUk: false, national: null }
      : null;
  }
  if (raw.startsWith('44') && raw.length >= 11) return uk(raw.slice(2).replace(/^0/, ''));
  if (raw.startsWith('0')) return uk(raw.slice(1));
  return null;
}

function uk(nsn: string): NormalisedPhone | null {
  // UK national significant numbers are 10 digits; only some legacy 01 geographic ranges have 9.
  if (!/^[1-9]\d{9}$/.test(nsn) && !/^1\d{8}$/.test(nsn)) return null;
  return { e164: `+44${nsn}`, isUk: true, national: ukNational(nsn) };
}

const SPOKEN_DIGIT: Readonly<Record<string, string>> = {
  '0': 'oh',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
};

/** "07700 900123" -> "oh double seven double oh, nine double oh, one two three" */
export function spokenPhone(national: string): string {
  return (
    national
      .split(' ')
      // Speak long groups in chunks the way people read them: 900123 -> 900, 123.
      .flatMap((g) =>
        g.length === 6
          ? [g.slice(0, 3), g.slice(3)]
          : g.length === 7
            ? [g.slice(0, 3), g.slice(3)]
            : [g],
      )
      .map((group) => {
        const words: string[] = [];
        for (let i = 0; i < group.length;) {
          const d = group[i] as string;
          let run = 1;
          while (group[i + run] === d && run < 3) run++;
          const word = SPOKEN_DIGIT[d] as string;
          words.push(run === 3 ? `treble ${word}` : run === 2 ? `double ${word}` : word);
          i += run;
        }
        return words.join(' ');
      })
      .join(', ')
  );
}
