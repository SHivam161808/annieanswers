import type { ClientConfig } from '../clients/config-store.js';
import { normalisePostcode, spokenReadback } from '../domain/postcode.js';
import { isInServiceArea } from '../domain/service-area.js';

export interface ServiceAreaResponse {
  postcode_valid: boolean;
  postcode: string | null;
  readback: string | null;
  in_service_area: boolean | null;
  needs_full_postcode: boolean;
  outcome_if_ending: 'OUT_OF_AREA' | null;
  instruction: string;
}

export function checkServiceArea(client: ClientConfig, rawPostcode: unknown): ServiceAreaResponse {
  const normalised = typeof rawPostcode === 'string' ? normalisePostcode(rawPostcode) : null;
  if (!normalised) {
    return {
      postcode_valid: false,
      postcode: null,
      readback: null,
      in_service_area: null,
      needs_full_postcode: true,
      outcome_if_ending: null,
      instruction:
        'The postcode was not recognised. Ask the caller to say it again slowly, or to spell it.',
    };
  }

  const inArea = isInServiceArea(client.serviceAreaRules, normalised);
  const readback = spokenReadback(normalised);
  const name = client.config.business_name_spoken;

  if (!inArea) {
    return {
      postcode_valid: true,
      postcode: normalised.postcode ?? normalised.outcode,
      readback,
      in_service_area: false,
      needs_full_postcode: false,
      outcome_if_ending: 'OUT_OF_AREA',
      instruction: `Confirm the postcode (${readback}). If correct, apologise: ${name} doesn't cover that area. Do not book or take job details.`,
    };
  }

  return {
    postcode_valid: true,
    postcode: normalised.postcode ?? normalised.outcode,
    readback,
    in_service_area: true,
    needs_full_postcode: normalised.postcode === null,
    outcome_if_ending: null,
    instruction:
      normalised.postcode === null
        ? 'That area is covered. Ask for the rest of the postcode.'
        : `That area is covered. Read the postcode back to confirm: ${readback}.`,
  };
}
