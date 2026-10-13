/**
 * Behaviour pinned down by mutation testing (stryker): every assertion here kills a mutant that the
 * broader suites let survive. Grouped by module.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { callContext } from '../../src/actions/call-context.js';
import { escalation } from '../../src/actions/escalation.js';
import { checkServiceArea } from '../../src/actions/service-area.js';
import { validateClientConfig, type ClientConfig } from '../../src/clients/config-store.js';
import { AppError } from '../../src/core/errors.js';
import { GAS_JOB_TYPES, isJobType } from '../../src/core/job-types.js';
import { OUTCOME_PIPELINE_STAGE, isOutcomeCode } from '../../src/core/outcome.js';
import { isUrgency } from '../../src/core/urgency.js';
import { decideEscalation, type EscalationConfig } from '../../src/domain/escalation.js';
import {
  BUSINESS_TIMEZONE,
  isWithinSchedule,
  parseClock,
  spokenClock,
  spokenDate,
  spokenTime,
  toLocalTime,
} from '../../src/domain/hours.js';
import { normalisePostcode } from '../../src/domain/postcode.js';
import {
  ServiceAreaParseError,
  isInServiceArea,
  parseServiceArea,
  parseServiceAreaPattern,
} from '../../src/domain/service-area.js';
import { extractEnvelope } from '../../src/routes/ghl-envelope.js';
import { isAuthorised } from '../../src/security/auth.js';

const demo: ClientConfig = validateClientConfig(
  parse(readFileSync('config/clients/demo.yaml', 'utf8')),
  'demo.yaml',
);
const withConfig = (patch: Partial<ClientConfig['config']>): ClientConfig =>
  validateClientConfig({ ...demo.config, ...patch }, 'patched.yaml');
const MON_10AM = new Date('2026-11-02T10:00:00Z');
const MON_10PM = new Date('2026-11-02T22:00:00Z');

describe('escalation action: exact instruction given to the agent', () => {
  const instr = (trigger: Parameters<typeof escalation>[1], when = MON_10AM, client = demo) =>
    escalation(client, trigger, when).instruction;

  it('P1 transfer: safety script first, then transfer', () => {
    expect(instr('P1')).toBe(
      'Deliver the approved safety script first, word for word. Then: Tell the caller you are putting them through now, then use the transfer action.',
    );
  });

  it('P2: only the electrics script, no other water instructions', () => {
    expect(instr('P2')).toBe(
      'If water is near any electrics, say the water_on_electrics script first, word for word. Give no other instructions about the water. Then: Tell the caller you are putting them through now, then use the transfer action.',
    );
  });

  it('P3/P4: no prefix, continue to booking', () => {
    expect(instr('P3')).toBe('Continue to booking.');
    expect(instr('P4', MON_10PM)).toBe('Continue to booking.');
  });

  it('message and callback instructions name the owner and the callback promise', () => {
    expect(instr('complaint')).toBe(
      'Take a message for Dave and tell the caller: Dave will ring you back within 2 hours during working hours.',
    );
    expect(instr('agent_stuck', MON_10PM)).toBe(
      'Offer a callback from Dave: Dave will ring you back within 2 hours during working hours.',
    );
    expect(instr('agent_stuck')).toBe(
      'Offer to put the caller through to Dave. Transfer only if they agree.',
    );
  });

  it('alert instructions for P1/P2 when transfer is not allowed', () => {
    const noTransfer = withConfig({ transfer_rules: { in_hours: [], out_of_hours: [] } });
    expect(instr('P1', MON_10AM, noTransfer)).toBe(
      'Deliver the approved safety script first, word for word. Then: Tell the caller you are alerting Dave as an emergency right now and they will be contacted urgently.',
    );
    expect(instr('P2', MON_10AM, noTransfer)).toContain(
      'Then: Tell the caller you are sending Dave an urgent alert now.',
    );
  });
});

describe('call context', () => {
  it('can_book_live only for calendar booking modes', () => {
    expect(callContext(demo, MON_10AM).can_book_live).toBe(true);
    expect(
      callContext(withConfig({ booking_mode: 'synced_calendar' }), MON_10AM).can_book_live,
    ).toBe(true);
    expect(
      callContext(
        withConfig({
          booking_mode: 'request_mode',
          calendar_id: undefined,
          appointment_types: [],
          job_appointment_types: {},
        }),
        MON_10AM,
      ).can_book_live,
    ).toBe(false);
  });
});

describe('service-area action: exact responses', () => {
  it('unrecognised postcode', () => {
    expect(checkServiceArea(demo, 'not a postcode')).toEqual({
      postcode_valid: false,
      postcode: null,
      readback: null,
      in_service_area: null,
      needs_full_postcode: true,
      outcome_if_ending: null,
      instruction:
        'The postcode was not recognised. Ask the caller to say it again slowly, or to spell it.',
    });
    expect(checkServiceArea(demo, 12345).postcode_valid).toBe(false);
    expect(checkServiceArea(demo, undefined).postcode_valid).toBe(false);
  });

  it('full in-area postcode', () => {
    expect(checkServiceArea(demo, 'LS6 2AB')).toEqual({
      postcode_valid: true,
      postcode: 'LS6 2AB',
      readback: 'L S 6... 2 A B',
      in_service_area: true,
      needs_full_postcode: false,
      outcome_if_ending: null,
      instruction: 'That area is covered. Read the postcode back to confirm: L S 6... 2 A B.',
    });
  });

  it('outcode only, in area: asks for the rest', () => {
    expect(checkServiceArea(demo, 'LS12')).toMatchObject({
      postcode_valid: true,
      postcode: 'LS12',
      needs_full_postcode: true,
      instruction: 'That area is covered. Ask for the rest of the postcode.',
    });
  });

  it('out of area: never asks for more, gives the outcome', () => {
    expect(checkServiceArea(demo, 'M1')).toMatchObject({
      postcode: 'M1',
      in_service_area: false,
      needs_full_postcode: false,
      outcome_if_ending: 'OUT_OF_AREA',
    });
    expect(checkServiceArea(demo, 'M1 1AE').instruction).toBe(
      "Confirm the postcode (M 1... 1 A E). If correct, apologise: Smith and Sons doesn't cover that area. Do not book or take job details.",
    );
  });
});

describe('core codes', () => {
  it('type guards', () => {
    expect(isJobType('leak_repair')).toBe(true);
    expect(isJobType('Leak_Repair')).toBe(false);
    expect(isJobType(1)).toBe(false);
    expect(isUrgency('P2')).toBe(true);
    expect(isUrgency('P5')).toBe(false);
    expect(isUrgency(2)).toBe(false);
    expect(isOutcomeCode(1)).toBe(false);
    expect(isOutcomeCode('')).toBe(false);
  });

  it('gas job types are exactly the gas codes', () => {
    expect([...GAS_JOB_TYPES].sort()).toEqual(['gas_appliance', 'gas_boiler']);
  });

  it('pipeline stages match the Build Plan table exactly', () => {
    expect(OUTCOME_PIPELINE_STAGE).toEqual({
      BOOKED: 'Booked',
      BOOKING_REQUESTED: 'Awaiting confirmation',
      RESCHEDULED: 'Booked',
      CANCELLED: 'Lost or cancelled',
      EMERGENCY_TRANSFERRED: 'Emergency',
      EMERGENCY_ALERTED: 'Emergency',
      TRANSFERRED: 'Callback needed',
      CALLBACK_REQUESTED: 'Callback needed',
      MESSAGE_TAKEN: 'Callback needed',
      INFO_ONLY: null,
      OUT_OF_AREA: null,
      OUT_OF_SCOPE: null,
      NON_CUSTOMER: null,
      ABANDONED: 'Callback needed',
      TECH_FAILURE: 'Callback needed',
    });
  });

  it('AppError defaults', () => {
    const err = new AppError('not_found', 'x');
    expect(err.name).toBe('AppError');
    expect(err.retryable).toBe(false);
    expect(err.statusCode).toBe(404);
  });
});

describe('escalation matrix: remaining branches', () => {
  const base: EscalationConfig = {
    opening_hours: { mon: [{ open: '08:00', close: '17:30' }] },
    closed_dates: [],
    emergency_cover: 'in_hours',
    transfer_rules: { in_hours: ['P1', 'P2'], out_of_hours: [] },
  };

  it('cover "none" is never active; "in_hours" only in hours; "extended" without hours is in-hours only', () => {
    expect(
      decideEscalation({ ...base, emergency_cover: 'none' }, 'P2', MON_10AM).emergency_cover_active,
    ).toBe(false);
    expect(decideEscalation(base, 'P2', MON_10AM).emergency_cover_active).toBe(true);
    expect(decideEscalation(base, 'P2', MON_10PM).emergency_cover_active).toBe(false);
    const ext = { ...base, emergency_cover: 'extended' as const };
    expect(decideEscalation(ext, 'P2', MON_10AM).emergency_cover_active).toBe(true);
    expect(decideEscalation(ext, 'P2', MON_10PM).emergency_cover_active).toBe(false);
  });

  it('safety script only for P1', () => {
    for (const t of ['P2', 'P3', 'P4', 'asks_for_owner', 'complaint', 'agent_stuck'] as const) {
      expect(decideEscalation(base, t, MON_10AM).safety_script_first).toBe(false);
    }
  });

  it('booking priority: P1 none, P2 emergency (transfer or alert)', () => {
    expect(decideEscalation(base, 'P1', MON_10AM).booking_priority).toBeNull();
    expect(decideEscalation(base, 'P2', MON_10AM).booking_priority).toBe('emergency');
    const noRules = { ...base, transfer_rules: { in_hours: [], out_of_hours: [] } };
    expect(decideEscalation(noRules, 'P1', MON_10AM).booking_priority).toBeNull();
    expect(decideEscalation(noRules, 'P2', MON_10AM).booking_priority).toBe('emergency');
  });

  it('P3 transfer when the client allows it, falling back to booking', () => {
    const rules = { ...base, transfer_rules: { in_hours: ['P3'], out_of_hours: [] } };
    expect(decideEscalation(rules, 'P3', MON_10AM)).toMatchObject({
      action: 'transfer',
      transfer_targets: ['primary'],
      if_transfer_fails: 'book',
      booking_priority: 'next_available',
      outcome: 'TRANSFERRED',
    });
  });

  it('agent stuck: exact in-hours and out-of-hours decisions', () => {
    expect(decideEscalation(base, 'agent_stuck', MON_10AM)).toMatchObject({
      action: 'offer_transfer',
      if_transfer_fails: 'offer_callback',
      outcome: 'TRANSFERRED',
      outcome_if_transfer_fails: 'CALLBACK_REQUESTED',
    });
    expect(decideEscalation(base, 'agent_stuck', MON_10PM)).toMatchObject({
      action: 'offer_callback',
      outcome: 'CALLBACK_REQUESTED',
      transfer_targets: [],
    });
  });
});

describe('hours: parsing and UK speech', () => {
  it('uses Europe/London', () => {
    expect(BUSINESS_TIMEZONE).toBe('Europe/London');
  });

  it.each(['25:00', '9:00', '12:60', 'x12:00', '12:00x', '24:01', '', '12-00'])(
    'rejects clock "%s"',
    (v) => {
      expect(() => parseClock(v)).toThrow(`Invalid time "${v}"`);
    },
  );

  it('accepts 00:00 and 24:00', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('24:00')).toBe(1440);
    expect(spokenClock(1440)).toBe('midnight');
  });

  it('reads local time fields', () => {
    expect(toLocalTime(new Date('2026-11-04T13:05:00Z'))).toEqual({
      weekday: 'wed',
      minutes: 13 * 60 + 5,
      date: '2026-11-04',
      dayOfMonth: 4,
    });
    expect(toLocalTime(new Date('2026-11-06T09:00:00Z')).weekday).toBe('fri');
  });

  it.each([
    ['2026-11-02', 'Monday the 2nd'],
    ['2026-11-03', 'Tuesday the 3rd'],
    ['2026-11-04', 'Wednesday the 4th'],
    ['2026-11-06', 'Friday the 6th'],
    ['2026-11-07', 'Saturday the 7th'],
    ['2026-11-08', 'Sunday the 8th'],
    ['2026-11-11', 'Wednesday the 11th'],
    ['2026-11-12', 'Thursday the 12th'],
    ['2026-11-13', 'Friday the 13th'],
    ['2026-11-21', 'Saturday the 21st'],
    ['2026-11-23', 'Monday the 23rd'],
    ['2026-12-31', 'Thursday the 31st'],
  ])('%s is "%s"', (date, spoken) => {
    expect(spokenDate(new Date(`${date}T12:00:00Z`))).toBe(spoken);
  });

  it.each([
    ['00:00', '12am'],
    ['01:10', '1:10am'],
    ['11:45', 'quarter to 12'],
    ['12:15', 'quarter past 12'],
    ['12:40', '12:40pm'],
    ['13:00', '1pm'],
    ['23:45', 'quarter to 12'],
    ['11:05', '11:05am'],
  ])('%s GMT is said "%s"', (clock, spoken) => {
    expect(spokenTime(new Date(`2026-11-02T${clock}:00Z`))).toBe(spoken);
  });

  it('closed dates default to none', () => {
    expect(isWithinSchedule({ mon: [{ open: '08:00', close: '17:00' }] }, MON_10AM)).toBe(true);
  });
});

describe('postcode normaliser: spoken words and limits', () => {
  it.each([
    ['zero', '0'],
    ['nought', '0'],
    ['one', '1'],
    ['four', '4'],
    ['five', '5'],
    ['seven', '7'],
    ['eight', '8'],
    ['nine', '9'],
  ])('"LS6 %s A B" uses %s as the inward digit', (word, digit) => {
    expect(normalisePostcode(`L S 6 ${word} A B`)?.postcode).toBe(`LS6 ${digit}AB`);
  });

  it.each([
    ['eleven', 11],
    ['twelve', 12],
    ['thirteen', 13],
    ['fourteen', 14],
    ['fifteen', 15],
    ['sixteen', 16],
    ['seventeen', 17],
    ['eighteen', 18],
    ['nineteen', 19],
    ['twenty', 20],
    ['twenty one', 21],
    ['twenty nine', 29],
  ])('"L S %s" is district %i', (words, n) => {
    expect(normalisePostcode(`L S ${words} 1 A B`)?.postcode).toBe(`LS${n} 1AB`);
  });

  it('"twenty oh" is district 20 followed by a zero, never 200', () => {
    expect(normalisePostcode('L S twenty oh A B')?.postcode).toBe('LS20 0AB');
  });

  it('"double"/"treble"/"triple" repeat a single character only', () => {
    expect(normalisePostcode('B double three 8 T H')?.postcode).toBe('B33 8TH');
    expect(normalisePostcode('W treble 1')).toBeNull();
    expect(normalisePostcode('L S 6 2 A double')).toBeNull();
  });

  it('"oh" first is the letter O, later it is zero', () => {
    expect(normalisePostcode('oh X 1 2 J D')?.postcode).toBe('OX1 2JD');
    expect(normalisePostcode('W 1 A oh A X')?.postcode).toBe('W1A 0AX');
  });

  it('length limit is 64 characters inclusive', () => {
    expect(normalisePostcode(`LS6 2AB${' '.repeat(57)}`)?.postcode).toBe('LS6 2AB');
    expect(normalisePostcode(`LS6 2AB${' '.repeat(58)}`)).toBeNull();
    expect(normalisePostcode('')).toBeNull();
  });

  it('two written parts with punctuation fall back to compaction', () => {
    expect(normalisePostcode('LS6 2A-B')?.postcode).toBe('LS6 2AB');
  });

  it('anchors: extra leading or trailing characters are rejected', () => {
    expect(normalisePostcode('XLS6 2AB')).toBeNull();
    expect(normalisePostcode('LS6 2ABX')).toBeNull();
    expect(normalisePostcode('1LS6')).toBeNull();
    expect(normalisePostcode('LS6X1')).toBeNull();
  });

  it('GIR 0AA is complete', () => {
    expect(normalisePostcode('GIR 0AA')).toEqual({
      postcode: 'GIR 0AA',
      inward: '0AA',
      outcode: 'GIR',
      area: 'GIR',
      districtNumber: 0,
      subDistrict: '',
    });
    expect(normalisePostcode('GIR 0AB')).toBeNull();
  });

  it('short inputs that are not outcodes are rejected', () => {
    expect(normalisePostcode('LS')).toBeNull();
    expect(normalisePostcode('6')).toBeNull();
  });
});

describe('service area patterns: edges', () => {
  it('error type and message', () => {
    const err = (() => {
      try {
        parseServiceAreaPattern('nope!');
      } catch (e) {
        return e;
      }
    })() as ServiceAreaParseError;
    expect(err).toBeInstanceOf(ServiceAreaParseError);
    expect(err.name).toBe('ServiceAreaParseError');
    expect(err.message).toBe('Invalid service area pattern: "nope!"');
  });

  it('tolerates spaces and case', () => {
    expect(parseServiceAreaPattern(' ls 1 - ls 29 ')).toEqual({
      kind: 'range',
      area: 'LS',
      from: 1,
      to: 29,
    });
  });

  it('ranges: equal bounds allowed, reversed and sub-district bounds rejected', () => {
    expect(parseServiceAreaPattern('LS1-LS1')).toEqual({
      kind: 'range',
      area: 'LS',
      from: 1,
      to: 1,
    });
    expect(() => parseServiceAreaPattern('LS2-LS1')).toThrow(ServiceAreaParseError);
    expect(() => parseServiceAreaPattern('EC1A-EC4')).toThrow(ServiceAreaParseError);
    expect(() => parseServiceAreaPattern('EC1-EC4A')).toThrow(ServiceAreaParseError);
  });

  it('range bounds are inclusive and exact', () => {
    const rules = parseServiceArea(['LS5-LS7']);
    const at = (pc: string) => isInServiceArea(rules, normalisePostcode(pc)!);
    expect([at('LS4 1AA'), at('LS5 1AA'), at('LS7 1AA'), at('LS8 1AA')]).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it('single district does not match a longer district number', () => {
    expect(isInServiceArea(parseServiceArea(['LS6']), normalisePostcode('LS16 1AA')!)).toBe(false);
  });
});

describe('envelope: every documented id source', () => {
  it.each([
    [{ ghl_call_id: 'c1' }, 'callId', 'c1'],
    [{ callId: 'c2' }, 'callId', 'c2'],
    [{ locationId: 'l1' }, 'locationId', 'l1'],
    [{ contact_id: 'k1' }, 'contactId', 'k1'],
    [{ contactId: 'k2' }, 'contactId', 'k2'],
  ] as const)('%j -> %s', (body, field, value) => {
    expect(extractEnvelope(body, {}, {})[field]).toBe(value);
  });

  it('reads the call id header', () => {
    expect(extractEnvelope({}, { 'x-ghl-call-id': 'hdr_call' }, {}).callId).toBe('hdr_call');
  });
});

describe('auth: header edge cases', () => {
  const secret = 'edge-case-secret-0123456789abcdef01';
  it('empty x-annie-secret falls through to Authorization', () => {
    expect(isAuthorised({ 'x-annie-secret': '', authorization: secret }, [secret])).toBe(true);
  });
  it('Bearer is stripped exactly once', () => {
    expect(isAuthorised({ authorization: `Bearer ${secret}` }, [secret])).toBe(true);
    expect(isAuthorised({ authorization: `Bearer Bearer ${secret}` }, [secret])).toBe(false);
    expect(isAuthorised({ authorization: `bearer ${secret}` }, [secret])).toBe(false);
  });
  it('tokens containing whitespace are rejected', () => {
    expect(isAuthorised({ authorization: `${secret} x` }, [`${secret} x`])).toBe(false);
    expect(isAuthorised({ authorization: 'Bearer  ' }, [''])).toBe(false);
  });
});
