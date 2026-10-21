import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/**
 * SMS templates (ghl/sms-templates.yaml, tested for length/charset/PECR in tests/unit/sms.test.ts),
 * rendered by the middleware when it sends owner alerts itself.
 */

export interface SmsTemplate {
  id: string;
  workflow: string;
  to: 'customer' | 'owner';
  status: 'draft' | 'approved';
  body: string;
}

export function loadTemplates(file = 'ghl/sms-templates.yaml'): Map<string, SmsTemplate> {
  const doc = parse(readFileSync(file, 'utf8')) as { templates: SmsTemplate[] };
  return new Map(doc.templates.map((t) => [t.id, t]));
}

const MERGE = /\{\{\s*([a-z_]+\.[a-z0-9_]+)\s*\}\}/g;

/** Fills merge fields; missing values are dropped and the spacing tidied. */
export function renderTemplate(
  body: string,
  values: Readonly<Record<string, string | null | undefined>>,
): string {
  return (
    body
      .replace(MERGE, (_m, key: string) => (values[key] ?? '').trim())
      .replace(/\s+([,.:])/g, '$1')
      // Punctuation stranded by empty fields: "P2:. Call" -> "P2: Call".
      .replace(/([:.,])[.,]+/g, '$1')
      .replace(/\(\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}
