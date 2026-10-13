# Architecture and decision log

Companion to [V1_IMPLEMENTATION_PLAN.md](V1_IMPLEMENTATION_PLAN.md). Records what is built and every
decision taken where the Build Plan or claude.md left room.

## Decisions

| ID  | Decision                                                                                                                                                                                                                                                                                                | Reason                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | GHL native Voice AI only; Retell bake-off not built (conflict C1).                                                                                                                                                                                                                                      | Confirmed by the owner 2026-10-06.                                                                                                                                        |
| D2  | Outcome taxonomy = the Build Plan's 15 codes (`src/core/outcome.ts`), the only outcome strings in the codebase.                                                                                                                                                                                         | claude.md §14; Build Plan is source of truth.                                                                                                                             |
| D3  | Client config source of truth is `config/clients/<client>.yaml` in Git, validated by `businessConfigSchema`. It is pushed to GHL custom values at onboarding (Phase 4). The middleware loads the same YAML at startup. Clients do not edit values in GHL directly; changes go through Git and a deploy. | One source of truth, reviewed changes, no drift between what the agent says and what the middleware decides. Revisit if config-change frequency makes redeploys a burden. |
| D4  | Invalid client config fails startup.                                                                                                                                                                                                                                                                    | A wrong business fact spoken to a caller is worse than a failed deploy.                                                                                                   |
| D5  | Deterministic logic (postcode normalisation, service area, opening hours, escalation matrix) lives in the middleware, not the prompt.                                                                                                                                                                   | LLMs are unreliable with time zones, DST and postcode-district ranges; these rules must be testable.                                                                      |
| D6  | `booking_mode: external` is rejected in V1.                                                                                                                                                                                                                                                             | T4 is contract-only in V1; the Build Plan says use T3 until T4 is built.                                                                                                  |
| D7  | Out-of-hours transfer triggers restricted to P1/P2 by config validation.                                                                                                                                                                                                                                | Escalation matrix: out of hours, owner requests and everything else become message/callback.                                                                              |
| D8  | `emergency_cover: extended` requires an explicit `extended_hours` schedule.                                                                                                                                                                                                                             | The Build Plan does not define "extended"; the smallest unambiguous model.                                                                                                |
| D9  | Metrics via `prom-client` (`/metrics`, token-protected) instead of OpenTelemetry.                                                                                                                                                                                                                       | Same data (latency histograms, counters, process CPU/memory), one dependency, no collector to run. OTel can be added if a tracing backend is chosen.                      |
| D10 | Rate limiting fails open when Redis is down; idempotent (mutating) operations fail closed.                                                                                                                                                                                                              | Rate limiting must never take the call path down; bookings must never be duplicated.                                                                                      |
| D11 | Replay protection = shared-secret auth + idempotency on the GHL call id (same key + different payload → 422; same payload → stored result, no re-execution). No timestamp/HMAC signing.                                                                                                                 | GHL custom actions and workflow webhooks cannot sign requests or send a dynamic timestamp. Read-only actions are safe to replay.                                          |
| D12 | Correlation id: `x-correlation-id` header if valid, else a UUID; echoed on every response and on every log line.                                                                                                                                                                                        | claude.md §15.                                                                                                                                                            |
| D13 | Postcode normaliser repairs only deterministic STT artefacts (number words, "double", spacing, O→0 in the first inward position). A written two-part postcode keeps its split ("LS6 22AB" is rejected, not read as "LS62 2AB").                                                                         | Never silently change a caller's data; ask again instead.                                                                                                                 |

| D14 | Prompt sources use GHL's `{{custom_values.<key>}}` syntax. The compiler emits one universal prompt (GHL substitutes values per sub-account) and a fully rendered prompt per client (fallback if spike V1 fails, and the input to offline tests). | GHL documents custom values in Voice AI prompts; the fallback costs nothing to keep. |
| D15 | Safety scripts are YAML files inlined at build time, byte-identical in every mode. `status: draft` until the PO approves; `npm run prompt:release-check` blocks release while any script, emergency number or the greeting is unapproved. | Build Plan: safety wording fixed and PO-approved, never generated. |
| D16 | Greeting budget: 13 words (≈4 s at 3.3 words/s), enforced per client by prompt lint. | Build Plan "about four seconds"; an estimate until measured on real calls in Phase 6. |
| D17 | The agent picks the Northern Ireland gas script when the caller is in NI (says so, or BT postcode). | Safety comes before postcode capture, so it can't be computed in advance. |
| D18 | Conversation scoring is deterministic (`src/conversation/scorer.ts`) and source-independent: the same rules score phone-harness calls and GHL call-log transcripts. Greeting and safety scripts are exempt from the length rules (fixed wording). | One scoring standard for every gate. |
| D19 | Offline LLM caller simulation is **not built yet**: it must use the same model GHL's agent runs on to be meaningful, and that is a spike item. The scenario pack and scorer are ready for it and for the phone harness. | Avoid a simulation that passes on a different model than production. |
| D20 | Rendered DEMO prompt is ~2,400 words; budget 3,000. Prompt length is a latency lever to measure in Phase 6, not to cut blindly. | claude.md §9: measure first. |

| D21 | Safety scripts gain a `suspended` status (kept on record with a reason, never renderable; lint fails if included). `stopcock_advice` is suspended. | Client research: no isolation/valve instructions without UK-plumber validation. |
| D22 | L2 is organised by the client's 7 presentation families (what is worth finding out, what to capture) instead of a keyword → fixed-questions table; job-type codes are chosen after clarification and only for records. | Client research: "presentation is not diagnosis", "questions must be purposeful". |
| D23 | Agent never claims an area is covered unless `check_service_area` said so in the call. | Live call: agent said "we cover that area" when the action returned not recognised. |
| D24 | Custom actions are GET with `selectedPaths`; auth via GHL's authentication field; location id in the URL; parameters added in the GHL UI. | GHL: POST responses not used by the agent; API bug with headers/parameters (docs/ghl-capabilities.md). |
| D25 | Post-call outcome and job notes are written by GHL `DATA_EXTRACTION` actions into 12 universal contact fields defined in `config/schema/contact-fields.ts` (descriptions ≤ 500 chars, GHL limit). | Build Plan: outcome + summary on 100% of calls. |
| D26 | Every GHL write is confirmed by reading back; provisioning never PUTs an action it cannot read (would drop UI-added parameters). | GHL returned errors for writes that succeeded. |
| D27 | Tests refuse an external Redis unless `TEST_REDIS_ALLOW_FLUSH=1`. | Tests flush databases; a developer's local Redis was hit once. |

| D28 | Find / move / cancel bookings run in the middleware (`src/booking/`) on GHL's calendar API; creating a booking stays on GHL's native action. Booking is only revealed after phone + name-or-postcode verification; wrong details get the same answer as "not found". | GHL has no native reschedule/cancel action; Build Plan find_booking contract. |
| D29 | A change is reported only after GHL confirms it: reschedule is confirmed by reading the appointment back (GHL's PUT response omits times); cancel by the returned status. Only confirmed changes are cached for replay; "slot taken"/"not found" stay retryable. | Never a false success; observed GHL behaviour. |
| D30 | Reschedule/cancel get a 4 s budget (`BOOKING_ACTION_DEADLINE_MS`); reads keep 1.8 s. **Deviation from the 2 s target**: GHL's own update call takes ~1.3 s (measured), so read + write + read-back cannot fit 2 s. Covered by "bear with me while I move that". Re-measure from UK hosting. | Measured, documented trade-off. |
| D31 | GHL returns naive UK wall-clock times on some endpoints (`"2026-10-13 13:00:00"`); all GHL times go through `parseUkTime` (Europe/London, DST-safe), never the server's timezone. | Live bug: bookings looked an hour off and were filtered out. |
| D32 | GHL API client (`src/ghl/client.ts`): pooled, per-attempt timeout ≤ remaining deadline (whole ms), retries only idempotent methods, honours Retry-After, per-process circuit breaker; logs error name/code but never bodies or URLs. Multi-tenant tokens via `GHL_TOKENS` JSON. | Production resilience; observability without PII. |
| D33 | Daily call review (`src/monitoring/`, `tools/ops/call-review.ts`) scores every real transcript with the same scorer as the scenario pack and alerts a team webhook; scheduled in GitHub Actions. Reports carry ids/codes/timings only. | T-1001/T-1004; one scoring standard. |

## Testing (as of 2026-10-12)

| Suite                                   | What it proves                                                                                                                                                                           | Size                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Unit / integration / failure / security | domain logic, HTTP, Redis, auth, rate limit, degradation                                                                                                                                 | part of 344 tests                                |
| Prompt                                  | lint rules fire on violations, rendering, suspended scripts, release gate                                                                                                                | "                                                |
| Conversation                            | scorer rules, 92-scenario pack integrity (TC001–TC040 + client research)                                                                                                                 | "                                                |
| Fuzz (seeded)                           | ~25k random domain inputs + 2k random HTTP requests: no crash, no 5xx, no prototype pollution                                                                                            | `npm run test:fuzz`                              |
| Mutation (Stryker)                      | tests detect deliberate code changes; score 93.7% (break < 90%) on domain, core, security, idempotency, envelope, actions                                                                | `npm run test:mutation`                          |
| Load                                    | 10 → 1000 concurrent GET actions, 0 errors, ~11.7k rps single process, p99 125 ms at 1000                                                                                                | `npm run test:load -- <url> <secret> <location>` |
| Live deployment                         | `tools/demo/verify.ts`: 41 checks that GHL matches Git (prompt byte-identical, safety scripts verbatim, no stopcock, number attached, actions, fields, extraction, middleware reachable) | read-only                                        |

## Prompt build (Phase 2)

| Path                                                      | Contents                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `prompts/L0-guardrails.md`                                | safety-first rules (includes all safety scripts), never-invent rules, identity, manipulation   |
| `prompts/L1-core-receptionist.md`                         | persona, two-sentence turns, memory, call loop, repair strategies                              |
| `prompts/L2-trades/plumbing.md`                           | urgency P1–P4, vulnerability rule, triage per job type, booking/request mode/reschedule/cancel |
| `prompts/L3-business.md`                                  | business details from custom values                                                            |
| `prompts/L4-knowledge.md`                                 | knowledge-base usage rule                                                                      |
| `prompts/greeting.md`                                     | welcome message (draft recording notice)                                                       |
| `prompts/safety/*.yaml`, `prompts/emergency-numbers.yaml` | fixed safety scripts and the only numbers the agent may speak                                  |
| `scenarios/*.yaml`                                        | 73 scripted scenarios across the 11 Build Plan categories, covering TC001–TC040                |

Commands: `npm run prompt:build` (lint + write `build/prompts/`), `npm run prompt:release-check`,
`npm run score -- <transcript-dir>`.

## Middleware API (Phase 1)

All `/v1/*` routes require `x-annie-secret: <secret>` or `Authorization: Bearer <secret>`.
Location is read from `location_id` / `locationId` / `location.id` / `x-ghl-location-id` / query; call id
from `call_id` / `callId` / `ghl_call_id` / `x-ghl-call-id`. Workflow-webhook `customData` is merged
into parameters. (Exact GHL payload is spike item V2; aliases will be trimmed afterwards.)

| Route                                 | Params                                                    | Returns                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/actions/check-service-area` | `postcode`                                                | `postcode_valid`, `postcode`, `readback`, `in_service_area`, `needs_full_postcode`, `outcome_if_ending`, `instruction`                                                                          |
| `POST /v1/actions/call-context`       | —                                                         | `in_hours`, `emergency_cover_active`, `today`, `time_now`, `can_book_live`                                                                                                                      |
| `POST /v1/actions/escalation`         | `trigger` ∈ P1–P4, asks_for_owner, complaint, agent_stuck | `action`, `transfer_targets` (roles, never numbers), `if_transfer_fails`, `booking_priority`, `outcome`, `outcome_if_transfer_fails`, `safety_script_first`, `safe_advice_first`, `instruction` |
| `GET /healthz`                        | —                                                         | liveness                                                                                                                                                                                        |
| `GET /readyz`                         | —                                                         | 200 when Redis reachable and config loaded, else 503                                                                                                                                            |
| `GET /metrics`                        | Bearer `METRICS_TOKEN`                                    | Prometheus metrics                                                                                                                                                                              |

Errors: `{ "error": { "code", "message", "retryable" } }` with stable codes from `src/core/errors.ts`.

## Logging

One `request_completed` line per request: `correlation_id`, `ghl_call_id`, `location_id`, `action`,
`route`, `status`, `latency_ms`, `outcome`, `error_code`. Bodies are never logged; a redact list covers
phone/name/email/address/postcode/transcript fields as a second line of defence (tested in
`tests/integration/logging.test.ts`). Dependency calls go through `timeDependency()`, which records
`annie_dependency_duration_seconds` and logs latency per call.

## Phase 1 measured performance (indicative only)

Single Node 20 process, load generator on the same laptop, DEMO config, Redis local, rate limit raised.
Mixed traffic across the three actions, 10 000 requests per step. **Not** a capacity claim; the formal
load test (Phase 6) runs on production-like infrastructure.

| Concurrent requests | Throughput | p50      | p90      | p95      | p99      | Errors |
| ------------------- | ---------- | -------- | -------- | -------- | -------- | ------ |
| 10                  | 5 503 rps  | 1.5 ms   | 2.9 ms   | 3.5 ms   | 5.5 ms   | 0      |
| 50                  | 7 009 rps  | 6.5 ms   | 9.4 ms   | 10.3 ms  | 14.6 ms  | 0      |
| 100                 | 7 493 rps  | 12.5 ms  | 15.3 ms  | 16.9 ms  | 38.9 ms  | 0      |
| 250                 | 7 256 rps  | 30.8 ms  | 39.4 ms  | 47.9 ms  | 102.7 ms | 0      |
| 500                 | 6 946 rps  | 62.6 ms  | 83.9 ms  | 120.8 ms | 174.3 ms | 0      |
| 1000                | 6 705 rps  | 135.7 ms | 191.6 ms | 222.0 ms | 246.3 ms | 0      |

One process saturates at ~7k rps (one CPU core); latency above that is queueing, so capacity scales by
adding instances. Every step stayed far inside the 2 s action budget.
