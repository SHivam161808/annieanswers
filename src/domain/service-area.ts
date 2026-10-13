import { parseOutcode, type Outcode } from './postcode.js';

/**
 * Service-area patterns from business config, e.g. "LS1-LS29", "WF1-WF3", "LS" (whole area),
 * "LS6" or "EC1A" (single district).
 */
export type ServiceAreaRule =
  | { kind: 'area'; area: string }
  | { kind: 'range'; area: string; from: number; to: number }
  | { kind: 'district'; area: string; districtNumber: number; subDistrict: string };

const AREA_ONLY = /^[A-Z]{1,2}$/;

export class ServiceAreaParseError extends Error {
  constructor(readonly pattern: string) {
    super(`Invalid service area pattern: "${pattern}"`);
    this.name = 'ServiceAreaParseError';
  }
}

export function parseServiceAreaPattern(pattern: string): ServiceAreaRule {
  const value = pattern.trim().toUpperCase().replace(/\s+/g, '');
  if (AREA_ONLY.test(value)) return { kind: 'area', area: value };

  const rangeParts = value.split('-');
  if (rangeParts.length === 2) {
    const from = parseOutcode(rangeParts[0] as string);
    const to = parseOutcode(rangeParts[1] as string);
    if (
      !from ||
      !to ||
      from.area !== to.area ||
      from.subDistrict !== '' ||
      to.subDistrict !== '' ||
      from.districtNumber > to.districtNumber
    ) {
      throw new ServiceAreaParseError(pattern);
    }
    return { kind: 'range', area: from.area, from: from.districtNumber, to: to.districtNumber };
  }

  const single = parseOutcode(value);
  if (!single) throw new ServiceAreaParseError(pattern);
  return {
    kind: 'district',
    area: single.area,
    districtNumber: single.districtNumber,
    subDistrict: single.subDistrict,
  };
}

export function parseServiceArea(patterns: readonly string[]): ServiceAreaRule[] {
  return patterns.map(parseServiceAreaPattern);
}

function ruleMatches(rule: ServiceAreaRule, outcode: Outcode): boolean {
  if (rule.area !== outcode.area) return false;
  switch (rule.kind) {
    case 'area':
      return true;
    case 'range':
      // EC1A sits inside district 1, so sub-districts match their numeric range.
      return outcode.districtNumber >= rule.from && outcode.districtNumber <= rule.to;
    case 'district':
      return (
        rule.districtNumber === outcode.districtNumber &&
        (rule.subDistrict === '' || rule.subDistrict === outcode.subDistrict)
      );
  }
}

export function isInServiceArea(rules: readonly ServiceAreaRule[], outcode: Outcode): boolean {
  return rules.some((rule) => ruleMatches(rule, outcode));
}
