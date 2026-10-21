import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { presentationSchema, symptomFileSchema } from '../../knowledge/symptom-schema.js';
import { symptomGuidanceAction } from '../../src/actions/symptoms.js';
import { validateClientConfig } from '../../src/clients/config-store.js';
import { KnowledgeValidationError } from '../../src/knowledge/library.js';
import {
  stem,
  terms,
  buildSymptomLibrary,
  loadSymptomLibrary,
  matchSymptom,
  resolveFamily,
} from '../../src/knowledge/symptoms.js';
import { createLogger } from '../../src/observability/logger.js';

const fixture = () =>
  parse(readFileSync('tests/fixtures/knowledge/symptoms/toilets.yaml', 'utf8')) as {
    presentations: Record<string, unknown>[];
  };
const lib = () => buildSymptomLibrary([{ name: 'toilets.yaml', content: fixture() }]);
const demo = validateClientConfig(
  parse(readFileSync('config/clients/demo.yaml', 'utf8')) as Record<string, unknown>,
  'demo',
);
const silent = createLogger({ level: 'silent', appEnv: 'test', version: 't' });

describe('symptom schema safety rules', () => {
  const base = () => structuredClone(fixture().presentations[0]!) as Record<string, unknown>;
  it('accepts the fixture', () => {
    expect(presentationSchema.safeParse(base()).success).toBe(true);
  });
  it.each([
    'It is definitely the flush valve.',
    'Try a plunger, that can often clear it.',
    'You can bleed the radiator, that may help.',
    'Pour boiling water in, it can sometimes clear it.',
    "It's just a washer, it can be quick.",
    'It is safe to use until then, it may be the valve.',
  ])('rejects unsafe or certain explanation: %s', (say) => {
    const p = base();
    p.may_explain = [{ when: 'x happens', say }];
    expect(presentationSchema.safeParse(p).success).toBe(false);
  });
  it('rejects explanations that are not tentative', () => {
    const p = base();
    p.may_explain = [{ when: 'x happens', say: 'The flush valve has failed.' }];
    expect(presentationSchema.safeParse(p).success).toBe(false);
  });
  it.each([
    'Can you turn off the stopcock?',
    'Could you check the fuse?',
    'Is it running',
    'Could you do a soap test?',
  ])('rejects questions that instruct or are not questions: %s', (q) => {
    const p = base();
    p.ask_first = [q];
    expect(presentationSchema.safeParse(p).success).toBe(false);
  });
  it('allows questions about what the caller already did', () => {
    const p = base();
    p.ask_first = ['Have you had to top up the pressure?'];
    expect(presentationSchema.safeParse(p).success).toBe(true);
  });
  it('reviewed entries name the reviewer; ids are unique', () => {
    const p = base();
    p.status = 'reviewed';
    expect(presentationSchema.safeParse(p).success).toBe(false);
    const f = fixture();
    f.presentations.push(f.presentations[0]!);
    expect(symptomFileSchema.safeParse(f).success).toBe(false);
  });
});

describe('symptom library', () => {
  it('serves only servable presentations', () => {
    expect(lib().servedPresentations).toBe(2);
    expect(matchSymptom(lib(), { problem: 'the toilet is wobbly' })).toMatchObject({
      status: 'not_found',
    });
  });
  it('matches on the caller words, longer phrases winning', () => {
    expect(
      matchSymptom(lib(), { problem: "My loo keeps running, the cistern won't stop" }),
    ).toMatchObject({ status: 'found', presentation: { id: 'toilet-running' }, score: 5 }); // 2² + 1
    expect(matchSymptom(lib(), { problem: 'toilet blocked again' })).toMatchObject({
      presentation: { id: 'toilet-blocked' },
    });
  });
  it('matches keyword words in any order and form', () => {
    expect(
      matchSymptom(lib(), { problem: 'it is constantly refilling and running' }),
    ).toMatchObject({
      presentation: { id: 'toilet-running' },
      score: 5, // "constantly running" 2² + "refilling" 1
    });
    expect(matchSymptom(lib(), { problem: 'the toilets are blocking' })).toMatchObject({
      presentation: { id: 'toilet-blocked' },
      score: 9, // "blocked toilet" 2² + "toilet blocked" 2² + "blocked" 1
    });
  });
  it('falls back to family questions, else not found', () => {
    expect(matchSymptom(lib(), { problem: 'strange smell', family: 'loo' })).toEqual({
      status: 'general',
      family: 'toilets',
      questions: ['What happens when you flush it?'],
    });
    expect(matchSymptom(lib(), { problem: 'strange smell', family: 'drains' })).toEqual({
      status: 'not_found',
    });
    expect(matchSymptom(lib(), { problem: 'blocked', family: 'drains' }).status).toBe('not_found');
  });
  it('resolves family names and aliases', () => {
    expect(resolveFamily('Toilets')).toBe('toilets');
    expect(resolveFamily('drain')).toBe('drains');
    expect(resolveFamily('leaks')).toBe('leaks');
    expect(resolveFamily('taps')).toBe('taps');
    expect(resolveFamily('nonsense')).toBeNull();
    expect(resolveFamily(null)).toBeNull();
  });
  it('rejects invalid files; a missing directory is an empty library', async () => {
    const bad = fixture();
    (bad.presentations[0] as Record<string, unknown>).keywords = ['x'];
    expect(() => buildSymptomLibrary([{ name: 'bad.yaml', content: bad }])).toThrow(
      KnowledgeValidationError,
    );
    expect((await loadSymptomLibrary('does/not/exist')).servedPresentations).toBe(0);
    expect(
      (await loadSymptomLibrary('tests/fixtures/knowledge/symptoms')).servedPresentations,
    ).toBe(2);
  });
});

describe('terms and stem', () => {
  it.each([
    ['dripping', 'drip'],
    ['drips', 'drip'],
    ['blocked', 'block'],
    ['blocking', 'block'],
    ['leaks', 'leak'],
    ['running', 'run'],
    ['flushes', 'flush'],
    ['pour', 'pour'],
    ['gas', 'gas'],
    ['toilet', 'toilet'],
  ])('%s -> %s', (w, out) => expect(stem(w)).toBe(out));
  it('drops stop words and punctuation', () => {
    expect(terms("My loo's blocked, and the water's rising!")).toEqual([
      'loo',
      'block',
      'water',
      'ris',
    ]);
  });
});

describe('symptom_guidance action', () => {
  it('found: questions, tentative explanation, urgency, notes and booking', () => {
    const r = symptomGuidanceAction(demo, { problem: 'toilet keeps running' }, lib(), silent);
    expect(r).toMatchObject({
      status: 'found',
      presentation: 'Toilet keeps running',
      job_type: 'tap_toilet',
    });
    expect(r.instruction).toBe(
      'Ask, one at a time, only what you don\'t know yet: "Is water running into the pan all the time, or only refilling now and then?" / "Is any water coming out of the overflow pipe outside?". ' +
        'After the answers, if it fits, you may say one of these, as a possibility only: if water trickles into the pan: "That can often be the flush valve not sealing properly, which is a common repair. The engineer will confirm when they see it.". Never present it as the confirmed cause; the engineer confirms on the visit. ' +
        "Urgency: water escaping onto the floor and can't be stopped = P2; otherwise P4. Call escalation for P1–P3. " +
        'Note for the engineer: constant or intermittent, overflow outside, cistern type if known. Then offer to book the repair (job type tap_toilet).',
    );
  });
  it('assessment visit, no explanation, booking note', () => {
    const r = symptomGuidanceAction(
      demo,
      { problem: 'blocked toilet', family: 'toilets' },
      lib(),
      silent,
    );
    expect(r.instruction).toContain(
      "Don't suggest a cause; the engineer will check it on the visit.",
    );
    expect(r.instruction).toContain(
      'Then offer a visit to take a look at it (job type blocked_toilet). Ask whether anything else drains slowly.',
    );
  });
  it('general and not found never guess and keep to booking', () => {
    expect(
      symptomGuidanceAction(demo, { problem: 'odd smell', family: 'toilets' }, lib(), silent),
    ).toEqual({
      status: 'general',
      instruction:
        'Ask, one at a time, only what you don\'t know yet: "What happens when you flush it?". Don\'t guess the cause; carry on towards booking.',
    });
    expect(symptomGuidanceAction(demo, { problem: 42 }, lib(), silent)).toEqual({
      status: 'not_found',
      instruction:
        'No specific guidance. Use the problem-family questions you already have, never guess the cause, and carry on towards booking.',
    });
  });
});
