/** Seeded PRNG (mulberry32) so every fuzz failure is reproducible from its seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)] as T;
  const ALPHABETS = [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
    'abcdefghijklmnopqrstuvwxyz ',
    '0123456789',
    ' \t\n.,-_/\\\'"!?@#£$%^&*()[]{}<>|`~=+;:',
    'éüñ中文🙂\u0000‮﻿',
  ];
  const string = (maxLen = 40) => {
    const alphabet = [...pick(ALPHABETS)]; // whole code points, never half an emoji
    return Array.from({ length: int(maxLen + 1) }, () => alphabet[int(alphabet.length)]).join('');
  };
  const value = (depth = 0): unknown => {
    switch (int(depth > 2 ? 5 : 8)) {
      case 0:
        return string();
      case 1:
        return int(1e6) - 5e5;
      case 2:
        return next() > 0.5;
      case 3:
        return null;
      case 4:
        return undefined;
      case 5:
        return Array.from({ length: int(4) }, () => value(depth + 1));
      default:
        return Object.fromEntries(
          Array.from({ length: int(5) }, () => [
            pick([
              'postcode',
              'trigger',
              'location_id',
              'call_id',
              'customData',
              'location',
              '__proto__',
              'constructor',
              string(8),
            ]),
            value(depth + 1),
          ]),
        );
    }
  };
  return { next, int, pick, string, value };
}
