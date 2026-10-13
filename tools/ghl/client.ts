/** Minimal GHL API helper for operator tools (not the request path). Env from tools/env.ts. */
import { readFile } from 'node:fs/promises';
import { locationId, stateFile, token } from '../env.js';

export { locationId, token };

export const GHL_BASE = 'https://services.leadconnectorhq.com';

export interface DemoState {
  agentId: string;
  calendarId: string;
  contactFieldIds: Record<string, string>;
  actionIds: Record<string, string>;
}

export async function loadState(): Promise<DemoState> {
  return JSON.parse(await readFile(stateFile(), 'utf8')) as DemoState;
}

export async function ghl<T>(
  method: string,
  path: string,
  version: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${path.split('?')[0]} -> ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export interface Workflow {
  id: string;
  name: string;
  status: string;
}

export async function listWorkflows(): Promise<Workflow[]> {
  return (
    await ghl<{ workflows: Workflow[] }>(
      'GET',
      `/workflows/?locationId=${locationId}`,
      '2021-07-28',
    )
  ).workflows;
}

/** Finds a workflow by its WF-xx prefix; returns null if missing or ambiguous. */
export function findWorkflow(workflows: Workflow[], code: string): Workflow | null {
  const matches = workflows.filter((w) => w.name.trim().startsWith(`${code} `));
  return matches.length === 1 ? (matches[0] as Workflow) : null;
}
