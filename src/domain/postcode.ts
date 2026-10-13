/**
 * UK postcode normalisation for speech-to-text output, e.g. "l s six 2 a b" -> "LS6 2AB".
 * Only deterministic, well-defined repairs are applied; anything else is rejected so the agent
 * asks again or reads back rather than guessing.
 */

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: '0',
  nought: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
};

const TENS_WORDS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const REPEAT_WORDS: Readonly<Record<string, number>> = { double: 2, treble: 3, triple: 3 };

const FULL_POSTCODE = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][ABD-HJLNP-UW-Z]{2})$/;
const OUTCODE_ONLY = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;
const OUTCODE_PARTS = /^([A-Z]{1,2})([0-9]{1,2})([A-Z]?)$/;
const MAX_INPUT_LENGTH = 64;

export interface Outcode {
  /** e.g. "LS6" */
  outcode: string;
  /** Postcode area letters, e.g. "LS" */
  area: string;
  /** Numeric district, e.g. 6 for LS6 or 1 for EC1A */
  districtNumber: number;
  /** Sub-district letter, e.g. "A" for EC1A; "" when none */
  subDistrict: string;
}

export interface NormalisedPostcode extends Outcode {
  /** Full formatted postcode "LS6 2AB", or null when only an outcode was given */
  postcode: string | null;
  inward: string | null;
}

const GIR: NormalisedPostcode = {
  postcode: 'GIR 0AA',
  inward: '0AA',
  outcode: 'GIR',
  area: 'GIR',
  districtNumber: 0,
  subDistrict: '',
};

function expandSpokenTokens(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const next = tokens[i + 1];

    const repeat = REPEAT_WORDS[token];
    if (repeat !== undefined && next !== undefined) {
      const value = NUMBER_WORDS[next] ?? next;
      // "double a" -> "aa"; "double 2" -> "22". Only single characters can be repeated.
      if (value.length === 1) {
        out.push(value.repeat(repeat));
        i++;
        continue;
      }
    }

    const tens = TENS_WORDS[token];
    if (tens !== undefined) {
      // "thirty three" -> "33"; "twenty" alone -> "20"
      const unit = next !== undefined ? NUMBER_WORDS[next] : undefined;
      if (unit !== undefined && unit.length === 1 && unit !== '0') {
        out.push(String(tens + Number(unit)));
        i++;
      } else {
        out.push(String(tens));
      }
      continue;
    }

    // "oh" as the first token is the letter O (e.g. OL, OX areas), otherwise zero.
    if (token === 'oh' && out.length === 0) {
      out.push('o');
      continue;
    }
    out.push(NUMBER_WORDS[token] ?? token);
  }
  return out.join('').toUpperCase();
}

export function parseOutcode(outcode: string): Outcode | null {
  const match = OUTCODE_PARTS.exec(outcode);
  if (!match) return null;
  const [, area, district, sub] = match as unknown as [string, string, string, string];
  return { outcode, area, districtNumber: Number(district), subDistrict: sub };
}

/** The first inward character must be a digit, so a letter O there can only mean zero. */
function repairInward(inward: string): string {
  const upper = inward.toUpperCase();
  return upper.startsWith('O') ? `0${upper.slice(1)}` : upper;
}

function fromParts(outward: string, inward: string): NormalisedPostcode | null {
  if (outward === 'GIR' && inward === '0AA') return GIR;
  const full = FULL_POSTCODE.exec(outward + inward);
  if (!full || full[1] !== outward) return null;
  const outcode = parseOutcode(outward);
  return outcode ? { ...outcode, postcode: `${outward} ${inward}`, inward } : null;
}

/**
 * Returns the normalised postcode or outcode, or null if the input is not a valid UK postcode.
 * Repairs: spoken number words, "double"/"treble", spacing/punctuation, and a letter O in the first
 * inward position, which must be a digit. No other character substitutions are guessed.
 */
export function normalisePostcode(input: string): NormalisedPostcode | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_INPUT_LENGTH) {
    return null;
  }

  const written = input.trim().split(/\s+/);
  // Written "LS6 22AB": outward and inward codes are already split. Respect the split instead of
  // compacting to "LS62 2AB", which would silently change the district.
  if (
    written.length === 2 &&
    written.every((t) => /^[A-Za-z0-9]+$/.test(t)) &&
    OUTCODE_ONLY.test((written[0] as string).toUpperCase())
  ) {
    return fromParts((written[0] as string).toUpperCase(), repairInward(written[1] as string));
  }

  const compact = expandSpokenTokens(input);
  if (compact.length >= 5) {
    const result = fromParts(compact.slice(0, -3), repairInward(compact.slice(-3)));
    if (result) return result;
  }
  if (OUTCODE_ONLY.test(compact)) {
    const outcode = parseOutcode(compact);
    return outcode ? { ...outcode, postcode: null, inward: null } : null;
  }
  return null;
}

/** Read-back text in two parts, characters separated: "L S 6... 2 A B". */
export function spokenReadback(postcode: NormalisedPostcode): string {
  const spell = (s: string) => s.split('').join(' ');
  return postcode.inward
    ? `${spell(postcode.outcode)}... ${spell(postcode.inward)}`
    : spell(postcode.outcode);
}
