import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { faultCodeSchema } from '../../knowledge/schema.js';
import { lookupFaultCodeAction } from '../../src/actions/knowledge.js';
import { validateClientConfig } from '../../src/clients/config-store.js';
import {
  buildLibrary,
  lookupFaultCode,
  resolveManufacturer,
  KnowledgeValidationError,
} from '../../src/knowledge/library.js';
import { normaliseCode } from '../../src/knowledge/normalise.js';
import { createLogger } from '../../src/observability/logger.js';

const fixture = parse(readFileSync('tests/fixtures/knowledge/vaillant.yaml', 'utf8')) as {
  entries: Record<string, unknown>[];
};
// Built inside tests, not at import: a broken build must fail tests, not the whole file.
let built: ReturnType<typeof buildLibrary> | undefined;
const vaillantLib = () => (built ??= buildLibrary([{ name: 'vaillant.yaml', content: fixture }]));
const demoRaw = parse(readFileSync('config/clients/demo.yaml', 'utf8')) as Record<string, unknown>;
const demo = validateClientConfig(demoRaw, 'demo'); // not Gas Safe
const gasSafe = validateClientConfig(
  {
    ...demoRaw,
    gas_safe_registered: true,
    services_offered: [...(demoRaw.services_offered as string[]), 'gas_boiler'],
    services_not_offered: ['drain_cctv'],
  },
  'gas',
);
const silent = createLogger({ level: 'silent', appEnv: 'test', version: 't' });

describe('knowledge schema rules', () => {
  const base = fixture.entries[0]!;
  const issues = (over: Record<string, unknown>) => {
    const r = faultCodeSchema.safeParse({ ...base, ...over });
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };
  it('accepts the fixture entry', () => expect(issues({})).toEqual([]));
  it('source_verified needs an official manufacturer domain', () => {
    expect(
      issues({
        source: { ...(base.source as object), url: 'https://www.boilerforum.example.com/x' },
      }).join(),
    ).toContain('official vaillant domain');
  });
  it('reviewed entries must name the reviewer', () => {
    expect(issues({ status: 'reviewed', reviewed_by: null }).join()).toContain('reviewer');
    expect(issues({ status: 'reviewed', reviewed_by: 'Plumber' })).toEqual([]);
  });
  it.each([
    'Remove the cover and check the fuse.',
    'Turn the gas valve off and on.',
    'Unscrew the panel to look.',
  ])('rejects unsafe homeowner guidance: %s', (g) =>
    expect(issues({ homeowner_guidance: g }).join()).toContain('must not involve'),
  );
  it('rejects long quotes, http sources and template characters', () => {
    expect(
      issues({ source: { ...(base.source as object), quote: 'word '.repeat(41) } }).join(),
    ).toContain('40 words');
    expect(
      issues({ source: { ...(base.source as object), url: 'http://www.vaillant.co.uk/x' } }).join(),
    ).toContain('https');
    expect(issues({ meaning: 'Means {{x}}' }).join()).toContain('template');
  });
  it('rejects a file whose entry uses an unknown range', () => {
    const bad = { ...fixture, entries: [{ ...base, ranges: ['ecoTEC imaginary'] }] };
    expect(() => buildLibrary([{ name: 'bad.yaml', content: bad }])).toThrow(
      KnowledgeValidationError,
    );
  });
});

describe('normaliseCode', () => {
  it.each([
    ['F.28', 'F28'],
    ['f 28', 'F28'],
    ['eff twenty eight', 'F28'],
    ['F twenty two', 'F22'],
    ['EA 227', 'EA227'],
    ['el two', 'L2'],
    ['E133', 'E133'],
    ['ee one three three', 'E133'],
    // Padding zero: Ideal Logic2 displays "F01"/"L0C"; callers say "F1"/"LC".
    ['F01', 'F1'],
    ['eff oh one', 'F1'],
    ['L 0 C', 'LC'],
    ['F0', 'F0'],
    ['F10', 'F10'],
    ['E.04.10', 'E0410'],
    ['F.022', 'F22'],
    ['F 0 2 8', 'F28'],
    ['F.281', 'F281'],
    ['F00', 'F0'],
  ])('%s -> %s', (input, out) => expect(normaliseCode(input)).toBe(out));

  it.each([
    // Every spoken number and letter word.
    ['zero oh one two three four five six seven eight nine', '00123456789'],
    [
      'ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen',
      '10111213141516171819',
    ],
    ['ay see dee aitch', 'ACDH'],
    // A tens word joins only a following single digit.
    ['eff twenty', 'F20'],
    ['twenty ten', '2010'],
    ['twenty nineteen', '2019'],
    ['twenty oh', '200'],
    ['thirty forty fifty sixty seventy eighty ninety', '30405060708090'],
    ['twenty - eight', '28'],
    // Case, and separators at the ends or repeated.
    ['EFF TWENTY EIGHT', 'F28'],
    [' -f..28- ', 'F28'],
    ['', ''],
    // Padding zeros only straight after one or two letters, with one or two characters left.
    ['EA01', 'EA1'],
    ['F001', 'F1'],
    ['F012', 'F12'],
    ['F0123', 'F0123'],
    ['ABC01', 'ABC01'],
    ['01', '01'],
  ])('spoken and padded forms: %s -> %s', (input, out) => expect(normaliseCode(input)).toBe(out));
});

describe('resolveManufacturer', () => {
  it.each([
    ['Worcester Bosch Greenstar 30i', 'worcester_bosch'],
    ['it is a bosch', 'worcester_bosch'],
    ['Vaillant ecoTEC plus', 'vaillant'],
    ['glow worm', 'glow_worm'],
    ['Ideal Logic Max', 'ideal'],
    ['Potterton', null],
    ['', null],
  ])('%s -> %s', (text, id) => expect(resolveManufacturer(text)).toBe(id));
});

describe('lookupFaultCode', () => {
  it('only servable entries are indexed', () => {
    expect(vaillantLib().servedEntries).toBe(3);
    expect(
      lookupFaultCode(vaillantLib(), { make: 'Vaillant', model: 'ecoTEC plus', code: 'F.75' }),
    ).toMatchObject({ status: 'not_covered', reason: 'unknown_code' });
    expect(
      lookupFaultCode(vaillantLib(), { make: 'Vaillant', model: 'ecoTEC plus', code: 'F.61' }),
    ).toMatchObject({ status: 'not_covered' });
  });
  it('asks for make, then code', () => {
    expect(lookupFaultCode(vaillantLib(), { code: 'F28' }).status).toBe('needs_make');
    expect(lookupFaultCode(vaillantLib(), { make: 'Vaillant' }).status).toBe('needs_code');
  });
  it('answers without a model when every documented range agrees', () => {
    expect(
      lookupFaultCode(vaillantLib(), { make: 'vaillant', code: 'eff twenty eight' }),
    ).toMatchObject({
      status: 'found',
      ranges: ['ecoTEC plus', 'ecoTEC pro'],
      entry: { id: 'vaillant-ecotec-f28' },
    });
  });
  it('asks which model when meanings differ, then answers for that model', () => {
    expect(lookupFaultCode(vaillantLib(), { make: 'Vaillant', code: 'F.22' })).toMatchObject({
      status: 'needs_model',
      candidates: ['ecoTEC plus', 'ecoTEC pro'],
    });
    expect(
      lookupFaultCode(vaillantLib(), { make: 'Vaillant', model: 'eco tec plus 832', code: 'F22' }),
    ).toMatchObject({ status: 'found', entry: { id: 'vaillant-plus-f22' } });
    expect(
      lookupFaultCode(vaillantLib(), { make: 'Vaillant', model: 'ecotec pro 28', code: 'F22' }),
    ).toMatchObject({ status: 'found', entry: { id: 'vaillant-pro-f22' } });
  });
  it('does not guess for a known model without that code', () => {
    expect(
      lookupFaultCode(vaillantLib(), { make: 'Vaillant', model: 'turboMAX', code: 'F28' }),
    ).toMatchObject({ status: 'not_covered', reason: 'not_for_model' });
  });
  it('matches a model said without the maker name in front', () => {
    // Real files name ranges with the maker ("Baxi 600 Combi 2"); callers usually don't.
    const prefixed = JSON.parse(
      JSON.stringify(fixture).replace(/"(ecoTEC plus|ecoTEC pro|turboMAX)"/g, '"Vaillant $1"'),
    ) as typeof fixture;
    const lib = buildLibrary([{ name: 'vaillant.yaml', content: prefixed }]);
    expect(
      lookupFaultCode(lib, { make: 'Vaillant', model: 'my ecotec pro 28', code: 'F22' }),
    ).toMatchObject({ status: 'found', entry: { id: 'vaillant-pro-f22' } });
    expect(
      lookupFaultCode(lib, { make: 'Vaillant', model: 'Vaillant ecoTEC plus', code: 'F22' }),
    ).toMatchObject({ status: 'found', entry: { id: 'vaillant-plus-f22' } });
    expect(
      lookupFaultCode(lib, { make: 'Vaillant', model: 'turbomax', code: 'F28' }),
    ).toMatchObject({ status: 'not_covered', reason: 'not_for_model' });
  });
  it('a partial model narrows to its family, and answers when the family agrees', () => {
    // Fixture: F.22 differs between ecoTEC plus and ecoTEC pro; F.28 agrees.
    expect(
      lookupFaultCode(vaillantLib(), { make: 'Vaillant', model: 'ecotec', code: 'F22' }),
    ).toMatchObject({ status: 'needs_model', candidates: ['ecoTEC plus', 'ecoTEC pro'] });
    expect(
      lookupFaultCode(vaillantLib(), { make: 'Vaillant', model: 'ecotec', code: 'F28' }),
    ).toMatchObject({ status: 'found', entry: { id: 'vaillant-ecotec-f28' } });
    // A family with no entry for the code is not answered from other ranges.
    expect(
      lookupFaultCode(vaillantLib(), { make: 'Vaillant', model: 'turbo', code: 'F28' }),
    ).toMatchObject({ status: 'not_covered', reason: 'not_for_model' });
  });
  it('unknown makes and makes without a library are not covered', () => {
    expect(lookupFaultCode(vaillantLib(), { make: 'Potterton', code: 'F28' })).toMatchObject({
      status: 'not_covered',
      reason: 'unknown_make',
    });
    expect(lookupFaultCode(vaillantLib(), { make: 'Baxi', code: 'E133' })).toMatchObject({
      status: 'not_covered',
      reason: 'unknown_make',
    });
  });
});

describe('lookup_fault_code action', () => {
  it('found: manufacturer meaning, engineer confirms, guidance only on request when an engineer is needed, signpost when not Gas Safe', () => {
    expect(
      lookupFaultCodeAction(demo, { make: 'Vaillant', code: 'F.28' }, vaillantLib(), silent),
    ).toEqual({
      status: 'found',
      meaning: 'The boiler failed to light when it tried to start.',
      homeowner_guidance: 'Check other gas appliances are working, then press reset once.',
      source_ref: 'vaillant-ecotec-f28',
      instruction:
        "Say Vaillant lists this code as: The boiler failed to light when it tried to start. Make clear the engineer will confirm the actual cause. If they ask, Vaillant's guidance is: Check other gas appliances are working, then press reset once. Then explain we don't work on gas boilers, so they'd need a Gas Safe registered engineer.",
    });
  });

  it('Gas Safe business: offers the booking; guidance offered proactively when no engineer is needed', () => {
    const r = lookupFaultCodeAction(
      gasSafe,
      { make: 'Vaillant', model: 'ecoTEC plus', code: 'F22' },
      vaillantLib(),
      silent,
    );
    expect(r.instruction).toBe(
      "Say Vaillant lists this code as: The water pressure in the system is too low. Make clear the engineer will confirm the actual cause. Vaillant's own guidance is: Top the pressure up to between 1 and 2 bar as shown in the user guide. Then offer to book an engineer to take a look.",
    );
  });

  it('needs / not covered instructions, and gaps are logged without caller data', () => {
    const lines: Record<string, unknown>[] = [];
    const log = createLogger(
      { level: 'info', appEnv: 'test', version: 't' },
      { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) },
    );
    expect(lookupFaultCodeAction(demo, {}, vaillantLib(), log).instruction).toBe(
      'Ask what make the boiler is; it is usually written on the front.',
    );
    expect(lookupFaultCodeAction(demo, { make: 'Vaillant' }, vaillantLib(), log).instruction).toBe(
      'Ask them to read out the code or letters showing on the boiler display.',
    );
    expect(
      lookupFaultCodeAction(demo, { make: 'Vaillant', code: 'F22' }, vaillantLib(), log)
        .instruction,
    ).toBe(
      "That code means different things on different models. If you have not asked yet, ask once which model it is (it is usually on the front or underneath), for example ecoTEC plus or ecoTEC pro, and look it up again. If they don't know or you already asked, don't guess what it means: say the engineer will check the code on the visit, and carry on towards booking.",
    );
    const gap = lookupFaultCodeAction(
      gasSafe,
      { make: 'Vaillant', model: 'turboMAX', code: 'F99' },
      vaillantLib(),
      log,
    );
    expect(gap).toEqual({
      status: 'not_covered',
      instruction:
        "Don't guess what it means. Note the make, model and code for the engineer. Then offer to book an engineer to take a look.",
    });
    expect(lines.find((l) => l.msg === 'knowledge_gap')).toMatchObject({
      reason: 'unknown_code',
      manufacturer: 'vaillant',
      range: 'turboMAX',
      code: 'F99',
    });
  });

  it('ignores non-string and oversized parameters', () => {
    expect(
      lookupFaultCodeAction(demo, { make: 42, code: ['F28'] }, vaillantLib(), silent).status,
    ).toBe('needs_make');
    expect(
      lookupFaultCodeAction(
        demo,
        { make: 'Vaillant', code: 'F28'.padEnd(200, ' x') },
        vaillantLib(),
        silent,
      ).status,
    ).toBe('not_covered');
  });
});
