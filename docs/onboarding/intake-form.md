# Client intake form (T-205)

One question per business configuration key in
[`config/schema/business-config.ts`](../../config/schema/business-config.ts). Every answer becomes
one line of `config/clients/<client>.yaml`. Nothing on this form changes the prompt or the
workflows: if a question can't be answered from this form, it belongs in the knowledge base
([knowledge-base-template.md](knowledge-base-template.md)), not in a code change.

How to use it: send Part B to the plumber (or go through it on a 30-minute call). We fill in
Part A. Anything the agent says word for word (prices, quote policy, call-back promise,
cancellation policy) is read back to the plumber and signed off before go-live.

Worked example throughout: the DEMO business, [`config/clients/demo.yaml`](../../config/clients/demo.yaml).

---

## Part A — filled in by us

| Key                  | Format                                                                                                                                             | Example                | Required               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------- |
| `schema_version`     | The number `1`                                                                                                                                     | `1`                    | Yes                    |
| `client_id`          | Lowercase slug: letters, digits, hyphens; 2–63 characters                                                                                          | `demo-plumbing`        | Yes                    |
| `ghl_location_id`    | The client sub-account's location id (from the GHL sub-account settings ⚠ verify), up to 64 characters. Must not be used by any other client file. | `9UQLq2DdUdH26L5IwhqH` | Yes                    |
| `trade_module`       | `plumbing` (the only module in V1)                                                                                                                 | `plumbing`             | Yes                    |
| `calendar_id`        | GHL calendar id, up to 64 characters. Required when `booking_mode` is `ghl_calendar` or `synced_calendar`.                                         | `DEMO_CALENDAR_ID`     | Conditional            |
| `knowledge_base_ids` | List of GHL knowledge base ids, up to 64 characters each                                                                                           | `[]`                   | No (defaults to empty) |

---

## Part B — questions for the business

### 1. About your business

**1.1 `business_name` — What is your business's full registered or trading name?**

- Format: text, 1–100 characters.
- Example: `Smith & Sons Plumbing Ltd`
- Required: yes.
- Help: This is used on text messages and records, written down — not spoken.

**1.2 `business_name_spoken` — How should the receptionist say your business name on the phone?**

- Format: text, 1–100 characters, written how it's said out loud.
- Example: `Smith and Sons`
- Required: yes.
- Help: Callers hear this in the greeting. Drop "Ltd", write "&" as "and", and keep it short —
  the whole greeting has to fit in about four seconds.

**1.3 `agent_name` — Would you like the receptionist to have a first name?**

- Format: text, 1–40 characters, or leave blank.
- Example: `Sophie`
- Required: no.
- Help: If you leave it blank, she introduces herself as your virtual assistant. Either way
  she will always say she's a virtual assistant if asked.

**1.4 `owner_first_name` — Whose first name should callers hear for call-backs?**

- Format: text, 1–40 characters.
- Example: `Dave`
- Required: yes.
- Help: She'll say things like "I'll pass this to Dave" and "Dave will confirm that". Use the
  person who actually rings customers back.

### 2. What you do

**2.1 `services_offered` — Which of these jobs do you take on?** (tick all that apply)

- Format: list of job-type codes from the table below. At least one.
- Example: `[leak_repair, burst_pipe, blocked_drain, blocked_toilet, tap_toilet, no_hot_water]`
- Required: yes.

**2.2 `services_not_offered` — Which of these do you definitely _not_ do?** (tick all that apply)

- Format: list of job-type codes. A job can't be in both lists.
- Example: `[gas_boiler, gas_appliance, drain_cctv]`
- Required: no (defaults to none).
- Help: She tells callers politely that you don't do these and suggests they find someone who
  does. Anything in neither list, she says you'll confirm.

| Code               | What the caller hears          | Code                 | What the caller hears                     |
| ------------------ | ------------------------------ | -------------------- | ----------------------------------------- |
| `leak_repair`      | leak repairs                   | `cylinder_immersion` | hot water cylinders and immersion heaters |
| `burst_pipe`       | burst pipes                    | `outside_tap`        | outside taps                              |
| `blocked_drain`    | blocked sinks and drains       | `pipework`           | pipework                                  |
| `blocked_toilet`   | blocked toilets                | `bathroom_install`   | bathroom installations                    |
| `tap_toilet`       | tap and toilet repairs         | `kitchen_plumbing`   | kitchen plumbing                          |
| `no_hot_water`     | hot water problems             | `appliance_plumbing` | washing machine and dishwasher plumbing   |
| `no_water`         | loss of water supply           | `gas_boiler`         | gas boilers (Gas Safe only)               |
| `sewage_backup`    | sewage problems                | `gas_appliance`      | gas appliances (Gas Safe only)            |
| `radiator_heating` | radiators and heating pipework | `drain_cctv`         | drain camera surveys                      |
|                    |                                | `other`              | other plumbing work                       |

**2.3 `gas_safe_registered` — Are you (or an engineer you send) Gas Safe registered?**

- Format: `true` or `false`.
- Example: `false`
- Required: yes.
- Help: If "no", you cannot tick gas boilers or gas appliances in 2.1 — the form will be
  rejected. She'll point gas callers to a Gas Safe registered engineer. Gas _emergencies_ (a
  smell of gas) are always handled with the fixed safety script, whatever you answer here.

**2.4 `service_area` — Which postcode areas do you cover?**

- Format: list of postcode districts. Each entry is one of:
  - a range in the same area: `LS1-LS29`
  - a single district: `LS6` or `EC1A`
  - a whole postcode area: `LS` (every LS district)
- Example: `[LS1-LS29, WF1-WF3]`
- Required: yes, at least one.
- Help: Give the first half of the postcode, as on a letter (the "LS6" part of "LS6 2AB"). Town
  names don't work — "Leeds" is ambiguous. If you're not sure, list the districts you'd happily
  drive to on a wet Monday. She checks every caller's postcode against this list and never
  guesses from a town name.

### 3. When you're open

**3.1 `opening_hours` — What are your normal working hours, day by day?**

- Format: for each of `mon tue wed thu fri sat sun`, a list of `{ open: 'HH:MM', close: 'HH:MM' }`
  in 24-hour UK time. Leave a day out if you're closed. `24:00` means midnight at the end of the
  day. Open must be before close. Two windows on one day are allowed (e.g. a lunch break).
- Example:
  ```yaml
  opening_hours:
    mon: [{ open: '08:00', close: '17:30' }]
    sat: [{ open: '09:00', close: '12:00' }]
  ```
- Required: yes.
- Help: These decide "in hours" and "out of hours" — who gets put through, and what she says.
  Use the hours you actually answer the phone, not the hours you're on site.

**3.2 `closed_dates` — Which days will you be closed (bank holidays, holidays)?**

- Format: list of dates `YYYY-MM-DD`, quoted.
- Example: `['2026-12-25', '2026-12-26', '2027-01-01']`
- Required: no (defaults to none).
- Help: On these days every call is treated as out of hours. Tell us when you book time off;
  bank holidays are not added automatically.

**3.3 `emergency_cover` — Do you take emergency call-outs, and when?**

- Format: one of `none`, `in_hours`, `extended`, `24x7`.
- Example: `24x7`
- Required: yes.
- Help:
  - `none` — no emergencies; out of hours she takes a message for a call back.
  - `in_hours` — emergencies only during your opening hours.
  - `extended` — opening hours plus some extra hours (answer 3.4).
  - `24x7` — any time, day or night.

**3.4 `extended_hours` — If "extended": when does your emergency cover run outside normal hours?**

- Format: same as `opening_hours`.
- Example: `mon: [{ open: '17:30', close: '22:00' }]`
- Required: only when `emergency_cover` is `extended`.

### 4. Prices and payment

Anything here is said **word for word**. Write it the way you'd say it on the phone, under 240
characters, one sentence each, no symbols like `{ } < >`. Write amounts as spoken
("60 pounds", not "£60.00"), and say "plus VAT" if it is.

**4.1 `pricing_statements` — What prices are you happy for her to tell callers?**

- Format: list of approved sentences.
- Example: `['Call-out is 60 pounds including the first hour.']`
- Required: no. If blank, she never gives a price and says you'll confirm.
- Help: She will not quote any price that isn't here — no ballparks, no "usually around".

**4.2 `quote_policy` — How do you handle quotes?**

- Format: one approved sentence.
- Example: `Installs get a free quote after a site visit.`
- Required: yes.

**4.3 `payment_methods` — How can customers pay?**

- Format: list of short items, each up to 40 characters.
- Example: `[Card, Bank transfer]`
- Required: no. If blank, she says you'll confirm.

### 5. Getting hold of you

All phone numbers in international format: `+44` then the number without its first 0
(07700 900123 → `+447700900123`).

**5.1 `transfer_number_primary` — Which number should she put urgent calls through to?**

- Format: E.164, e.g. `+447700900123`.
- Example: `+447700900123`
- Required: yes.
- Help: Usually your mobile. This must **not** be the number you're diverting to her, or calls go
  round in a loop.

**5.2 `transfer_number_backup` — If you don't pick up, is there a second number to try?**

- Format: E.164, different from the primary.
- Example: `+447700900456`
- Required: no.

**5.3 `transfer_rules` — When should she put a caller straight through to you?**

- Format: two lists, `in_hours` and `out_of_hours`, using these triggers:
  - `P1` — danger to people (gas smell, carbon monoxide, water on electrics)
  - `P2` — active damage (burst pipe, water through a ceiling, sewage inside, no water at all)
  - `P3` — essential service lost but contained (no hot water, only toilet blocked)
  - `P4` — routine (dripping tap, installs, quotes)
  - `asks_for_owner` — the caller asks for you by name
- Out of hours, only `P1` and `P2` are allowed; everything else becomes a message and call-back.
- Example:
  ```yaml
  transfer_rules:
    in_hours: [P1, P2, asks_for_owner]
    out_of_hours: [P1]
  ```
- Required: yes (either list may be empty).

**5.4 `alert_sms_number` — Which mobile should get text alerts about new enquiries and emergencies?**

- Format: E.164 mobile number.
- Example: `+447700900123`
- Required: yes.

**5.5 `callback_promise` — What can she promise about call-backs?**

- Format: one approved sentence.
- Example: `Dave will ring you back within 2 hours during working hours.`
- Required: yes.
- Help: Only promise what you'll actually do on a busy day. Callers will hold you to it.

### 6. Bookings

**6.1 `booking_mode` — How should she book jobs?**

- Format: one of `ghl_calendar`, `synced_calendar`, `request_mode`.
  (`external` exists in the schema but is rejected in V1.)
- Example: `ghl_calendar`
- Required: yes.
- Help — pick the first that fits:
  1. You use a job system (ServiceM8, Jobber, Tradify…) → `request_mode` for now.
  2. You live in Google Calendar or Outlook → `synced_calendar`.
  3. You're happy to use the calendar in our app → `ghl_calendar`.
  4. Otherwise → `request_mode`: she takes two times that suit the customer and texts you to
     confirm; nothing is booked until you reply.

**6.2 `appointment_types` — What kinds of visit should she book, and how long is each?**

- Format: list of `{ code, duration_minutes }`. Code: lowercase letters, digits and `_`, starting
  with a letter, 2–40 characters, unique. Duration: 15–480 minutes.
- Example: `[{ code: assessment, duration_minutes: 60 }, { code: small_repair, duration_minutes: 90 }]`
- Required: at least one when `booking_mode` is `ghl_calendar` or `synced_calendar`.
- Help: Installs and unclear jobs are always booked as a visit to look first.

**6.3 `min_booking_notice_minutes` — How much notice do you need before a booked visit?**

- Format: whole minutes, 0–10080 (one week).
- Example: `120`
- Required: no (defaults to 0).

**6.4 `cancellation_policy` — What's your cancellation policy, if any?**

- Format: one approved sentence.
- Example: `We ask for 24 hours' notice to cancel, please.`
- Required: no. If blank, she says there's no set policy.

### 7. Knowledge base

Separate from this form: FAQs, policies and service descriptions go into the knowledge base
using [knowledge-base-template.md](knowledge-base-template.md). The resulting GHL ids go in
`knowledge_base_ids` (Part A).

---

## Checks the validator applies (so you can catch them on the call)

- A job can't be both offered and not offered.
- Gas jobs need `gas_safe_registered: true`.
- Every `service_area` entry must be a valid district, range (same area, low to high) or area.
- `extended` cover needs `extended_hours`.
- Backup transfer number must differ from the primary.
- Out-of-hours transfer triggers: `P1`/`P2` only.
- Calendar booking modes need `calendar_id` and at least one appointment type.
- Approved sentences: 1–240 characters, no `{ } < >`.
- Unknown keys are rejected (the schema is strict) — check spelling.

## From answers to config

1. Copy the DEMO file: `cp config/clients/demo.yaml config/clients/<client>.yaml`
   (`<client>` = the `client_id`).
2. Replace every value with the client's answers, one key per question above. Delete optional
   keys the client left blank rather than leaving them empty.
3. Validate:
   ```
   npm run validate:config
   ```
   or just this file: `npm run validate:config -- config/clients/<client>.yaml`.
   Each problem is printed as `FAIL <file>` followed by the key and the reason. Fix and re-run
   until it prints `ok`.
4. Build the prompt to check the greeting fits and the wording lints cleanly:
   ```
   npm run prompt:build
   ```
   Read `build/prompts/<client_id>/greeting.txt` and `prompt.md` back to yourself out loud.
5. Commit the YAML through a reviewed change (decision D3: config changes go through Git, not
   the GHL screen). Then continue with [runbook.md](runbook.md).
