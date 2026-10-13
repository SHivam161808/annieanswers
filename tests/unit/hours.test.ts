import { describe, expect, it } from 'vitest';
import {
  isWithinSchedule,
  spokenDate,
  spokenTime,
  toLocalTime,
  type WeeklySchedule,
} from '../../src/domain/hours.js';

const schedule: WeeklySchedule = {
  mon: [{ open: '08:00', close: '17:30' }],
  sat: [{ open: '09:00', close: '12:00' }],
};

describe('working hours in Europe/London', () => {
  it('uses BST before the clocks go back on 25 Oct 2026', () => {
    // Sat 24 Oct 2026 08:30 UTC = 09:30 BST -> open
    expect(isWithinSchedule(schedule, new Date('2026-10-24T08:30:00Z'))).toBe(true);
    // 07:30 UTC = 08:30 BST -> before 09:00
    expect(isWithinSchedule(schedule, new Date('2026-10-24T07:30:00Z'))).toBe(false);
  });

  it('uses GMT after the clocks go back', () => {
    // Mon 26 Oct 2026 07:30 UTC = 07:30 GMT -> closed; 08:00 UTC = 08:00 GMT -> open
    expect(isWithinSchedule(schedule, new Date('2026-10-26T07:30:00Z'))).toBe(false);
    expect(isWithinSchedule(schedule, new Date('2026-10-26T08:00:00Z'))).toBe(true);
    // 17:29 GMT open, 17:30 GMT closed (close is exclusive)
    expect(isWithinSchedule(schedule, new Date('2026-10-26T17:29:00Z'))).toBe(true);
    expect(isWithinSchedule(schedule, new Date('2026-10-26T17:30:00Z'))).toBe(false);
  });

  it('handles the spring-forward change (28 Mar 2027)', () => {
    // Mon 29 Mar 2027 07:00 UTC = 08:00 BST -> open
    expect(isWithinSchedule(schedule, new Date('2027-03-29T07:00:00Z'))).toBe(true);
    expect(toLocalTime(new Date('2027-03-28T01:30:00Z')).minutes).toBe(150); // 02:30 BST
  });

  it('respects closed dates (bank holidays)', () => {
    const mondayOpen = new Date('2026-12-28T10:00:00Z');
    expect(isWithinSchedule(schedule, mondayOpen)).toBe(true);
    expect(isWithinSchedule(schedule, mondayOpen, ['2026-12-28'])).toBe(false);
  });

  it('treats days without windows as closed', () => {
    expect(isWithinSchedule(schedule, new Date('2026-10-27T10:00:00Z'))).toBe(false); // Tue
  });

  it('speaks dates and times the UK way', () => {
    expect(spokenDate(new Date('2026-10-13T10:00:00Z'))).toBe('Tuesday the 13th');
    expect(spokenDate(new Date('2026-10-01T10:00:00Z'))).toBe('Thursday the 1st');
    expect(spokenDate(new Date('2026-10-22T10:00:00Z'))).toBe('Thursday the 22nd');
    expect(spokenTime(new Date('2026-11-02T10:30:00Z'))).toBe('half 10');
    expect(spokenTime(new Date('2026-11-02T14:15:00Z'))).toBe('quarter past 2');
    expect(spokenTime(new Date('2026-11-02T14:45:00Z'))).toBe('quarter to 3');
    expect(spokenTime(new Date('2026-11-02T12:00:00Z'))).toBe('midday');
    expect(spokenTime(new Date('2026-11-02T09:00:00Z'))).toBe('9am');
    expect(spokenTime(new Date('2026-11-02T14:40:00Z'))).toBe('2:40pm');
  });
});
