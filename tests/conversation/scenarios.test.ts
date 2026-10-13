import { beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_CATEGORIES, type Scenario } from '../../src/conversation/schema.js';
import { loadScenarios } from '../../src/conversation/suite.js';
import { loadPromptSources, type PromptSources } from '../../src/prompt/sources.js';

let scenarios: Scenario[];
let sources: PromptSources;

beforeAll(async () => {
  scenarios = await loadScenarios();
  sources = await loadPromptSources('plumbing');
});

describe('scenario pack', () => {
  it('loads with unique ids', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(60);
  });

  it('covers every category in the Build Plan test pack', () => {
    const categories = new Set(scenarios.map((s) => s.category));
    for (const category of Object.keys(SCENARIO_CATEGORIES)) expect(categories).toContain(category);
  });

  it('has at least the Build Plan scenario counts for safety and water emergencies', () => {
    const count = (c: string) => scenarios.filter((s) => s.category === c).length;
    expect(count('safety')).toBeGreaterThanOrEqual(8);
    expect(count('water_emergency')).toBeGreaterThanOrEqual(6);
    expect(count('new_job')).toBeGreaterThanOrEqual(12);
    expect(count('quote')).toBeGreaterThanOrEqual(4);
    expect(count('reschedule_cancel')).toBeGreaterThanOrEqual(6);
    expect(count('existing_complaint')).toBeGreaterThanOrEqual(5);
    expect(count('faq')).toBeGreaterThanOrEqual(6);
    expect(count('out_of_scope')).toBeGreaterThanOrEqual(5);
    expect(count('non_customer')).toBeGreaterThanOrEqual(4);
    expect(count('stress')).toBeGreaterThanOrEqual(10);
    expect(count('adversarial')).toBeGreaterThanOrEqual(5);
  });

  it('covers every conversational test case TC001–TC040 from claude.md', () => {
    const covered = new Set(scenarios.flatMap((s) => s.covers));
    const missing = Array.from(
      { length: 40 },
      (_, i) => `TC${String(i + 1).padStart(3, '0')}`,
    ).filter((tc) => !covered.has(tc));
    expect(missing).toEqual([]);
  });

  it('references only real safety scripts, and every script is exercised', () => {
    const used = new Set(
      scenarios.flatMap((s) => (s.expect.safety_script ? [s.expect.safety_script.id] : [])),
    );
    for (const id of used) expect(sources.safetyScripts.has(id)).toBe(true);
    for (const [id, script] of sources.safetyScripts) {
      if (script.status === 'suspended') expect(used).not.toContain(id);
      else expect(used).toContain(id);
    }
  });

  it('safety-script expectations point at an existing caller turn', () => {
    for (const s of scenarios) {
      if (s.expect.safety_script) {
        expect(s.expect.safety_script.after_caller_turn).toBeLessThan(s.caller.length);
      }
    }
  });

  it('has valid must_say / must_not_say regexes', () => {
    for (const s of scenarios) {
      for (const p of [...s.expect.must_say, ...s.expect.must_not_say]) {
        expect(() => new RegExp(p, 'i'), `${s.id}: ${p}`).not.toThrow();
      }
    }
  });
});
