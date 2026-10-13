/**
 * Extracts call metadata from GHL requests. The exact payload of Voice AI custom actions is a
 * Phase 0 spike item (V2): field names below cover the documented workflow-webhook shape
 * (`customData`, nested `location`), query-string parameters (GET custom actions) and the likely
 * custom-action shapes. Once the spike pins the
 * real shape, unused aliases are removed. Everything else in the body is treated as parameters.
 */

export interface GhlEnvelope {
  callId: string | null;
  locationId: string | null;
  contactId: string | null;
  /** Merged parameters: top-level body fields overlaid with `customData` (workflow webhooks). */
  params: { [key: string]: unknown };
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const CALL_ID_KEYS = ['ghl_call_id', 'call_id', 'callId'];
const LOCATION_ID_KEYS = ['location_id', 'locationId'];
const CONTACT_ID_KEYS = ['contact_id', 'contactId'];

function asObject(value: unknown): { [key: string]: unknown } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as { [key: string]: unknown })
    : {};
}

function pickId(sources: { [key: string]: unknown }[], keys: string[]): string | null {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && ID_PATTERN.test(value)) return value;
    }
  }
  return null;
}

export function extractEnvelope(
  body: unknown,
  headers: { [key: string]: string | string[] | undefined },
  query: unknown,
): GhlEnvelope {
  const top = asObject(body);
  const customData = asObject(top.customData);
  // GET custom actions send parameters as query string; body values win when both exist.
  const params = { ...asObject(query), ...top, ...customData };
  delete params.customData;

  const nestedLocation = asObject(top.location);
  const headerSource: { [key: string]: unknown } = {
    location_id: headers['x-ghl-location-id'],
    call_id: headers['x-ghl-call-id'],
  };
  const sources = [customData, top, headerSource, asObject(query)];

  return {
    callId: pickId(sources, CALL_ID_KEYS),
    locationId: pickId([...sources, nestedLocation], [...LOCATION_ID_KEYS, 'id']),
    contactId: pickId(sources, CONTACT_ID_KEYS),
    params,
  };
}
