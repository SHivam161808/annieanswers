/**
 * Provisions the DEMO receptionist into the GHL sub-account in .env (idempotent; re-run safe).
 *   npx tsx tools/demo/provision.ts <public-middleware-url>
 * Creates/updates: demo calendar, L3 custom values, Voice AI agent (rendered prompt + greeting),
 * custom actions (call_context, check_service_area, escalation) and native appointment booking.
 * Created ids are stored in build/state/<locationId>.json so re-runs update instead of duplicating and
 * tools/demo/teardown.ts can remove everything.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CONTACT_FIELDS, WORKFLOW_CONTACT_FIELDS } from '../../config/schema/contact-fields.js';
import { buildCustomValues, buildWorkflowValues } from '../../src/prompt/custom-values.js';
import { renderPrompt } from '../../src/prompt/render.js';
import { loadPromptSources } from '../../src/prompt/sources.js';
import { clientForLocation, locationId, stateFile, token } from '../env.js';

const BASE = 'https://services.leadconnectorhq.com';

const secret = process.env.WEBHOOK_SECRETS!.split(',')[0]!;
const publicUrl = (process.argv[2] ?? process.env.MIDDLEWARE_URL)?.replace(/\/$/, '');
if (!token || !locationId || !secret || !publicUrl?.startsWith('https://')) {
  console.error('usage: npx tsx tools/demo/provision.ts https://<public-url>  (needs .env)');
  process.exit(2);
}

interface State {
  calendarId?: string;
  agentId?: string;
  customValueIds: Record<string, string>;
  contactFieldIds?: Record<string, string>;
  actionIds: Record<string, string>;
}

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await readFile(stateFile(), 'utf8')) as State;
  } catch {
    return { customValueIds: {}, actionIds: {} };
  }
}

async function saveState(state: State): Promise<void> {
  await mkdir('build/state', { recursive: true });
  await writeFile(stateFile(), `${JSON.stringify(state, null, 2)}\n`);
}

async function ghl<T>(method: string, path: string, version: string, body?: unknown): Promise<T> {
  const start = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  const latency = Math.round(performance.now() - start);
  console.log(`  ${method} ${path.split('?')[0]} -> ${res.status} (${latency}ms)`);
  if (!res.ok) throw new Error(`${method} ${path} failed ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const state = await loadState();
const client = await clientForLocation();
const cfg = client.config;
// Name prefix for GHL assets: DEMO for demo clients, otherwise the product name.
const LABEL =
  process.env.ANNIE_LABEL ?? (cfg.client_id.startsWith('demo') ? 'DEMO' : 'AI Receptionist');
const sources = await loadPromptSources(cfg.trade_module);
const values = buildCustomValues(cfg);
const rendered = renderPrompt(sources, 'rendered', values);

// 1. Calendar (T1 GHL calendar) — opening hours from config.
console.log('calendar');
const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } as const;
const openHours = Object.entries(cfg.opening_hours).flatMap(([day, windows]) =>
  (windows ?? []).map((w) => {
    const [oh, om] = w.open.split(':').map(Number);
    const [ch, cm] = w.close.split(':').map(Number);
    return {
      daysOfTheWeek: [DAY_INDEX[day as keyof typeof DAY_INDEX]],
      hours: [{ openHour: oh, openMinute: om, closeHour: ch, closeMinute: cm }],
    };
  }),
);
const slotMinutes = cfg.appointment_types[0]?.duration_minutes ?? 60;
const calendarBody = {
  locationId,
  name: `${LABEL} – ${cfg.business_name_spoken} diary`,
  description: 'Demo calendar for the AI receptionist. Safe to delete.',
  calendarType: 'event',
  slotDuration: slotMinutes,
  slotDurationUnit: 'mins',
  slotInterval: slotMinutes,
  allowBookingAfter: cfg.min_booking_notice_minutes / 60,
  allowBookingAfterUnit: 'hours',
  autoConfirm: true,
  allowReschedule: true,
  allowCancellation: true,
  openHours,
};
// The client config is the source of truth for the calendar. A calendar is only created when the
// config has none; then its id must be written into the YAML (the middleware books against it).
const configuredCalendar =
  cfg.calendar_id && !/^[A-Z_]+$/.test(cfg.calendar_id) ? cfg.calendar_id : null;
if (configuredCalendar) state.calendarId = configuredCalendar;
if (state.calendarId) {
  await ghl('PUT', `/calendars/${state.calendarId}`, '2021-04-15', {
    ...calendarBody,
    locationId: undefined,
  });
} else {
  const res = await ghl<{ calendar: { id: string } }>(
    'POST',
    '/calendars/',
    '2021-04-15',
    calendarBody,
  );
  state.calendarId = res.calendar.id;
  await saveState(state);
}
if (cfg.booking_mode !== 'request_mode' && state.calendarId !== cfg.calendar_id) {
  console.error(
    `\nACTION NEEDED: set calendar_id: ${state.calendarId} in the client YAML (config/clients/), ` +
      'then validate and redeploy the middleware. Find/move/cancel booking will fail until then.',
  );
  process.exitCode = 1;
}

// 2. Custom values (L3). Names equal keys so the prompt placeholders resolve.
console.log('custom values');
const existing = await ghl<{ customValues: { id: string; name: string }[] }>(
  'GET',
  `/locations/${locationId}/customValues`,
  '2021-07-28',
);
for (const [name, value] of Object.entries({ ...values, ...buildWorkflowValues(cfg) })) {
  const id = state.customValueIds[name] ?? existing.customValues.find((c) => c.name === name)?.id;
  if (id) {
    await ghl('PUT', `/locations/${locationId}/customValues/${id}`, '2021-07-28', { name, value });
    state.customValueIds[name] = id;
  } else {
    const res = await ghl<{ customValue: { id: string } }>(
      'POST',
      `/locations/${locationId}/customValues`,
      '2021-07-28',
      { name, value },
    );
    state.customValueIds[name] = res.customValue.id;
  }
  await saveState(state);
}

// 3. Voice AI agent. Rendered prompt (custom-value substitution in prompts is spike item V1).
console.log('agent');
const agentBody = {
  locationId,
  agentName: `${LABEL} – ${cfg.business_name_spoken}`.slice(0, 40),
  businessName: cfg.business_name,
  welcomeMessage: rendered.greeting,
  agentPrompt: rendered.prompt,
  language: 'en-US',
  patienceLevel: 'high',
  maxCallDuration: 600,
  sendUserIdleReminders: true,
  reminderAfterIdleTimeSeconds: 8,
  timezone: 'Europe/London',
  // T-606: GHL writes its call summary as a note on the contact after every call.
  saveCallSummaryAsNote: true,
};
if (state.agentId) {
  await ghl('PATCH', `/voice-ai/agents/${state.agentId}?locationId=${locationId}`, 'v3', {
    ...agentBody,
    locationId: undefined,
  });
} else {
  const res = await ghl<{ id?: string; _id?: string; agent?: { id: string } }>(
    'POST',
    '/voice-ai/agents',
    'v3',
    agentBody,
  );
  state.agentId = res.id ?? res._id ?? res.agent?.id;
  if (!state.agentId)
    throw new Error(`agent id missing in response: ${JSON.stringify(res).slice(0, 300)}`);
  await saveState(state);
}

// 4. Actions.
// GHL API bug (spike finding): custom actions created with `headers` or `parameters` are stored in a
// state GHL cannot read back ("Maximum call stack size exceeded"). So: auth via GHL's own
// authentication field, location id in the URL, and caller parameters (postcode, trigger) are
// added in the GHL UI — see docs/ghl-capabilities.md.
// GET + selectedPaths: GHL only feeds response fields to the agent for GET actions (spike finding:
// with POST the agent ignored our response and invented "we cover that area").
const customAction = (
  path: string,
  triggerPrompt: string,
  triggerMessage: string,
  selectedPaths: string[],
) => ({
  actionType: 'CUSTOM_ACTION',
  actionParameters: {
    triggerPrompt,
    triggerMessage,
    apiDetails: {
      url: `${publicUrl}${path}?location_id=${encodeURIComponent(locationId)}`,
      method: 'GET',
      authenticationRequired: true,
      authenticationValue: secret,
    },
    selectedPaths,
  },
});

const actions: Record<string, { actionType: string; actionParameters: unknown }> = {
  call_context: customAction(
    '/v1/actions/call-context',
    "At the very start of every call, before asking your first question, to learn whether the business is open now, today's date and whether live booking is available.",
    'Right.',
    ['in_hours', 'emergency_cover_active', 'today', 'time_now', 'can_book_live'],
  ),
  check_service_area: customAction(
    '/v1/actions/check-service-area',
    'As soon as the caller gives a postcode (full or partial), to check it is valid and inside the area the business covers.',
    'Let me just check we cover that area.',
    ['postcode_valid', 'in_service_area', 'readback', 'needs_full_postcode', 'instruction'],
  ),
  escalation: customAction(
    '/v1/actions/escalation',
    'After a safety script, for any urgent problem (P1 or P2), when the caller asks for the owner, makes a complaint, or when you are stuck, to get the escalation decision.',
    'Bear with me one moment.',
    ['action', 'safety_script_first', 'if_transfer_fails', 'booking_priority', 'instruction'],
  ),
  find_booking: customAction(
    '/v1/actions/find-booking',
    'When the caller wants to move, cancel or check an existing booking, once you have the phone number it was made under and their name or postcode.',
    'Let me just find that booking.',
    ['status', 'bookings', 'instruction'],
  ),
  available_slots: customAction(
    '/v1/actions/available-slots',
    'When moving a booking and you need free times to offer.',
    'Let me just check the diary.',
    ['status', 'slots', 'instruction'],
  ),
  reschedule_booking: customAction(
    '/v1/actions/reschedule-booking',
    'Only after the caller has confirmed which booking and chosen a new time from available_slots.',
    'Bear with me while I move that.',
    ['status', 'when', 'instruction'],
  ),
  cancel_booking: customAction(
    '/v1/actions/cancel-booking',
    'Only after the caller has confirmed which booking to cancel and given a short reason.',
    'Bear with me while I cancel that.',
    ['status', 'instruction'],
  ),
  book_appointment: {
    actionType: 'APPOINTMENT_BOOKING',
    actionParameters: {
      calendarId: state.calendarId,
      daysOfOfferingDates: 3, // GHL rejects >3 (undocumented; spike finding)
      slotsPerDay: 3,
      hoursBetweenSlots: 1,
    },
  },
};

console.log('actions');
async function agentActions(): Promise<{ id: string; name: string }[]> {
  const agent = await ghl<{ actions?: { id: string; name: string }[] }>(
    'GET',
    `/voice-ai/agents/${state.agentId}?locationId=${locationId}`,
    'v3',
  );
  return agent.actions ?? [];
}
const current = await agentActions();
for (const [name, def] of Object.entries(actions)) {
  const body = { agentId: state.agentId, locationId, name, ...def };
  const id = state.actionIds[name] ?? current.find((a) => a.name === name)?.id;
  if (id) {
    // Actions edited in the GHL UI to add parameters cannot be read back through the API (GHL bug,
    // "Maximum call stack size exceeded"), and a PUT would silently drop those UI parameters.
    const readable = await ghl(
      'GET',
      `/voice-ai/actions/${id}?locationId=${locationId}`,
      'v3',
    ).then(
      () => true,
      () => false,
    );
    if (readable) {
      await ghl('PUT', `/voice-ai/actions/${id}`, 'v3', body);
    } else {
      console.log(`  skip ${name}: has UI-added parameters; edit it in GHL instead`);
    }
    state.actionIds[name] = id;
  } else {
    // GHL can return an error after the action was actually created (observed: 400 "Maximum call
    // stack size exceeded" on a successful create), so the agent is re-read instead of trusting it.
    try {
      await ghl('POST', '/voice-ai/actions', 'v3', body);
    } catch (err) {
      console.log(`  create reported failure, verifying: ${(err as Error).message.slice(0, 160)}`);
    }
    const created = (await agentActions()).find((a) => a.name === name);
    if (!created) throw new Error(`action ${name} was not created`);
    state.actionIds[name] = created.id;
  }
  await saveState(state);
}

// 5. Universal contact fields + post-call extraction (outcome code and job notes on every call).
console.log('contact fields and post-call extraction');
state.contactFieldIds ??= {};
const fields = await ghl<{ customFields: { id: string; name: string }[] }>(
  'GET',
  `/locations/${locationId}/customFields?model=contact`,
  '2021-07-28',
);
for (const spec of CONTACT_FIELDS) {
  let fieldId =
    state.contactFieldIds[spec.key] ?? fields.customFields.find((f) => f.name === spec.key)?.id;
  if (!fieldId) {
    const res = await ghl<{ customField: { id: string } }>(
      'POST',
      `/locations/${locationId}/customFields`,
      '2021-07-28',
      { name: spec.key, dataType: spec.dataType, model: 'contact' },
    );
    fieldId = res.customField.id;
  }
  state.contactFieldIds[spec.key] = fieldId;
  await saveState(state);

  const name = `extract_${spec.key}`;
  const body = {
    agentId: state.agentId,
    locationId,
    name,
    actionType: 'DATA_EXTRACTION',
    actionParameters: {
      contactFieldId: fieldId,
      description: spec.extract,
      examples: spec.examples,
      overwriteExistingValue: true,
    },
  };
  const existingId =
    state.actionIds[name] ?? (await agentActions()).find((a) => a.name === name)?.id;
  if (existingId) {
    await ghl('PUT', `/voice-ai/actions/${existingId}`, 'v3', body);
    state.actionIds[name] = existingId;
  } else {
    await ghl('POST', '/voice-ai/actions', 'v3', body);
    const created = (await agentActions()).find((a) => a.name === name);
    if (!created) throw new Error(`action ${name} was not created`);
    state.actionIds[name] = created.id;
  }
  await saveState(state);
}

// 6. Contact fields maintained by WF-01 (last call time, call count).
for (const spec of WORKFLOW_CONTACT_FIELDS) {
  if (state.contactFieldIds[spec.key]) continue;
  const existingField = fields.customFields.find((f) => f.name === spec.key);
  const id =
    existingField?.id ??
    (
      await ghl<{ customField: { id: string } }>(
        'POST',
        `/locations/${locationId}/customFields`,
        '2021-07-28',
        {
          name: spec.key,
          dataType: spec.dataType,
          model: 'contact',
        },
      )
    ).customField.id;
  state.contactFieldIds[spec.key] = id;
  await saveState(state);
}

console.log(`\ndone. agent ${state.agentId}, calendar ${state.calendarId}`);
console.log(`prompt ${rendered.prompt.length} chars, greeting "${rendered.greeting}"`);
