import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { lookupFaultCodeAction } from '../../src/actions/knowledge.js';
import { validateClientConfig } from '../../src/clients/config-store.js';
import { buildLibrary } from '../../src/knowledge/library.js';
import { createLogger } from '../../src/observability/logger.js';

const fixture = parse(readFileSync('tests/fixtures/knowledge/vaillant.yaml', 'utf8')) as unknown;
const lib = () => buildLibrary([{ name: 'vaillant.yaml', content: fixture }]);
const demoRaw = parse(readFileSync('config/clients/demo.yaml', 'utf8')) as Record<string, unknown>;
const demo = validateClientConfig(demoRaw, 'demo'); // not Gas Safe, no gas work
const services = demoRaw.services_offered as string[];
const gasSafeNoGasWork = validateClientConfig(
  {
    ...demoRaw,
    gas_safe_registered: true,
    services_offered: services.filter((s) => s !== 'gas_boiler'),
  },
  'gs',
);

const SIGNPOST =
  "Then explain we don't work on gas boilers, so they'd need a Gas Safe registered engineer.";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger(
    { level: 'info', appEnv: 'test', version: 't' },
    { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) },
  );
  return { lines, log };
}

describe('lookup_fault_code action details', () => {
  it('Gas Safe registration alone does not offer gas work', () => {
    const { log } = capture();
    const r = lookupFaultCodeAction(
      gasSafeNoGasWork,
      { make: 'Vaillant', model: 'turboMAX', code: 'F99' },
      lib(),
      log,
    );
    expect(r.instruction).toBe(
      `Don't guess what it means. Note the make, model and code for the engineer. ${SIGNPOST}`,
    );
  });

  it('an entry without guidance says only the meaning', () => {
    const { log } = capture();
    expect(
      lookupFaultCodeAction(
        demo,
        { make: 'Vaillant', model: 'ecoTEC pro', code: 'F22' },
        lib(),
        log,
      ),
    ).toEqual({
      status: 'found',
      meaning: 'A different fixture meaning for the pro range.',
      homeowner_guidance: null,
      source_ref: 'vaillant-pro-f22',
      instruction: `Say Vaillant lists this code as: A different fixture meaning for the pro range. Make clear the engineer will confirm the actual cause. ${SIGNPOST}`,
    });
  });

  it('returns the status for each question it needs answered', () => {
    const { log } = capture();
    expect(lookupFaultCodeAction(demo, {}, lib(), log).status).toBe('needs_make');
    expect(lookupFaultCodeAction(demo, { make: 'Vaillant' }, lib(), log).status).toBe('needs_code');
    expect(lookupFaultCodeAction(demo, { make: 'Vaillant', code: 'F22' }, lib(), log).status).toBe(
      'needs_model',
    );
  });

  it('logs each gap as a knowledge_gap with only make, range and code', () => {
    const { lines, log } = capture();
    lookupFaultCodeAction(demo, { make: 'Potterton', code: 'F1' }, lib(), log);
    lookupFaultCodeAction(demo, { make: 'Vaillant', model: 'turboMAX', code: 'F.28' }, lib(), log);
    const gaps = lines
      .filter((l) => l.msg === 'knowledge_gap')
      .map(({ knowledge_gap, reason, manufacturer, range, code }) => ({
        knowledge_gap,
        reason,
        manufacturer,
        range,
        code,
      }));
    expect(gaps).toEqual([
      { knowledge_gap: true, reason: 'unknown_make', manufacturer: null, range: null, code: null },
      {
        knowledge_gap: true,
        reason: 'not_for_model',
        manufacturer: 'vaillant',
        range: 'turboMAX',
        code: 'F28',
      },
    ]);
  });

  it('trims parameters before cutting them to length', () => {
    const { log } = capture();
    // Make: 79 spaces then the name; trimmed first, so it is still recognised.
    expect(
      lookupFaultCodeAction(demo, { make: `${' '.repeat(79)}Vaillant`, code: 'F28' }, lib(), log)
        .status,
    ).toBe('found');
    // Code is cut to 20 characters: the trailing "x" is dropped, so F28 is found.
    expect(
      lookupFaultCodeAction(demo, { make: 'Vaillant', code: `F28${' '.repeat(17)}x` }, lib(), log)
        .status,
    ).toBe('found');
    // Make is cut to 80 characters: a name after that is never read.
    expect(
      lookupFaultCodeAction(demo, { make: `${'x'.repeat(80)} vaillant`, code: 'F28' }, lib(), log)
        .status,
    ).toBe('not_covered');
    expect(lookupFaultCodeAction(demo, { make: '   ', code: 'F28' }, lib(), log).status).toBe(
      'needs_make',
    );
  });
});
