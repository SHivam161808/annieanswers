# GHL capability spike (Phase 0)

Verification of the GHL capabilities V1–V15 listed in the implementation plan. Each item is marked
**verified** only when exercised in our own account; documentation alone is marked **documented**.

Account: AnnieAnswers sub-account (used as MASTER-DEV). Timezone `Europe/London`, country `GB`.
Token: sub-account Private Integration token, stored in `.env` (never committed).
Probe: `npx tsx tools/spike/probe.ts` (GET-only; records structure, status, latency — no contact data).

## Step 1 — read-only probe (2026-10-07)

| Endpoint                                  | Version header | Result            | Latency (from India) |
| ----------------------------------------- | -------------- | ----------------- | -------------------- |
| `GET /locations/{id}`                     | 2021-07-28     | 200               | 579 ms               |
| `GET /voice-ai/agents`                    | v3             | 200 — 0 agents    | 401 ms               |
| `GET /voice-ai/dashboard/call-logs`       | v3             | 200 — 0 calls     | 409 ms               |
| `GET /locations/{id}/customValues`        | 2021-07-28     | 200 — 0 values    | 409 ms               |
| `GET /locations/{id}/customFields`        | 2021-07-28     | 200 — 0 fields    | 409 ms               |
| `GET /calendars/`                         | 2021-04-15     | 200 — 0 calendars | 358 ms               |
| `GET /workflows/`                         | 2021-07-28     | 200 — 0 workflows | 339 ms               |
| `GET /opportunities/pipelines`            | 2021-07-28     | 200 — 1 pipeline  | 330 ms               |
| `GET /contacts/`                          | 2021-07-28     | 200               | 367 ms               |
| `GET /phone-system/numbers/location/{id}` | 2021-07-28     | 200 — 0 numbers   | 692 ms               |

Token scope lessons: an agency-level token cannot read sub-account data ("does not have access to
this location"); Voice AI, Locations and Phone Numbers need their own scopes on the sub-account token.

The sub-account is empty: no agent, no calls, no UK number, no calendar, no fields, no workflows.

## Findings so far

| Item                                                           | Status                        | Evidence                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voice AI public API reachable with a Private Integration token | **verified**                  | agents and call-logs endpoints return 200 (Version `v3`)                                                                                                                                                                                                                          |
| V8 per-utterance timestamps in call logs                       | **documented: not available** | API docs show transcript as `bot:` / `human:` text; only actions carry `triggerReceivedAt` / `executedAt`. Confirm on the first real call. If confirmed, turn latency comes from the phone harness (Phase 6), and action latency from action timestamps plus our middleware logs. |
| V1–V7, V9–V15                                                  | pending                       | need an agent, a custom action and a UK number (step 2)                                                                                                                                                                                                                           |

## Step 2 — demo agent and live testing (2026-10-07 → 2026-10-12)

Provisioned by `tools/demo/provision.ts` (idempotent; ids in `build/demo/state.json`): demo calendar,
14 L3 custom values, Voice AI agent "DEMO – Smith and Sons" (rendered prompt), custom actions
`call_context`, `check_service_area`, `escalation`, native `book_appointment`. UK number
+44 117 463 3467 (UK KYC linked, Individual bundle) attached via `PATCH /voice-ai/agents/{id}`
`{ inboundNumber }`; agent answers directly (`isAgentAsBackupDisabled: true`).

| Finding                                                                                                                                                                                                  | Status                                        | Evidence / consequence                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent runtime model is selectable; demo agent runs **GPT-4.1**                                                                                                                                           | **verified** (UI)                             | Resolves D19: offline simulation must use GPT-4.1                                                                                                                      |
| API `language` enum has `en-US` but no `en-GB`                                                                                                                                                           | **documented**                                | British voice chosen in UI; UK phrasing comes from the prompt                                                                                                          |
| Agent object has undocumented fields `responsiveness`, `toolCallStrictMode`, `endCallConfig`, `spamConfig`, `prompts`, `disabledPrompts`                                                                 | **verified**                                  | Candidates for latency/turn-taking tuning (Phase 6)                                                                                                                    |
| Custom actions created via API **with `headers` or `parameters`** are stored but cannot be read or updated (`400 Maximum call stack size exceeded`); the create itself also reports 400 while succeeding | **verified** (bisected)                       | Auth via `authenticationRequired`/`authenticationValue`; location id in the URL query; caller parameters added in the UI; provisioning never PUTs an unreadable action |
| GHL can report failure for a write that succeeded                                                                                                                                                        | **verified**                                  | Every GHL write is confirmed by reading back (same rule as booking safety)                                                                                             |
| `authenticationValue` arrives as `Authorization: <value>`                                                                                                                                                | **verified**                                  | Middleware accepts bare and Bearer forms                                                                                                                               |
| Custom action requests are `application/x-www-form-urlencoded`                                                                                                                                           | **verified**                                  | Middleware parses form bodies                                                                                                                                          |
| **POST custom action responses are not used by the agent**: middleware answered "postcode not recognised", agent said "we cover that area"                                                               | **verified — critical**                       | Actions switched to GET with `selectedPaths` (spec: response paths only for GET). Re-test pending with parameters present                                              |
| Parameters were missing from the first live calls (`params: []`, escalation 400 `validation_failed`)                                                                                                     | **verified**                                  | Parameters must be added in the UI; confirmed present (read-back now hits the bug above)                                                                               |
| `APPOINTMENT_BOOKING` accepts `daysOfOfferingDates` ≤ 3 only (5 and 7 rejected, 422)                                                                                                                     | **verified**                                  | Agent offers at most 3 days ahead                                                                                                                                      |
| Native booking: offered real calendar slots and booked (Thu 8 Oct 09:00)                                                                                                                                 | **verified** (web call)                       | V4 book path works; reschedule/cancel still to test                                                                                                                    |
| Agent read the caller's email from the GHL contact record during the call                                                                                                                                | **verified**                                  | Contact data is available to the agent; PII rules for spoken read-back to review                                                                                       |
| Action latency from call-log timestamps (`executedAt − triggerReceivedAt`): custom 517–2183 ms, booking 1187–1407 ms; our server 1.4–26 ms                                                               | **measured** (3 web calls, tunnel from India) | GHL overhead dominates; re-measure from UK hosting                                                                                                                     |
| Call log has no per-utterance timestamps; transcript is `human:` / `bot:` text                                                                                                                           | **verified**                                  | V8 confirmed: turn latency must come from the phone harness                                                                                                            |

## Next

1. Real phone call to +44 117 463 3467: confirm parameters arrive (server logs `param_keys`) and the
   agent obeys "not covered" for M1 1AE.
2. Transfer (needs a real mobile as `transfer_number_primary`), reschedule/cancel, post-call outcome.
3. UK hosting for the middleware (currently laptop + ngrok static domain).
