import { describe, expect, it } from 'vitest';
import {
  OUTCOME_CODES,
  OUTCOME_PIPELINE_STAGE,
  isOutcomeCode,
  pipelineStageFor,
} from '../../src/core/outcome.js';
import { applyVulnerability, isEmergency } from '../../src/core/urgency.js';

describe('outcome taxonomy', () => {
  it('has exactly the 15 Build Plan codes, each with a pipeline mapping', () => {
    expect(OUTCOME_CODES).toHaveLength(15);
    expect(Object.keys(OUTCOME_PIPELINE_STAGE).sort()).toEqual([...OUTCOME_CODES].sort());
  });

  it('rejects anything not in the taxonomy', () => {
    expect(isOutcomeCode('BOOKED')).toBe(true);
    expect(isOutcomeCode('booked')).toBe(false);
    expect(isOutcomeCode('VOICEMAIL')).toBe(false);
  });

  it('only moves ABANDONED to callback when a number was captured', () => {
    expect(pipelineStageFor('ABANDONED', true)).toBe('Callback needed');
    expect(pipelineStageFor('ABANDONED', false)).toBeNull();
    expect(pipelineStageFor('BOOKED', false)).toBe('Booked');
  });
});

describe('urgency', () => {
  it('raises urgency by one level for vulnerable households, capped at P1', () => {
    expect(applyVulnerability('P4', true)).toBe('P3');
    expect(applyVulnerability('P3', true)).toBe('P2');
    expect(applyVulnerability('P1', true)).toBe('P1');
    expect(applyVulnerability('P3', false)).toBe('P3');
  });

  it('treats P1 and P2 as emergencies', () => {
    expect(isEmergency('P1')).toBe(true);
    expect(isEmergency('P2')).toBe(true);
    expect(isEmergency('P3')).toBe(false);
  });
});
