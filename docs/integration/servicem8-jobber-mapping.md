# T4 external system mapping — ServiceM8 (primary), Jobber (comparison) (T-805)

Status: **design only. Tier T4 is not built in V1** (Build Plan scope; decision D6 —
`booking_mode: external` is rejected by the V1 config validator). This is the "one mapping
document" the Build Plan asks for (FR-23). Nothing here has been tested against a live ServiceM8
or Jobber account. Anything marked **⚠ verify** is unconfirmed.

Date: 2026-10-13. Read with [V1_IMPLEMENTATION_PLAN.md](../V1_IMPLEMENTATION_PLAN.md) §4–5
(booking contract, middleware rules, failure matrix) and [architecture.md](../architecture.md).

---

## 1. Where the adapter sits

```
Caller ─► GHL Voice AI agent ── custom action (≤ 2 s) ──► annie-api /v1/actions/booking/*   (UK region)
                                                              │  booking contract (5 ops)
                                                              ├─ ghl-calendar adapter   (T1/T2 fallback, if built)
                                                              ├─ request-mode adapter   (T3)
                                                              └─ servicem8 adapter      (T4, this document)
                                                                     │ HTTPS, OAuth 2.0 / API key
                                                                     ▼
                                                              ServiceM8 REST API  (api.servicem8.com/api_1.0)
GHL stays the record of the call (contact, outcome code, transcript); ServiceM8 becomes the
system of record for the job and the visit (Build Plan tier table).
```

Rules inherited unchanged from the Build Plan / plan §5:

- The prompt never changes when a client moves to T4: the agent calls the same five operations.
- Each call answers within 2 s; on any error/timeout the adapter returns
  `status: "unavailable"` and the agent switches to request mode. It never says a job is booked
  unless the adapter returned a confirmed booking.
- The GHL call id is the idempotency key.
- Logs hold ids, status, latency and error codes; never caller PII.

Note on GHL action method: decision D24 makes custom actions **GET** (GHL only passes response
fields to the agent for GET). Mutating operations (`create_booking`, `reschedule_booking`,
`cancel_booking`) over GET are acceptable only because they are idempotent on the call id, but
caller data would sit in the URL query string (see GDPR pack §2.2). **⚠ verify** whether GHL
POST actions can now return data to the agent before building T4.

### 1.1 Fit with the code being written now

At the time of writing, an uncommitted `src/booking/contract.ts` defines a `BookingAdapter`
interface (`checkAvailability(calendarId, fromIso, days, max)`, `findBookings`,
`rescheduleBooking`, `cancelBooking`) with result statuses `found` / `not_found` /
`needs_phone` / `needs_verification` / `not_verified` and `rescheduled` / `cancelled` /
`slot_taken` / `not_found`, plus action-level `unavailable` and `request_mode`
(`src/actions/booking.ts`). Bookings are identified by an opaque `ref`. For T4 this means:

- **`create_booking` must be added to the interface.** T1/T2 keep GHL's native booking action,
  which cannot write to ServiceM8, so a T4 adapter needs its own create operation.
- `calendarId` is GHL-specific; a T4 adapter would ignore it and read its ServiceM8 settings
  (staff, categories) from the client config. Consider a client-level adapter context instead.
- The statuses below are written to match those names so the prompt does not change. If the
  interface changes before T4 is built, this section is the one to update.
- Reschedule idempotency in that draft keys on `(location, ref, slot)`, not the call id; that is
  also correct for ServiceM8 (same target state).

---

## 2. ServiceM8 basics

| Item                    | ServiceM8                                                                                                                                                                                                                                                                                                                                             | Source / status                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| API style               | REST + JSON                                                                                                                                                                                                                                                                                                                                           | official docs                                                                                                                                  |
| Base URL                | `https://api.servicem8.com/api_1.0`                                                                                                                                                                                                                                                                                                                   | official docs (create job page)                                                                                                                |
| Auth — single account   | **API key** in `X-API-Key` header ("private application"; generated in Settings → API Keys; suits one customer's own account; no user impersonation)                                                                                                                                                                                                  | official docs                                                                                                                                  |
| Auth — many accounts    | **OAuth 2.0** "public application" (requires registering as a ServiceM8 Development Partner). Authorize `https://go.servicem8.com/oauth/authorize`; token `https://go.servicem8.com/oauth/access_token`; grants `authorization_code`, `refresh_token`; access token lifetime 3600 s; **each refresh returns a new refresh token** that must be stored | official docs                                                                                                                                  |
| Scopes we would request | `read_jobs`, `manage_jobs`, `create_jobs`, `read_customers`, `manage_customers`, `read_customer_contacts`, `manage_customer_contacts`, `read_schedule`, `manage_schedule`, `read_job_notes`, `publish_job_notes` (and possibly `manage_job_contacts`)                                                                                                 | official docs. ServiceM8 says broader scopes can mean lower rate limits; `create_jobs` "may incur account charges" **⚠ verify cost to client** |
| Rate limits             | **180 requests/minute and 20,000 requests/day, per application + account**; HTTP 429 with body "Number of allowed API requests per minute exceeded"                                                                                                                                                                                                   | official docs (HTTP response codes page). Whether the daily limit is rolling or resets at midnight: **⚠ verify**                               |
| Other status codes      | 400 validation, 401 bad credentials/token, 402 account has unpaid invoices, 403 missing scope, 404, 426 HTTPS required, 500, 503 retry later                                                                                                                                                                                                          | official docs                                                                                                                                  |
| Record ids              | UUIDs. On create **the caller may supply its own `uuid`**; otherwise the new id is returned in the `x-record-uuid` response header. Success body is just `{"errorCode":"0","message":"OK"}`                                                                                                                                                           | official docs                                                                                                                                  |
| Update                  | `POST /{object}/{uuid}.json`                                                                                                                                                                                                                                                                                                                          | official docs; partial-update semantics **⚠ verify** (Job update schema lists `status` as required)                                            |
| Delete                  | `DELETE /{object}/{uuid}.json` = **soft delete** (`active` → 0, restorable)                                                                                                                                                                                                                                                                           | official docs (Job)                                                                                                                            |
| Filtering               | `?$filter=field op value`; operators `eq`, `ne`, `gt`, `lt` only (no `ge`/`le`); combine with `and` only, max 10 conditions; no `or`/grouping; strings in single quotes; values ≤ 255 chars; field names case-sensitive                                                                                                                               | official docs                                                                                                                                  |
| Timestamps              | `YYYY-MM-DD HH:MM:SS`; most timestamps are in the **account's local time zone**, webhook timestamps in UTC                                                                                                                                                                                                                                            | official docs (webhooks page). Confirm account is set to Europe/London and DST behaviour **⚠ verify**                                          |
| Webhooks                | Object subscriptions (e.g. `job` + fields); payload has object type, changed field names, uuid, `resource_url` — **not** the values; challenge handshake on subscribe; failed deliveries retried up to 72 h; no payload signing described                                                                                                             | official docs                                                                                                                                  |
| Data location           | ServiceM8 hosting region **⚠ verify** (needed for the client's GDPR transfer record)                                                                                                                                                                                                                                                                  | not checked                                                                                                                                    |

---

## 3. Booking contract → ServiceM8

Contract operations and their inputs/outputs are from the Build Plan "Booking interface
contract". ServiceM8 objects: **Company** (client), **CompanyContact** (person), **Job**,
**JobActivity** (a scheduled visit: `job_uuid`, `staff_uuid`, `start_date`, `end_date`,
`activity_was_scheduled`), **Note**, **Category**, **Staff**, **Allocation Window**,
**Availability**.

Proposed identity: our `booking_id` (the contract's opaque `ref`) = the **JobActivity uuid** (the visit). The Job uuid is
returned alongside for notes and status. **⚠ decision** — alternative is Job uuid if the client
schedules visits by hand.

### 3.1 `check_availability(job_type, urgency, date_from, date_to)` → up to 3 slots

ServiceM8 has no documented "free slots for a job type" endpoint that we found. Proposal:

1. Working windows come from **our** config (`opening_hours`, `closed_dates`,
   `min_booking_notice_minutes`, `appointment_types[].duration_minutes`) — same as T1/T2.
2. Busy time comes from ServiceM8:
   `GET /jobactivity.json?$filter=staff_uuid eq '<uuid>' and start_date gt '<from>' and start_date lt '<to>' and active eq 1`
   per bookable staff member (staff list = new per-client config, see §7). Whether `start_date`
   supports `gt`/`lt` filtering **⚠ verify**.
3. Optionally intersect with **Availability** records (`GET /availability.json`, fields
   `availability_type`, `start_timestamp`, `end_timestamp`, `regarding_object_uuid`) — the docs
   do not say whether these represent staff leave/working time **⚠ verify**.
4. Optionally snap slots to **Allocation Windows** (named arrival windows) so the agent offers
   windows, not exact times — fits L0 "no arrival guarantees". Semantics **⚠ verify**.
5. Urgency: P1/P2 never go through `check_availability` (escalation path); P3 earliest slots;
   P4 normal.

Latency: one request per staff member. To stay inside 2 s, keep a **short-lived cache** of busy
blocks per account (TTL ~60 s, refreshed by a `jobactivity` webhook — the webhook only says
_something_ changed, so we re-fetch). Cache holds times and staff ids only, no caller PII.
Every offered slot is re-checked inside `create_booking`.

Output: `[{ slot_id, start, end, staff_uuid? }]` (max 3; staff never spoken). `slot_id` is an
opaque token (hash of start/end/staff) so the agent cannot invent one.

### 3.2 `create_booking(contact, job_type, slot, address, notes)` → booking_id, confirmed slot

Sequence (each POST with a **deterministic uuid**, §5):

| #   | Call                                                                                                                                                                                                    | Purpose                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /companycontact.json?$filter=mobile eq '<number>'` (and/or `phone eq`, `email eq`)                                                                                                                 | Find existing client. Number format in ServiceM8 is free text — exact match only, try the two UK formats (`07700 900123`, `+447700900123`) as separate requests (no `or`). **⚠ verify** stored formats on a real account. |
| 2   | If none: `POST /company.json` (`uuid`, `name`, `address`) then `POST /companycontact.json` (`uuid`, `company_uuid`, `first`, `last`, `mobile`/`phone`, `email`, `type: 'JOB'`, `is_primary_contact: 1`) | Create client. `is_individual` is read-only (set by ServiceM8).                                                                                                                                                           |
| 3   | `POST /job.json` (`uuid`, `status: 'Work Order'`, `company_uuid`, `job_address`, `job_description`, `category_uuid`)                                                                                    | Create the job. `status` allowed values: `Quote`, `Work Order`, `Unsuccessful`, `Completed`. Quote requests → `Quote`.                                                                                                    |
| 4   | Re-check the slot is still free (busy query for that staff/time)                                                                                                                                        | Avoid double-booking a visit created by the office since `check_availability`.                                                                                                                                            |
| 5   | `POST /jobactivity.json` (`uuid`, `job_uuid`, `staff_uuid`, `start_date`, `end_date`, `activity_was_scheduled: '1'`)                                                                                    | Book the visit. Flags are strings in the schema.                                                                                                                                                                          |
| 6   | `POST /note.json` (`uuid`, `related_object: 'job'` **⚠ verify value**, `related_object_uuid`, `note`)                                                                                                   | Engineer notes + access notes + source/call id. Can be done after the response (not on the critical path).                                                                                                                |
| 7   | Read back the JobActivity (`GET /jobactivity/{uuid}.json`)                                                                                                                                              | **Only return `confirmed` after reading the visit back** (same rule as D26: confirm every write by reading back).                                                                                                         |

That is 5–7 requests in sequence for a new client. Plan §5 budget is 1.8 s hard deadline; GHL's
own action overhead was measured at 0.5–2.2 s (docs/ghl-capabilities.md). **This probably does
not fit synchronously ⚠ verify by measurement.** Options, in order of preference:

- a. Do steps 1–5 + 7 in the call, note (6) after responding; measure p95 from UK hosting.
- b. If the budget is exceeded: return `status: "unavailable"` at the deadline (agent goes to
  request mode), **but let the in-flight writes finish**. Because ids are deterministic, the
  reconciler can find the visit afterwards and tell the owner/customer by SMS ("booked after
  all for Tue 9–12") instead of creating a second one. Never let the caller hear "booked" for a
  visit we did not read back.

Output: `{ status: "confirmed", ref: <jobactivity uuid>, job_id: <job uuid>, start, end }`
or `{ status: "unavailable" | "slot_taken" }` (`ref` = the contract's opaque booking reference).

### 3.3 `find_booking(phone; name or postcode to verify)` → matching bookings

1. CompanyContact by `mobile eq` / `phone eq` (as above) → `company_uuid`.
2. `GET /job.json?$filter=company_uuid eq '<uuid>' and status eq 'Work Order' and active eq 1`.
3. For each job, `GET /jobactivity.json?$filter=job_uuid eq '<uuid>' and active eq 1` and keep
   future scheduled activities.
4. **Verification:** surname must match `CompanyContact.last`, or postcode must match the job's
   `geo_postcode` (geocoded) / end of `job_address`. No phone → `needs_phone`; no name/postcode →
   `needs_verification`; mismatch → `not_verified` (never reveal a booking to an unverified
   caller); nothing found → `not_found`.

Output: `[{ booking_id, start, end, job_type_label }]` — no addresses or staff names spoken.
Cost: 3+ requests; acceptable for a read path, cacheable for the call duration.

### 3.4 `reschedule_booking(booking_id, new_slot)` → confirmed slot

1. Re-check the new slot is free for that staff member.
2. `POST /jobactivity/{booking_id}.json` with new `start_date`, `end_date` (keep `staff_uuid`).
   Partial update semantics **⚠ verify**.
3. Read back; only then return `confirmed`.
4. Note on the job: "Rescheduled by AI receptionist from X to Y (GHL call <id>)".

Alternative if the client prefers history: soft-delete the old JobActivity and create a new one
(new deterministic uuid) — **⚠ decision per client**.

### 3.5 `cancel_booking(booking_id, reason)` → status

1. `DELETE /jobactivity/{booking_id}.json` (soft delete, restorable) — removes the visit from the
   schedule. Whether DELETE is documented for JobActivity the same way as Job **⚠ verify**
   (endpoint is listed in the reference index).
2. Job status: leave as `Work Order` (owner decides) **or** set `Unsuccessful` — **⚠ decision
   per client**; default proposal: leave the job, add a note, alert the owner (WF-04), because a
   cancelled visit is not always a lost job.
3. Note with the caller's reason.

Output: `{ status: "cancelled", ref }` only after the read-back shows `active = 0`; unknown ref → `not_found`.

---

## 4. CRM sync interface (V2) → ServiceM8

| Operation        | ServiceM8 mapping                                                                                                                                                                                        | Notes                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `upsert_contact` | Find CompanyContact by phone/email → update; else create Company + CompanyContact (as 3.2 step 2)                                                                                                        | Deterministic uuid on create. Company `name` for a private person = "First Last"; ServiceM8 decides `is_individual`.                                   |
| `create_enquiry` | Job with `status: 'Quote'` (or `Work Order` when booked) + category + description; **alternative:** an **Inbox message** (`createinboxmessage`, later "Convert message to job") so the office triages it | Inbox endpoint semantics and scopes **⚠ verify**; Inbox may suit request-mode and message-taking outcomes better than creating jobs that never happen. |
| `append_note`    | `POST /note.json` on the job (`related_object`, `related_object_uuid`, `note`)                                                                                                                           | Used for `ai_job_notes`, `access_notes`, transcript summary. Never the full transcript.                                                                |
| `set_outcome`    | Outcome → Note text always; plus status change where it maps cleanly                                                                                                                                     | See table below. Badges (`badges` JSON array of Badge uuids) could tag "AI booked" **⚠ verify** usefulness.                                            |

Outcome → ServiceM8 (proposal):

| Our outcome code                                                                        | ServiceM8 action                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `BOOKED`, `RESCHEDULED`                                                                 | Job `Work Order` + scheduled JobActivity (already done by booking ops); note          |
| `BOOKING_REQUESTED`, `CALLBACK_REQUESTED`, `MESSAGE_TAKEN`                              | Inbox message or `Quote` job + note with `preferred_window`                           |
| `CANCELLED`                                                                             | as 3.5                                                                                |
| `EMERGENCY_TRANSFERRED`, `EMERGENCY_ALERTED`, `TRANSFERRED`                             | Job + note "urgent P1/P2"; GHL still does the alerting (WF-06)                        |
| `INFO_ONLY`, `OUT_OF_AREA`, `OUT_OF_SCOPE`, `NON_CUSTOMER`, `ABANDONED`, `TECH_FAILURE` | **Nothing written to ServiceM8** (stays in GHL only — minimisation, and no junk jobs) |

---

## 5. Idempotency (GHL call id)

Two layers:

1. **Middleware (as T1–T3):** Redis key `(location_id, ghl_call_id, operation)`; same payload →
   stored result, different payload → 422 (D11). Locks fail closed for booking (D10).
2. **ServiceM8 itself:** generate each record's `uuid` deterministically as a **UUID v5** of
   `(location_id, ghl_call_id, operation, object_type)`. A retried request then targets the same
   record instead of creating a second job. What ServiceM8 does when a create is POSTed with a
   uuid that already exists (update vs error) **⚠ verify** — either is fine as long as it never
   creates a duplicate. This also lets the reconciler find writes that completed after we gave up
   (3.2 option b).

Reschedule/cancel are idempotent by nature (same target state). Notes use the same v5 scheme so
a retry does not post the note twice.

The Redis idempotency result for booking ops may contain booking times; keep TTL at 24 h and no
caller names/addresses in the stored body (GDPR pack §2.2).

---

## 6. Rate limits, timeouts and failure → request mode

Budget per client account: 180/min, 20,000/day. Rough use per booked call: availability (cached)
0–3, create 5–7, notes 1–2 → ~10 requests. A busy plumber at 40 calls/day uses well under 1 % of
the daily limit; the per-minute limit only matters for bulk sync, which V2 must throttle
(token bucket per ServiceM8 account in Redis, like the GHL bucket in plan §5). Webhook deliveries
reportedly count against the same daily quota **⚠ verify** (third-party source only).

| Failure                                                    | Adapter behaviour                                                                                                          | Caller hears                                                      | Log / alert                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| Timeout (per request 800 ms proposal; hard deadline 1.8 s) | `status: "unavailable"` → request mode; let in-flight writes finish; reconciler checks                                     | "I'll take your preferred times and {owner} will confirm by text" | `booking_unavailable`, alert if > 5 % / 15 min    |
| 429                                                        | No retry inside the call; request mode. Post-call work honours back-off                                                    | as above                                                          | `rate_limited`                                    |
| 401 (token expired/revoked)                                | One refresh attempt **only if** budget allows, else request mode; if refresh fails → mark account disconnected, alert team | as above                                                          | `external_auth_failed`, alert immediately         |
| 402 (client's ServiceM8 unpaid)                            | request mode for all calls until cleared                                                                                   | as above                                                          | alert team + client                               |
| 403 (missing scope)                                        | request mode                                                                                                               | as above                                                          | config alert, blocks onboarding                   |
| 400 (validation)                                           | request mode; never retry same payload                                                                                     | as above                                                          | `external_validation_failed` with field name only |
| 5xx / 503                                                  | 1 retry if budget > 600 ms, jittered; else request mode                                                                    | as above                                                          | as timeout                                        |
| Slot taken between check and create                        | `slot_taken` → agent offers the next slot once, then request mode                                                          | "That time's just gone — I can do …"                              | metric                                            |
| Middleware down                                            | GHL action timeout → agent continues natively → request mode                                                               | covered by "Let me just check the diary"                          | uptime alert                                      |

---

## 7. Field mapping — our contact fields → ServiceM8

Our fields: `config/schema/contact-fields.ts` plus GHL standard contact fields.

| Ours                               | ServiceM8 field                                                                                                    | Notes                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| first name / last name             | `CompanyContact.first` / `.last`; `Company.name` = "First Last" for individuals                                    |                                                                                                                                                                    |
| phone (E.164 from GHL)             | `CompanyContact.mobile` (07…) or `.phone` (landline)                                                               | Format to UK national grouping? **⚠ decision** — match what the client's office already uses. Company create schema has no phone/email fields documented.          |
| email                              | `CompanyContact.email`                                                                                             |                                                                                                                                                                    |
| `job_address` + `job_postcode`     | `Job.job_address` (single string ≤ 500, e.g. "14 Cardigan Road, LS6 2AB"); also `Company.address` for a new client | We capture line 1 + postcode only (no town). ServiceM8 geocodes the address into `geo_*` fields; check `geo_is_valid` **⚠ verify** geocoding works without a town. |
| `ai_issue_type`                    | `Job.category_uuid` via a per-client map (job-type code → ServiceM8 Category)                                      | New config needed. Unmapped → no category + note.                                                                                                                  |
| `ai_urgency`                       | Prefix in `job_description` ("P2 – active leak") and/or a Badge                                                    | No native priority field found **⚠ verify**.                                                                                                                       |
| `ai_issue_summary`                 | `Job.job_description`                                                                                              |                                                                                                                                                                    |
| `ai_job_notes`                     | Note on the job                                                                                                    | Engineer-facing.                                                                                                                                                   |
| `access_notes`                     | Note on the job (separate note, "Access:")                                                                         | Security-sensitive; do not put in `job_description` if that appears on customer-facing documents **⚠ verify**                                                      |
| `property_type`, `caller_role`     | Appended to `job_description` ("Tenant, flat")                                                                     | Tenant/agent: landlord/agent billing details not captured by us — `billing_address` left empty (defaults to job address).                                          |
| `preferred_window`                 | Note (request mode / enquiry)                                                                                      |                                                                                                                                                                    |
| `in_service_area`                  | not sent                                                                                                           | Internal.                                                                                                                                                          |
| `ai_call_outcome`                  | `set_outcome` (§4)                                                                                                 |                                                                                                                                                                    |
| GHL contact id, GHL call id        | Note text "Source: AI receptionist, GHL call <id>"                                                                 | Do not overload `purchase_order_number` (customer-facing).                                                                                                         |
| `ai_last_call_at`, `ai_call_count` | not sent                                                                                                           | GHL only.                                                                                                                                                          |
| slot start/end                     | `JobActivity.start_date` / `end_date` (account local time)                                                         | Convert from Europe/London; DST boundary tests (25 Oct 2026) apply.                                                                                                |

New per-client configuration T4 would need (**not added** — V1 schema rejects `external`):
`external.system: servicem8`, credential reference (secret name, never the key in YAML),
`staff_uuids` bookable by the agent, `category_map` (job type → category uuid),
`allocation_window` usage on/off, cancel policy (keep job / mark Unsuccessful).

---

## 8. Jobber — short comparison

| Item            | Jobber                                                                                                                                                                                                                                                                                           | Status                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| API style       | **GraphQL**, single endpoint `POST https://api.getjobber.com/api/graphql`                                                                                                                                                                                                                        | official docs                                    |
| Versioning      | `X-JOBBER-GRAPHQL-VERSION` header (docs example `2025-04-16`; current version **⚠ verify**)                                                                                                                                                                                                      | official docs                                    |
| Auth            | OAuth 2.0; the approving admin is the resource owner; access = scopes set when the app was created. Authorize/token URLs `https://api.getjobber.com/oauth/authorize` / `https://api.getjobber.com/oauth/token` seen only in a community post **⚠ verify**. No API-key option found **⚠ verify**. | official docs + community                        |
| Rate limits     | Two limiters per app/account: 2,500 requests per 5 minutes (HTTP 429), and a **query-cost** leaky bucket (points per query). Point ceiling/restore rate **⚠ verify** (third party says 10,000 points)                                                                                            | official docs page (title/summary) + third party |
| Objects         | Client (`clientCreate` documented), Request (`requestCreate` — for enquiries/assessments **⚠ verify**), Job, Visit, Assessment **⚠ verify** names and inputs                                                                                                                                     | partly verified                                  |
| Mapping         | `upsert_contact` → Client; `create_enquiry` → Request; `create_booking` → Job + Visit (or Request + Assessment); `append_note` → note mutation **⚠ verify**; `find_booking` → clients query by phone **⚠ verify** search support                                                                 | design                                           |
| Idempotency     | No client-supplied ids found **⚠ verify** → rely on the Redis layer plus a lookup by a stored marker (custom field / note containing the GHL call id) before creating                                                                                                                            | weaker than ServiceM8                            |
| Mutation errors | Returned in `userErrors` in a 200 response, not as HTTP errors → adapter must treat non-empty `userErrors` as failure                                                                                                                                                                            | official example                                 |
| Latency         | One GraphQL mutation can carry nested input, so fewer round trips than ServiceM8 **⚠ verify**                                                                                                                                                                                                    | design                                           |

Why ServiceM8 first: REST with documented field schemas, caller-supplied uuids (clean
idempotency), API-key option for a single client (no partner programme needed for a pilot),
and simple published rate limits. Jobber is a reasonable second adapter once T4 exists.

---

## 9. Open questions

1. Can GHL custom actions return data to the agent on POST yet (D24)? Otherwise mutating calls go
   over GET with caller data in the query string.
2. ServiceM8: behaviour on POST with an existing `uuid` (update vs error)?
3. ServiceM8: does `$filter` support `gt`/`lt` on `start_date` for JobActivity? Max page size
   and pagination (`_start`/`_limit` reported by third parties) for schedule queries?
4. ServiceM8: what do Availability and Allocation Window records represent, and does the client
   use them? Is there any supported "free slots" API?
5. ServiceM8: account time zone handling and DST (Europe/London accounts).
6. ServiceM8: phone number storage format on real UK accounts (needed for exact-match lookup).
7. ServiceM8: does `create_jobs` add per-job charges to the client's plan?
8. ServiceM8: `related_object` value for job notes; DELETE semantics for JobActivity.
9. ServiceM8: data hosting region (client's transfer record) and whether the client's DPA with
   ServiceM8 covers our adapter acting on their behalf.
10. OAuth public app vs per-client API key: the agency serving many clients probably needs a
    public app (Development Partner). Refresh tokens rotate on every refresh, so we need durable
    token storage (Secret Manager with a write lock) — the middleware is otherwise stateless and
    Redis is not a durable store.
11. Can create_booking fit in the 2 s budget from UK hosting? (Measure before choosing 3.2 a/b.)
12. Should the agent offer arrival windows rather than exact times for T4 clients?
13. Jobber: current API version, query-cost numbers, Request/Assessment/Visit mutation inputs,
    phone search, any idempotency support.

---

## Sources

Checked 2026-10-13.

- ServiceM8 — Authentication (API key, OAuth endpoints, token lifetime, scopes): https://developer.servicem8.com/docs/authentication
- ServiceM8 — HTTP response codes (rate limits 180/min, 20,000/day): https://developer.servicem8.com/docs/http-response-codes
- ServiceM8 — Filtering: https://developer.servicem8.com/docs/filtering.md
- ServiceM8 — Webhooks overview: https://developer.servicem8.com/docs/webhooks-overview.md
- ServiceM8 — API reference index: https://developer.servicem8.com/reference and https://developer.servicem8.com/llms.txt
- ServiceM8 — Create Job: https://developer.servicem8.com/reference/createjobs
- ServiceM8 — Update Job: https://developer.servicem8.com/reference/updatejobs.md
- ServiceM8 — Delete Job: https://developer.servicem8.com/reference/deletejobs.md
- ServiceM8 — Create Job Activity: https://developer.servicem8.com/reference/createjobactivities.md
- ServiceM8 — List Availabilities: https://developer.servicem8.com/reference/listavailabilities.md
- ServiceM8 — Create Client: https://developer.servicem8.com/reference/createclients.md
- ServiceM8 — Create Company Contact: https://developer.servicem8.com/reference/createcompanycontacts.md
- ServiceM8 — Create Note: https://developer.servicem8.com/reference/createnotes.md
- ServiceM8 community — API request limit 180 per minute: https://community.servicem8.com/t/api-request-limit-180-per-minute/377
- Supergood API report card — ServiceM8 (third party; webhook quota, pagination): https://supergood.ai/api-report-card/servicem8
- Jobber Developer Center — API rate limits: https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits (page returned 403 to our fetch; content from search summary)
- Jobber Developer Center — Queries and mutations: https://developer.getjobber.com/docs/using_jobbers_api/api_queries_and_mutations/
- Jobber Developer Center — App authorization: https://developer.getjobber.com/docs/building_your_app/app_authorization
- Make community — Jobber GraphQL OAuth (third party, OAuth URLs): https://community.make.com/t/help-me-connect-graphql-based-api-via-the-oauth-2-0/24559
- Internal: `docs/V1_IMPLEMENTATION_PLAN.md`, `docs/architecture.md` (D6, D10, D11, D24, D26), `docs/ghl-capabilities.md`, `config/schema/business-config.ts`, `config/schema/contact-fields.ts`, Build Plan PDF (tier table, booking interface contract).
