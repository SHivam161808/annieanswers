import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { businessConfigSchema, type BusinessConfig } from '../../config/schema/business-config.js';
import { parseServiceArea, type ServiceAreaRule } from '../domain/service-area.js';

/** A validated client configuration with derived, pre-parsed values for the hot path. */
export interface ClientConfig {
  config: BusinessConfig;
  serviceAreaRules: ServiceAreaRule[];
}

export interface ConfigStore {
  get(locationId: string): ClientConfig | undefined;
  size(): number;
  locations(): string[];
}

export class ConfigValidationError extends Error {
  constructor(
    readonly file: string,
    readonly issues: string[],
  ) {
    super(`Invalid client config ${file}: ${issues.join('; ')}`);
    this.name = 'ConfigValidationError';
  }
}

export function validateClientConfig(raw: unknown, file: string): ClientConfig {
  const parsed = businessConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigValidationError(
      file,
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return { config: parsed.data, serviceAreaRules: parseServiceArea(parsed.data.service_area) };
}

export async function loadClientConfigFile(file: string): Promise<ClientConfig> {
  return validateClientConfig(parseYaml(await readFile(file, 'utf8')), path.basename(file));
}

/**
 * Loads every client YAML at startup. Any invalid file fails startup: serving a client with a
 * broken configuration risks wrong business facts being spoken to callers.
 */
export async function loadConfigStore(dir: string): Promise<ConfigStore> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const byLocation = new Map<string, ClientConfig>();
  const clientIds = new Set<string>();

  for (const file of files.sort()) {
    const client = await loadClientConfigFile(path.join(dir, file));
    const { ghl_location_id: locationId, client_id: clientId } = client.config;
    if (byLocation.has(locationId)) {
      throw new ConfigValidationError(file, [`duplicate ghl_location_id ${locationId}`]);
    }
    if (clientIds.has(clientId)) {
      throw new ConfigValidationError(file, [`duplicate client_id ${clientId}`]);
    }
    byLocation.set(locationId, client);
    clientIds.add(clientId);
  }

  return {
    get: (locationId) => byLocation.get(locationId),
    size: () => byLocation.size,
    locations: () => [...byLocation.keys()],
  };
}
