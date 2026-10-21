import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  buildLibrary,
  loadLibrary,
  lookupFaultCode,
  resolveManufacturer,
  resolveRange,
  KnowledgeValidationError,
} from '../../src/knowledge/library.js';

/** Library building blocks, built inside each test so a broken build fails that test. */
const SOURCES = {
  vaillant: 'https://www.vaillant.co.uk/manual',
  ideal: 'https://www.idealheating.com/manual',
} as const;
type Maker = keyof typeof SOURCES;

const entry = (
  manufacturer: Maker,
  id: string,
  ranges: string[],
  code: string,
  meaning: string,
) => ({
  id,
  kind: 'fault_code',
  manufacturer,
  ranges,
  code,
  meaning,
  homeowner_guidance: null,
  engineer_needed: true,
  source: {
    url: SOURCES[manufacturer],
    title: 'Fixture manual',
    publisher: 'Maker',
    checked: '2026-10-19',
    quote: 'fixture quote',
  },
  status: 'source_verified',
});
const file = (manufacturer: Maker, ranges: string[], entries: unknown[] = []) => ({
  manufacturer,
  known_ranges: ranges.map((name) => ({ name, coverage: 'covered' })),
  entries,
});
const indexOf = (manufacturer: Maker, ranges: string[]) => {
  const lib = buildLibrary([{ name: `${manufacturer}.yaml`, content: file(manufacturer, ranges) }]);
  return lib.manufacturers.get(manufacturer)!;
};

describe('resolveRange', () => {
  it('prefers the longest range named in what was said', () => {
    const idx = indexOf('vaillant', ['ecoTEC', 'ecoTEC plus']);
    expect(resolveRange(idx, 'my ecotec plus 28')).toBe('ecoTEC plus');
    expect(resolveRange(idx, 'an old ecotec')).toBe('ecoTEC');
    expect(resolveRange(idx, 'combi boiler')).toBeNull();
    expect(resolveRange(idx, 'us')).toBeNull();
    expect(resolveRange(idx, '')).toBeNull();
    expect(resolveRange(idx, null)).toBeNull();
    expect(resolveRange(idx, '...')).toBeNull();
  });

  it('drops the maker from a range name only when at least 3 characters are left', () => {
    const idx = indexOf('vaillant', ['ecoTEC 2', 'turboTEC classic', 'Vaillant ecoTEC exclusive']);
    expect(resolveRange(idx, '2')).toBeNull(); // "ecoTEC 2" keeps its maker word
    expect(resolveRange(idx, 'classic')).toBeNull(); // "turboTEC" is not a maker name
    expect(resolveRange(idx, 'ecotec exclusive')).toBe('Vaillant ecoTEC exclusive');
    expect(resolveRange(idx, 'ecotec 2')).toBe('ecoTEC 2');
  });

  it('strips the longest maker alias first ("Ideal Logic" before "Ideal")', () => {
    const idx = indexOf('ideal', ['Ideal Logic Max']);
    expect(resolveRange(idx, 'max 30')).toBe('Ideal Logic Max');
    expect(resolveRange(idx, 'logic max')).toBe('Ideal Logic Max');
  });

  it('short names match only exactly', () => {
    const idx = indexOf('vaillant', ['GB']);
    expect(resolveRange(idx, 'gb')).toBe('GB');
    expect(resolveRange(idx, 'gb 24')).toBeNull();
  });
});

describe('resolveManufacturer', () => {
  it.each([
    ['Glow--Worm', 'glow_worm'],
    ['  VAILLANT!  ', 'vaillant'],
    // Longest alias wins across makers too: "viessmann" (9) beats "bosch" (5).
    ['bosch viessmann', 'viessmann'],
    ['the Worcester Bosch one', 'worcester_bosch'],
    ['an ideal logic', 'ideal'],
    ['viessmannish', null],
    [null, null],
    [undefined, null],
  ])('%s -> %s', (text, id) => expect(resolveManufacturer(text)).toBe(id));
});

describe('buildLibrary', () => {
  it('merges files for the same maker and keeps every entry for a shared code', () => {
    const lib = buildLibrary([
      {
        name: 'a.yaml',
        content: file(
          'vaillant',
          ['ecoTEC plus'],
          [entry('vaillant', 'v-a', ['ecoTEC plus'], 'F.22', 'Meaning plus.')],
        ),
      },
      {
        name: 'b.yaml',
        content: file(
          'vaillant',
          ['ecoTEC pro'],
          [
            entry('vaillant', 'v-b', ['ecoTEC pro'], 'F22', 'Meaning pro.'),
            entry('vaillant', 'v-c', ['ecoTEC pro'], 'F.28', 'Meaning ignition.'),
          ],
        ),
      },
    ]);
    expect(lib.servedEntries).toBe(3);
    expect([...lib.manufacturers.keys()]).toEqual(['vaillant']);
    expect(lookupFaultCode(lib, { make: 'Vaillant', code: 'F22' })).toEqual({
      status: 'needs_model',
      candidates: ['ecoTEC plus', 'ecoTEC pro'],
      manufacturer: 'vaillant',
      code: 'F22',
    });
    expect(
      lookupFaultCode(lib, { make: 'Vaillant', model: 'ecoTEC plus', code: 'F22' }),
    ).toMatchObject({
      status: 'found',
      entry: { id: 'v-a' },
      range: 'ecoTEC plus',
    });
    expect(lookupFaultCode(lib, { make: 'Vaillant', code: 'F28' })).toMatchObject({
      status: 'found',
      entry: { id: 'v-c' },
      ranges: ['ecoTEC pro'],
    });
  });

  it('asks about at most three models', () => {
    const ranges = ['Alpha one', 'Bravo two', 'Charlie three', 'Delta four'];
    const lib = buildLibrary([
      {
        name: 'v.yaml',
        content: file(
          'vaillant',
          ranges,
          ranges.map((r, i) => entry('vaillant', `v-${i}-x`, [r], 'F1', `Meaning ${i}.`)),
        ),
      },
    ]);
    expect(lookupFaultCode(lib, { make: 'Vaillant', code: 'F1' })).toMatchObject({
      status: 'needs_model',
      candidates: ['Alpha one', 'Bravo two', 'Charlie three'],
    });
  });

  it('reports the file and the first five issues', () => {
    const bad = file(
      'vaillant',
      ['ecoTEC plus'],
      [0, 1, 2, 3, 4, 5].map((i) => entry('vaillant', `v-bad-${i}`, ['Nope'], 'F1', 'Meaning.')),
    );
    let err: unknown;
    try {
      buildLibrary([{ name: 'bad.yaml', content: bad }]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KnowledgeValidationError);
    const e = err as KnowledgeValidationError;
    const issue = (i: number) => `entries.${i}.ranges: range "Nope" not in known_ranges`;
    expect(e.name).toBe('KnowledgeValidationError');
    expect(e.file).toBe('bad.yaml');
    expect(e.issues).toEqual([0, 1, 2, 3, 4, 5].map(issue));
    expect(e.message).toBe(
      `Invalid knowledge file bad.yaml: ${[0, 1, 2, 3, 4].map(issue).join('; ')}`,
    );
  });
});

describe('loadLibrary', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('loads every .yaml file in name order and ignores other files', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'knowledge-'));
    // Written out of name order; candidates follow the sorted file order.
    writeFileSync(
      path.join(dir, 'b-pro.yaml'),
      stringify(
        file(
          'vaillant',
          ['ecoTEC pro'],
          [entry('vaillant', 'v-pro', ['ecoTEC pro'], 'F.22', 'Pro meaning.')],
        ),
      ),
    );
    writeFileSync(
      path.join(dir, 'a-plus.yaml'),
      stringify(
        file(
          'vaillant',
          ['ecoTEC plus'],
          [entry('vaillant', 'v-plus', ['ecoTEC plus'], 'F.22', 'Plus meaning.')],
        ),
      ),
    );
    writeFileSync(path.join(dir, 'notes.txt'), 'not: [valid knowledge');
    writeFileSync(path.join(dir, '.yaml.bak'), 'not: [valid knowledge');
    const lib = await loadLibrary(dir);
    expect(lib.servedEntries).toBe(2);
    expect(lookupFaultCode(lib, { make: 'Vaillant', code: 'F22' })).toMatchObject({
      status: 'needs_model',
      candidates: ['ecoTEC plus', 'ecoTEC pro'],
    });
  });

  it('a missing directory is an empty library', async () => {
    expect(await loadLibrary(path.join(tmpdir(), 'no-such-knowledge-dir-xyz'))).toEqual({
      manufacturers: new Map(),
      servedEntries: 0,
    });
  });
});
