/**
 * Validates the technical knowledge library and prints coverage.
 *   npm run validate:knowledge [-- knowledge/boilers/vaillant.yaml]
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { boilerFileSchema, SERVABLE_STATUSES, type BoilerFile } from '../knowledge/schema.js';
import { normaliseCode } from '../src/knowledge/normalise.js';
import {
  SERVABLE_SYMPTOM_STATUSES,
  symptomFileSchema,
  type SymptomFile,
} from '../knowledge/symptom-schema.js';

const DIR = 'knowledge/boilers';
const SYMPTOM_DIR = 'knowledge/symptoms';
const yamlIn = async (dir: string) =>
  (await readdir(dir).catch(() => [] as string[]))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => path.join(dir, f));
const args = process.argv.slice(2);
const files = args.length ? args.filter((f) => !f.includes('/symptoms/')) : await yamlIn(DIR);
const symptomFiles = args.length
  ? args.filter((f) => f.includes('/symptoms/'))
  : await yamlIn(SYMPTOM_DIR);

let failed = 0;
const valid: BoilerFile[] = [];
for (const file of files) {
  const parsed = boilerFileSchema.safeParse(parse(await readFile(file, 'utf8')));
  if (!parsed.success) {
    failed++;
    console.error(`FAIL  ${file}`);
    for (const i of parsed.error.issues.slice(0, 30))
      console.error(`      - ${i.path.join('.')}: ${i.message}`);
    continue;
  }
  // Same code on the same range must not have two different served meanings.
  const seen = new Map<string, string>();
  for (const e of parsed.data.entries.filter((x) => SERVABLE_STATUSES.has(x.status))) {
    for (const r of e.ranges) {
      const key = `${r}|${normaliseCode(e.code)}`;
      const prev = seen.get(key);
      if (prev && prev !== e.meaning) {
        failed++;
        console.error(`FAIL  ${file}: conflicting meanings for ${e.code} on ${r}`);
      }
      seen.set(key, e.meaning);
    }
  }
  valid.push(parsed.data);
}

console.log('\nmanufacturer        ranges(covered/partial/none)  served  needs_review  withdrawn');
for (const f of valid) {
  const c = (k: string) => f.known_ranges.filter((r) => r.coverage === k).length;
  const s = (k: string) => f.entries.filter((e) => e.status === k).length;
  console.log(
    `${f.manufacturer.padEnd(20)}${`${c('covered')}/${c('partial')}/${c('none')}`.padEnd(30)}${String(s('source_verified') + s('reviewed')).padEnd(8)}${String(s('needs_review')).padEnd(14)}${s('withdrawn')}`,
  );
}
const validSymptoms: SymptomFile[] = [];
for (const file of symptomFiles) {
  const parsed = symptomFileSchema.safeParse(parse(await readFile(file, 'utf8')));
  if (!parsed.success) {
    failed++;
    console.error(`FAIL  ${file}`);
    for (const i of parsed.error.issues.slice(0, 30))
      console.error(`      - ${i.path.join('.')}: ${i.message}`);
    continue;
  }
  validSymptoms.push(parsed.data);
}
if (validSymptoms.length) {
  console.log(
    '\nfamily      presentations  served  explanations  flags(unsafe/incorrect_uk/other)',
  );
  for (const f of validSymptoms) {
    const served = f.presentations.filter((p) => SERVABLE_SYMPTOM_STATUSES.has(p.status));
    const fl = (k: string) => f.flags.filter((x) => x.severity === k).length;
    console.log(
      `${f.family.padEnd(12)}${String(f.presentations.length).padEnd(15)}${String(served.length).padEnd(8)}${String(served.reduce((n, p) => n + p.may_explain.length, 0)).padEnd(14)}${fl('unsafe')}/${fl('incorrect_uk')}/${f.flags.length - fl('unsafe') - fl('incorrect_uk')}`,
    );
  }
}
const total = valid.length + validSymptoms.length;
console.log(failed ? `\n${failed} problem(s)` : `\n${total} file(s) valid`);
process.exit(failed ? 1 : 0);
