# GHL workflows WF-01 … WF-13 — build guide

GHL has no API to create workflows, pipelines or snapshots, so these are built by hand in the
GHL screen **once, in the master sub-account**, then shipped to every client in the snapshot.
Everything else (fields, values, agent, actions) is created by `tools/demo/provision.ts`.

After building, run:

```
npx tsx tools/ghl/link-workflows.ts    # attaches WF-01 to the agent's call end, WF-06 as a mid-call action
npx tsx tools/ghl/test-workflows.ts    # automated end-to-end test of the router (tags + pipeline stage)
```

## Conventions

- **Name every workflow exactly** `WF-01 Outcome router`, `WF-02 Booking confirmation`, … — the
  tools find them by the `WF-xx` prefix.
- **Publish** each workflow (draft workflows don't run).
- SMS bodies come from [`ghl/sms-templates.yaml`](../../ghl/sms-templates.yaml) — copy them
  exactly; they are tested for length, characters and merge fields.
- Owner messages use **Send Internal Notification → SMS → specific number**
  `{{custom_values.alert_sms_number}}`, never "Send SMS" (which texts the caller).
- Items marked ⚠ are GHL screen names to confirm; tell the developer if the screen differs.

## Before the workflows: pipeline (2 minutes)

**Opportunities → Pipelines → Create pipeline** `AI Receptionist Enquiries` with stages, in order:
`Booked`, `Awaiting confirmation`, `Callback needed`, `Emergency`, `Lost or cancelled`
(names must match `src/core/outcome.ts`).

---

## WF-01 Outcome router (the important one)

Started by the agent at the end of every call (`link-workflows.ts` adds it to the agent's
call-end workflows). No trigger needed in the builder.

1. **Wait** 2 minutes — lets post-call extraction write `ai_call_outcome`.
2. **Update contact field** `ai_last_call_at` = current date/time ⚠ (date picker "now"/`{{right_now}}`).
3. **Math operation** ⚠ on `ai_call_count`: add 1.
4. **Add tag** `ai-call`.
5. **If/Else** on contact field `ai_call_outcome` — one branch per code below:

| Code                     | Tag                             | Pipeline stage (AI Receptionist Enquiries)                 | Then                                                      |
| ------------------------ | ------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| BOOKED                   | `outcome-booked`                | Booked                                                     | Add to WF-05                                              |
| BOOKING_REQUESTED        | `outcome-booking-requested`     | Awaiting confirmation                                      | Add to WF-05, WF-07                                       |
| RESCHEDULED              | `outcome-rescheduled`           | Booked                                                     | — (WF-04 runs on the appointment change)                  |
| CANCELLED                | `outcome-cancelled`             | Lost or cancelled                                          | — (WF-04)                                                 |
| EMERGENCY_TRANSFERRED    | `outcome-emergency-transferred` | Emergency                                                  | —                                                         |
| EMERGENCY_ALERTED        | `outcome-emergency-alerted`     | Emergency                                                  | Add to WF-06 (if not already alerted mid-call)            |
| TRANSFERRED              | `outcome-transferred`           | Callback needed                                            | —                                                         |
| CALLBACK_REQUESTED       | `outcome-callback-requested`    | Callback needed                                            | Add to WF-05, WF-08                                       |
| MESSAGE_TAKEN            | `outcome-message-taken`         | Callback needed                                            | Add to WF-05                                              |
| INFO_ONLY                | `outcome-info-only`             | —                                                          | —                                                         |
| OUT_OF_AREA              | `outcome-out-of-area`           | —                                                          | —                                                         |
| OUT_OF_SCOPE             | `outcome-out-of-scope`          | —                                                          | —                                                         |
| NON_CUSTOMER             | `outcome-non-customer`          | —                                                          | Add to WF-10                                              |
| ABANDONED                | `outcome-abandoned`             | Callback needed **only if the contact has a phone number** | —                                                         |
| TECH_FAILURE             | `outcome-tech-failure`          | Callback needed                                            | Add to WF-11                                              |
| _(None / anything else)_ | `outcome-missing`               | Callback needed                                            | Internal notification to the team (outcome missing = bug) |

"Pipeline stage" = **Create/Update Opportunity** in pipeline `AI Receptionist Enquiries`, stage as
listed, opportunity name `{{contact.name}} – {{contact.ai_issue_type}}`.

## WF-02 Booking confirmation

- Trigger: **Appointment Status** = booked/confirmed, calendar = the client's booking calendar ⚠.
- Send SMS `booking_confirm_customer`.
- Internal notification SMS to `{{custom_values.alert_sms_number}}`: `booking_confirm_owner`.

## WF-03 Reminders

- Trigger: **Appointment Status** = booked/confirmed.
- Wait until **18:00 the day before** the appointment ⚠ → Send SMS `reminder_day_before`.
- Wait until **07:30 on the day** → Send SMS `reminder_morning`.
- Add an exit condition: appointment cancelled.

## WF-04 Reschedule and cancel confirmation

- Trigger: **Appointment Status** = rescheduled / cancelled.
- Rescheduled → Send SMS `rescheduled_customer`; cancelled → `cancelled_customer`.
- Internal notification SMS: `rescheduled_cancelled_owner`.

## WF-05 Owner enquiry alert

- Started by WF-01.
- Internal notification SMS: `enquiry_alert_owner`.

## WF-06 Emergency escalation

- Started by the agent **during the call** (`alert_owner_urgent` action, added by
  `link-workflows.ts`) and by WF-01 for `EMERGENCY_ALERTED`.
- Internal notification SMS: `emergency_alert_owner` to `{{custom_values.alert_sms_number}}`.
- **Call** ⚠ / internal call notification to `{{custom_values.transfer_number_primary}}`.
- Wait 3 minutes → if no response ⚠, repeat SMS once, then SMS + call
  `{{custom_values.transfer_number_backup}}` (skip if empty).
- Internal notification to the team channel.

## WF-07 Request-mode confirmation

- Started by WF-01 for `BOOKING_REQUESTED`.
- Internal notification SMS: `request_mode_owner`.
- Wait for reply ⚠ up to 60 minutes → no reply: `request_mode_reminder_owner`.
- Owner replies **YES** → Send SMS `request_mode_confirmed_customer`.
- ⚠ Open question (spike V14): how GHL ties the owner's YES reply back to the right customer.
  Until confirmed, the owner confirms by ringing/texting the customer from the GHL app.

## WF-08 Callback deadline

- Started by WF-01 for `CALLBACK_REQUESTED`.
- **Create task** for the owner: "Ring back {{contact.first_name}} — {{contact.ai_issue_summary}}", due per `callback_promise`.
- Wait until 30 minutes before due → internal notification reminder.

## WF-09 Missed transfer

- Started when a transfer fails (to wire up after the transfer test; see readiness B1).
- Internal notification SMS: `missed_transfer_owner`.

## WF-10 Non-customer

- Started by WF-01 for `NON_CUSTOMER`. Tag `non-customer` only. **No owner alert.**

## WF-11 Agent failure fallback

- Trigger: **Call Status** ⚠ = missed / no answer / failed on the GHL number, or started by WF-01 for `TECH_FAILURE`.
- Send SMS `missed_call_textback_customer`.
- Internal notification SMS + team alert.

## WF-12 Daily digest

- Trigger: **Scheduler** ⚠ daily 18:00 Europe/London.
- Counts (calls, bookings, callbacks due) are not available inside a workflow; the digest content
  will be produced by the middleware (Phase 5). Build the trigger only when that exists.

## WF-13 Customer SMS replies

- Trigger: **Customer Replied**, channel SMS.
- Internal notification SMS: `inbound_reply_forward_owner`.
