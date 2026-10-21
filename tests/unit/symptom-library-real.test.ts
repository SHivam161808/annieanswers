import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { symptomGuidanceAction } from '../../src/actions/symptoms.js';
import { validateClientConfig } from '../../src/clients/config-store.js';
import {
  loadSymptomLibrary,
  matchSymptom,
  type SymptomLibrary,
} from '../../src/knowledge/symptoms.js';
import { createLogger } from '../../src/observability/logger.js';

// The deployed library (knowledge/symptoms): realistic caller phrases must reach the right
// presentation, and every instruction must stay short enough for a voice agent to act on.
let lib: SymptomLibrary;
beforeAll(async () => {
  lib = await loadSymptomLibrary('knowledge/symptoms');
});
const demo = validateClientConfig(
  parse(readFileSync('config/clients/demo.yaml', 'utf8')) as Record<string, unknown>,
  'demo',
);
const silent = createLogger({ level: 'silent', appEnv: 'test', version: 't' });

describe('deployed symptom library', () => {
  it('covers all six families', () => {
    expect([...lib.families.keys()].sort()).toEqual([
      'boilers',
      'drains',
      'leaks',
      'supply',
      'taps',
      'toilets',
    ]);
    expect(lib.servedPresentations).toBeGreaterThanOrEqual(50);
  });

  it.each([
    ["my toilet keeps running and won't stop filling", 'toilets/toilet-keeps-running'],
    ["the loo is blocked and it's our only toilet", 'toilets/toilet-blocked'],
    [
      'kitchen sink is blocked and the washing machine water comes back up',
      'drains/washing-machine-backing-up',
    ],
    ["there's a damp patch on the ceiling under the bathroom", 'leaks/ceiling-wall-damp-patch'],
    ['water is pouring through the kitchen ceiling', 'leaks/water-through-ceiling'],
    ["we've got no water at all, nothing from any tap", 'supply/no-water-whole-house'],
    ['the water pressure is really low everywhere', 'supply/low-pressure-whole-house'],
    ['my kitchen tap keeps dripping', 'taps/tap-dripping-leaking'],
    ["I want a new mixer tap fitted, I've bought it already", 'taps/like-for-like-replacement'],
    ['the drain outside is overflowing and it smells', 'drains/outside-drain-overflowing'],
    ["water's brown coming out of the cold tap", 'supply/discoloured-or-cloudy-water'],
    ['a pipe has burst under the stairs', 'leaks/burst-pipe'],
    ['the outside drain is blocked', 'drains/outside-drain-overflowing'],
  ])('%s -> %s', (problem, expected) => {
    const m = matchSymptom(lib, { problem });
    expect(m.status).toBe('found');
    if (m.status === 'found') expect(`${m.family}/${m.presentation.id}`).toBe(expected);
  });

  it('every served instruction is a usable length and never empty', () => {
    for (const [family, entry] of lib.families) {
      for (const p of entry.presentations) {
        const r = symptomGuidanceAction(
          demo,
          { problem: p.keywords.join(' '), family },
          lib,
          silent,
        );
        expect(r.status, p.id).toBe('found');
        expect(r.instruction.split(/\s+/).length, p.id).toBeLessThan(400);
      }
    }
  });
});
