/**
 * Fault codes as callers say them: "F 28", "f.28", "eff twenty eight" -> "F28"; "EA 227" -> "EA227";
 * "F01", "eff oh one" -> "F1"; "F.022" -> "F22".
 */
const WORDS: Readonly<Record<string, string>> = {
  zero: '0',
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
  eff: 'F',
  ee: 'E',
  el: 'L',
  ay: 'A',
  see: 'C',
  dee: 'D',
  aitch: 'H',
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

export function normaliseCode(input: string): string {
  // Leading/trailing separators give empty tokens, which add nothing below.
  const tokens = input.toLowerCase().split(/[^a-z0-9]+/);
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    const tens = TENS[t];
    if (tens !== undefined) {
      // Stryker disable next-line StringLiteral: any fallback key misses WORDS, so it is equivalent.
      const unit = WORDS[tokens[i + 1] ?? ''];
      if (unit && /^[1-9]$/.test(unit)) {
        out += String(tens + Number(unit));
        i++;
      } else out += String(tens);
      continue;
    }
    out += WORDS[t] ?? t;
  }
  // Padding zeros after the letters are the same code: Ideal shows "F01"/"L0C" and the newest
  // Vaillant "F.022", where callers (and older ranges) say "F1"/"LC"/"F22". Only codes with one or
  // two characters after the zeros, so Baxi's "E.04.10" (E0410) is untouched.
  return out.toUpperCase().replace(/^([A-Z]{1,2})0+([0-9A-Z]{1,2})$/, '$1$2');
}
