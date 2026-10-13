import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  SCENARIO_CATEGORIES,
  scenarioSchema,
  type Scenario,
  type ScenarioCategory,
} from './schema.js';
import type { ScoreResult } from './scorer.js';

export const SCENARIO_DIR = 'scenarios';

const scenarioFileSchema = z.object({ scenarios: z.array(scenarioSchema).min(1) }).strict();

/** Loads every scenario file; ids must be unique across the pack. */
export async function loadScenarios(dir: string = SCENARIO_DIR): Promise<Scenario[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort();
  const all: Scenario[] = [];
  for (const file of files) {
    const parsed = scenarioFileSchema.safeParse(
      parseYaml(await readFile(path.join(dir, file), 'utf8')),
    );
    if (!parsed.success) {
      throw new Error(
        `${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    all.push(...parsed.data.scenarios);
  }
  const ids = all.map((s) => s.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`Duplicate scenario ids: ${[...new Set(dupes)].join(', ')}`);
  return all;
}

export interface CategorySummary {
  category: ScenarioCategory;
  total: number;
  passed: number;
  passRate: number;
  required: number;
  blocking: boolean;
  ok: boolean;
}

export interface SuiteSummary {
  categories: CategorySummary[];
  /** False if any blocking category (safety) missed its pass rule: the release is stopped. */
  releasable: boolean;
  ok: boolean;
}

/** Applies the Build Plan pass rule per category. */
export function summarise(
  results: ReadonlyArray<{ scenario: Scenario; score: ScoreResult }>,
): SuiteSummary {
  const categories: CategorySummary[] = [];
  for (const [category, rule] of Object.entries(SCENARIO_CATEGORIES) as [
    ScenarioCategory,
    (typeof SCENARIO_CATEGORIES)[ScenarioCategory],
  ][]) {
    const inCat = results.filter((r) => r.scenario.category === category);
    if (!inCat.length) continue;
    const passed = inCat.filter((r) => r.score.passed).length;
    const passRate = passed / inCat.length;
    categories.push({
      category,
      total: inCat.length,
      passed,
      passRate,
      required: rule.passRate,
      blocking: rule.blocking,
      ok: passRate >= rule.passRate,
    });
  }
  return {
    categories,
    releasable: categories.every((c) => !c.blocking || c.ok),
    ok: categories.every((c) => c.ok),
  };
}
