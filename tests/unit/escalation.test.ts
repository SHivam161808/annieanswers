import { describe, expect, it } from 'vitest';
import { decideEscalation, type EscalationConfig } from '../../src/domain/escalation.js';

const base: EscalationConfig = {
  opening_hours: {
    mon: [{ open: '08:00', close: '17:30' }],
    tue: [{ open: '08:00', close: '17:30' }],
  },
  closed_dates: [],
  emergency_cover: '24x7',
  transfer_number_backup: '+447700900456',
  transfer_rules: { in_hours: ['P1', 'P2', 'asks_for_owner'], out_of_hours: ['P1'] },
};

const IN_HOURS = new Date('2026-11-02T10:00:00Z'); // Mon 10:00 GMT
const OUT_OF_HOURS = new Date('2026-11-02T22:00:00Z'); // Mon 22:00 GMT

describe('escalation matrix (Build Plan)', () => {
  it('P1 in hours: safety script, transfer primary then backup, alert if unanswered', () => {
    const d = decideEscalation(base, 'P1', IN_HOURS);
    expect(d).toMatchObject({
      in_hours: true,
      safety_script_first: true,
      action: 'transfer',
      transfer_targets: ['primary', 'backup'],
      if_transfer_fails: 'emergency_alert',
      outcome: 'EMERGENCY_TRANSFERRED',
      outcome_if_transfer_fails: 'EMERGENCY_ALERTED',
    });
  });

  it('P1 out of hours with cover: safety script then transfer per rules', () => {
    const d = decideEscalation(base, 'P1', OUT_OF_HOURS);
    expect(d).toMatchObject({ in_hours: false, safety_script_first: true, action: 'transfer' });
  });

  it('P1 out of hours with cover but no transfer rule: emergency alert', () => {
    const cfg = { ...base, transfer_rules: { in_hours: ['P1'], out_of_hours: [] } };
    const d = decideEscalation(cfg, 'P1', OUT_OF_HOURS);
    expect(d).toMatchObject({
      safety_script_first: true,
      action: 'emergency_alert',
      outcome: 'EMERGENCY_ALERTED',
    });
  });

  it('P1 out of hours without cover: safety script still first, then callback message', () => {
    const cfg = { ...base, emergency_cover: 'in_hours' as const };
    const d = decideEscalation(cfg, 'P1', OUT_OF_HOURS);
    expect(d).toMatchObject({
      safety_script_first: true,
      emergency_cover_active: false,
      action: 'message',
      outcome: 'CALLBACK_REQUESTED',
    });
  });

  it('safety script is delivered for P1 in every configuration', () => {
    for (const cover of ['none', 'in_hours', 'extended', '24x7'] as const) {
      for (const when of [IN_HOURS, OUT_OF_HOURS]) {
        const d = decideEscalation(
          { ...base, emergency_cover: cover, extended_hours: {} },
          'P1',
          when,
        );
        expect(d.safety_script_first).toBe(true);
      }
    }
  });

  it('P2 in hours: safe advice, transfer, urgent alert if unanswered, emergency slot', () => {
    const d = decideEscalation(base, 'P2', IN_HOURS);
    expect(d).toMatchObject({
      action: 'transfer',
      if_transfer_fails: 'urgent_alert',
      booking_priority: 'emergency',
      outcome_if_transfer_fails: 'EMERGENCY_ALERTED',
    });
  });

  it('P2 out of hours with cover but not in transfer rules: urgent alert', () => {
    const d = decideEscalation(base, 'P2', OUT_OF_HOURS);
    expect(d).toMatchObject({ action: 'urgent_alert', outcome: 'EMERGENCY_ALERTED' });
  });

  it('P2 out of hours without cover: guidance plus first available slot', () => {
    const cfg = { ...base, emergency_cover: 'none' as const };
    const d = decideEscalation(cfg, 'P2', OUT_OF_HOURS);
    expect(d).toMatchObject({
      action: 'book',
      booking_priority: 'next_available',
      outcome: null,
    });
  });

  it('extended cover applies inside extended hours only', () => {
    const cfg: EscalationConfig = {
      ...base,
      emergency_cover: 'extended',
      extended_hours: { mon: [{ open: '17:30', close: '22:00' }] },
      transfer_rules: { in_hours: ['P1', 'P2'], out_of_hours: ['P2'] },
    };
    expect(decideEscalation(cfg, 'P2', new Date('2026-11-02T20:00:00Z')).action).toBe('transfer');
    expect(decideEscalation(cfg, 'P2', new Date('2026-11-02T23:00:00Z')).action).toBe('book');
  });

  it('P3/P4 book with the right priority', () => {
    expect(decideEscalation(base, 'P3', IN_HOURS)).toMatchObject({
      action: 'book',
      booking_priority: 'next_available',
    });
    expect(decideEscalation(base, 'P4', OUT_OF_HOURS)).toMatchObject({
      action: 'book',
      booking_priority: 'normal',
    });
  });

  it('caller asks for owner: transfer in hours if allowed, else message', () => {
    expect(decideEscalation(base, 'asks_for_owner', IN_HOURS)).toMatchObject({
      action: 'transfer',
      outcome: 'TRANSFERRED',
      if_transfer_fails: 'message',
      outcome_if_transfer_fails: 'MESSAGE_TAKEN',
    });
    const noRule = { ...base, transfer_rules: { in_hours: ['P1'], out_of_hours: [] } };
    expect(decideEscalation(noRule, 'asks_for_owner', IN_HOURS)).toMatchObject({
      action: 'message',
      outcome: 'MESSAGE_TAKEN',
    });
    expect(decideEscalation(base, 'asks_for_owner', OUT_OF_HOURS)).toMatchObject({
      action: 'message',
      outcome: 'CALLBACK_REQUESTED',
    });
  });

  it('complaint: message and owner alert at any time', () => {
    for (const when of [IN_HOURS, OUT_OF_HOURS]) {
      expect(decideEscalation(base, 'complaint', when)).toMatchObject({
        action: 'message',
        outcome: 'MESSAGE_TAKEN',
      });
    }
  });

  it('agent stuck: offer transfer in hours, callback out of hours', () => {
    expect(decideEscalation(base, 'agent_stuck', IN_HOURS).action).toBe('offer_transfer');
    expect(decideEscalation(base, 'agent_stuck', OUT_OF_HOURS).action).toBe('offer_callback');
  });

  it('only offers the primary target when no backup is configured', () => {
    const cfg = { ...base, transfer_number_backup: undefined };
    expect(decideEscalation(cfg, 'P1', IN_HOURS).transfer_targets).toEqual(['primary']);
  });

  it('closed dates count as out of hours', () => {
    const cfg = { ...base, closed_dates: ['2026-11-02'], emergency_cover: 'in_hours' as const };
    expect(decideEscalation(cfg, 'P2', IN_HOURS)).toMatchObject({
      in_hours: false,
      action: 'book',
    });
  });
});
