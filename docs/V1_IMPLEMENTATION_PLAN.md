# UK Trades AI Receptionist — V1 Implementation Plan

Status: **APPROVED 2026-10-06 (GHL native only). Phase 1 complete; Phase 0 spike needs GHL access.**
Sources: `UK Trades AI Receptionist — V1 Build Plan (GoHighLevel Voice AI)` (the "Build Plan", primary spec) and `claude.md` (engineering rules).
Date: 2026-10-06

---

## 0. Conflicts between the Build Plan and claude.md (decisions taken)

| #   | Conflict                                                                                                                  | Decision                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Build Plan includes a Retell bake-off (Days 4–6). claude.md: "Do NOT replace GHL Native Voice AI with Retell".            | **GHL native only. Bake-off not built.** The layer split (only layers 1–2 would change) is preserved so Retell remains possible later.                                                                                                                                                                                  | claude.md is the engineering instruction for this build; the bake-off is a decision process, not product code. **Needs owner confirmation.** |
| C2  | Prompt layers: claude.md L1–L4; Build Plan L0–L4.                                                                         | Use **L0–L4** (L0 guardrails as its own layer, loaded first).                                                                                                                                                                                                                                                           | Build Plan is the source of truth; L0 is a superset of claude.md §12 safety rules.                                                           |
| C3  | Outcome examples in claude.md (`booked`, `voicemail`, `missed_call`, `qualified`…) differ from the Build Plan's 15 codes. | **Build Plan's 15 codes are canonical** (one enum in code). claude.md examples map onto them: voicemail/missed_call/failed → `TECH_FAILURE` (WF-11), abandoned → `ABANDONED`, qualified-not-booked → `CALLBACK_REQUESTED`/`MESSAGE_TAKEN`, unqualified → `OUT_OF_AREA`/`OUT_OF_SCOPE`/`NON_CUSTOMER`.                   | Avoids two taxonomies (claude.md §14: no arbitrary outcome strings).                                                                         |
| C4  | Prompt in Git, rendered how?                                                                                              | Universal L0–L2 in Git, pushed to the agent via Voice AI API. L3 uses **GHL custom values inside the prompt** (documented by GHL — to be confirmed in spike). Compiler renders per client only if the spike disproves this.                                                                                             | Smallest implementation consistent with the Build Plan's own decision rule.                                                                  |
| C5  | T1/T2 booking: Build Plan says _native_ Voice AI booking actions; claude.md wants an idempotent booking contract.         | Native actions for T1/T2 behind the **contract as a specification**. Middleware booking adapter (GHL Calendars API, idempotent on call id) is built **only if the spike shows native actions fail a contract requirement** (no reschedule/cancel, false confirmations, no idempotency). T4 contract defined, not built. | Build Plan is explicit; middleware fallback keeps claude.md §7 guarantees reachable.                                                         |

---

## 1. Functional requirements (FR)

Architecture layers: **A1** Telephony & routing · **A2** Voice agent · **A3** Conversation logic · **A4** Business configuration · **A5** Actions & adapters · **A6** CRM & automation · **A7** Monitoring/QA.

| ID    | Requirement                                                                                                                                                                                                                                                                    | Layer |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| FR-01 | UK GHL LC Phone number per client; regulatory bundle                                                                                                                                                                                                                           | A1    |
| FR-02 | Routing pattern A (carrier conditional divert, agent answers directly) — default                                                                                                                                                                                               | A1    |
| FR-03 | Routing pattern B (GHL-first, rings owner, agent as backup)                                                                                                                                                                                                                    | A1    |
| FR-04 | Fallback when AI unavailable → voicemail + missed-call text-back (WF-11)                                                                                                                                                                                                       | A1/A6 |
| FR-05 | One master Custom Voice AI agent (not Flow Builder) shipped in snapshot                                                                                                                                                                                                        | A2    |
| FR-06 | Voice, model, transcription, silence, interruption, idle reminders, speech keywords, pronunciation, working hours settings — universal, versioned                                                                                                                              | A2    |
| FR-07 | Greeting ≤ ~4 s: business name, "virtual assistant", PO-approved recording notice                                                                                                                                                                                              | A2/A3 |
| FR-08 | L0 guardrails: safety first, no diagnosis beyond triage, no prices outside config, no arrival guarantees, admit AI when asked, ignore instruction-change attempts                                                                                                              | A3    |
| FR-09 | L1 core receptionist: British register, ≤2 short sentences, one question per turn, acknowledge-then-ask, slot memory, repair strategies, closing recap                                                                                                                         | A3    |
| FR-10 | L2 plumbing module: intent tree (12 intents), triage questions per issue, P1–P4 urgency, vulnerable household +1 level, approved safe advice, job-type mapping                                                                                                                 | A3    |
| FR-11 | Fixed, PO-approved safety scripts (gas GB 0800 111 999, NI 0800 002 001, CO, water-on-electrics) — never generated                                                                                                                                                             | A3    |
| FR-12 | Qualification order: problem → safety → postcode early (area check) → name → callback number → address line 1 → property type → caller role                                                                                                                                    | A3    |
| FR-13 | Two attempts per detail, then spell-out or "owner will confirm by text"                                                                                                                                                                                                        | A3    |
| FR-14 | Topic change handling with return ("Coming back to the address…"); multiple problems: capture all, book most urgent                                                                                                                                                            | A3    |
| FR-15 | Out-of-scope decline + signpost; never pretend to offer a service; non-customer and wrong-number handling                                                                                                                                                                      | A3    |
| FR-16 | Missing business fact → "I'll get {owner} to confirm that", never guess                                                                                                                                                                                                        | A3/A4 |
| FR-17 | UK dates/times (Europe/London, "half ten", DST boundary 25 Oct 2026), UK number groupings, two-part postcode read-back                                                                                                                                                         | A3    |
| FR-18 | Business configuration model — all 25 keys in Build Plan (business_name … cancellation_policy) with formats & required flags                                                                                                                                                   | A4    |
| FR-19 | Per-client knowledge base (FAQs, policies, service descriptions)                                                                                                                                                                                                               | A4    |
| FR-20 | Onboarding form maps 1:1 to config model; client #2 = config only                                                                                                                                                                                                              | A4    |
| FR-21 | Booking contract: check_availability, create_booking, find_booking, reschedule_booking, cancel_booking (inputs/outputs per Build Plan)                                                                                                                                         | A5    |
| FR-22 | T1 GHL calendar, T2 synced Google/M365 via GHL calendar, T3 request mode (2 preferred windows → owner YES/alt → customer confirmed)                                                                                                                                            | A5/A6 |
| FR-23 | T4 external adapter: contract + one mapping document only                                                                                                                                                                                                                      | A5    |
| FR-24 | Live transfer: primary → backup per `transfer_rules` and escalation matrix; transfer-fail → message + "missed transfer" SMS (WF-09)                                                                                                                                            | A5/A6 |
| FR-25 | During-call actions: transfer, workflow trigger, SMS, contact field update, booking, custom webhook                                                                                                                                                                            | A5    |
| FR-26 | Middleware: stateless, UK/EU, shared-secret auth, call-id idempotency, ≤2 s, error/timeout → request mode                                                                                                                                                                      | A5    |
| FR-27 | Universal contact schema: 13 fields (ai_issue_type … ai_call_count)                                                                                                                                                                                                            | A6    |
| FR-28 | Exactly one outcome code per call (15 codes) via post-call Update Contact Field                                                                                                                                                                                                | A6    |
| FR-29 | Workflows WF-01 … WF-13 (router, confirmations, reminders 18:00/07:30, reschedule/cancel, owner alert, emergency escalation, request-mode confirm + 60 min reminder, callback deadline, missed transfer, non-customer, agent failure, daily digest 18:00, inbound SMS replies) | A6    |
| FR-30 | Pipeline with stages: Booked, Awaiting confirmation, Lost/cancelled, Emergency, Callback needed                                                                                                                                                                                | A6    |
| FR-31 | SMS: transactional only, two-way GHL number, business name first, ≤160 chars where possible, PO-approved templates, no marketing (PECR)                                                                                                                                        | A6    |
| FR-32 | CRM sync interface for V2 defined: upsert_contact, create_enquiry, append_note, set_outcome                                                                                                                                                                                    | A5    |
| FR-33 | Daily call review from Voice AI call log; fixed failure-mode list (8 modes)                                                                                                                                                                                                    | A7    |
| FR-34 | Dashboard per client: calls, outcomes, bookings, escalations, avg duration                                                                                                                                                                                                     | A7    |
| FR-35 | Alerts to team channel: TECH_FAILURE, ABANDONED spike, negative sentiment                                                                                                                                                                                                      | A7    |
| FR-36 | Agency structure: MASTER-DEV, MASTER-QA, DEMO, CLIENT-<name>; snapshot release flow; client-owned assets excluded from pushes                                                                                                                                                  | All   |

## 2. Non-functional requirements (NFR)

| ID     | Requirement                                                                                                             | Target                                                         | Layer |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----- |
| NFR-01 | Turn latency (caller's last word → agent first audio)                                                                   | median ≤ 1.5 s, p90 ≤ 2.5 s                                    | A2/A7 |
| NFR-02 | Middleware action response                                                                                              | ≤ 2 s (budget below), covered by "Let me just check the diary" | A5    |
| NFR-03 | Latency logged on **every** call and every action/API boundary                                                          | 100 %                                                          | A7    |
| NFR-04 | Stateless, horizontally scalable, bounded concurrency, backpressure, pooling, rate-limit handling, graceful degradation | —                                                              | A5    |
| NFR-05 | Explicit timeout/retry/fallback/user behaviour/logging/alert per dependency                                             | —                                                              | A5    |
| NFR-06 | No PII in logs (ids, status, outcome codes, latency, error codes only)                                                  | —                                                              | A7    |
| NFR-07 | Security: auth, replay protection, input/output validation, size limits, rate limits, secrets in env only, audit log    | —                                                              | A5    |
| NFR-08 | UK/EU data residency for middleware                                                                                     | eu/uk region                                                   | A5    |
| NFR-09 | Agent response length                                                                                                   | avg ≤ 25 words                                                 | A3    |
| NFR-10 | Onboarding time client #2                                                                                               | ≤ 4 h, config only                                             | A4    |
| NFR-11 | Load: measured at 10/50/100/250/500/1000+ concurrent; documented capacity                                               | measured                                                       | A5    |
| NFR-12 | Versioned releases (vX.Y.Z), changelog naming the failure fixed                                                         | —                                                              | All   |

## 3. Acceptance criteria (from Build Plan; all must be evidenced)

| ID    | Criterion                                      | Target                      | Evidence                                       |
| ----- | ---------------------------------------------- | --------------------------- | ---------------------------------------------- |
| AC-01 | Response latency                               | median ≤ 1.5 s, p90 ≤ 2.5 s | 20 recorded calls per build, waveform-measured |
| AC-02 | Safety-critical scenarios correct              | 100 % (blocking)            | 8 safety scenarios                             |
| AC-03 | Bookable scenarios end in correct booking      | ≥ 90 %                      | new jobs (12), quotes (4), resched/cancel (6)  |
| AC-04 | Postcodes & phone numbers captured correctly   | ≥ 95 %                      | 40 postcodes + 20 numbers × accent matrix (16) |
| AC-05 | Re-asked questions                             | 0 in regression             | transcript audit                               |
| AC-06 | Calls with logged outcome + summary            | 100 %                       | call-log reconciliation job                    |
| AC-07 | Onboard business #2                            | ≤ 4 h config only           | timed dry run on DEMO                          |
| AC-08 | Water emergencies correct urgency + escalation | 100 %                       | 6 scenarios                                    |
| AC-09 | Existing customer/complaints owner alerted     | 100 %                       | 5 scenarios                                    |
| AC-10 | Prices/FAQs no invented answers                | 100 %                       | 6 scenarios                                    |
| AC-11 | Out of scope / area                            | 100 %                       | 5 scenarios                                    |
| AC-12 | Non-customer/spam: no owner alert for spam     | 100 %                       | 4 scenarios                                    |
| AC-13 | Conversation stress                            | ≥ 90 %                      | 10 scenarios                                   |
| AC-14 | Adversarial                                    | 100 %                       | 5 scenarios                                    |
| AC-15 | Outcome code correct                           | 100 %                       | every scored call                              |
| AC-16 | Naturalness                                    | ≥ 4/5 avg                   | reviewer rubric                                |
| AC-17 | Data accuracy                                  | ≥ 95 % fields               | rubric                                         |
| AC-18 | claude.md TC001–TC068                          | pass                        | automated + scripted-call suites               |

---

## 4. GHL capabilities that must be verified (Phase 0 spike)

Documented by GHL (still confirm in our account): Voice AI public API (agent CRUD, action CRUD with types `CALL_TRANSFER, DATA_EXTRACTION, IN_CALL_DATA_EXTRACTION, WORKFLOW_TRIGGER, SMS, APPOINTMENT_BOOKING, CUSTOM_ACTION, KNOWLEDGE_BASE`, call logs list/get); custom values in prompt + welcome message; custom actions are POST with Bearer/Basic/header auth and typed parameters (text, number, email, phone, date).

| #   | Capability to verify                                                                                                                                         | Why it matters                              | If it fails                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| V1  | Location custom values render in the Voice AI prompt at call time (not at save time)                                                                         | C4 — config-only onboarding                 | Build the prompt compiler (render per client, push via API)                                        |
| V2  | Custom action: does GHL send call id / contact id / caller number automatically? Can we template them into headers/body?                                     | Idempotency key = GHL call id               | Use agent-extracted params + contact id; derive key from (contact, from-number, call start)        |
| V3  | Custom action timeout value, and whether the agent reads the response body to continue the conversation                                                      | Middleware ≤ 2 s design; truthful responses | Keep middleware actions to fire-and-forget only; deterministic logic moves into prompt + workflows |
| V4  | Native APPOINTMENT_BOOKING: availability, book, **reschedule, cancel**; behaviour on failure (does agent ever claim success?)                                | C5, booking safety                          | Build middleware booking adapter on GHL Calendars API                                              |
| V5  | Synced Google / M365 calendars block slots for native booking                                                                                                | T2                                          | Document limitation; T2 → T3                                                                       |
| V6  | Call transfer: primary → backup chaining, no-answer detection, outcome visible to agent/workflow                                                             | Escalation matrix, WF-09                    | Transfer via workflow / urgent alert path                                                          |
| V7  | Post-call trigger reliability: "Trigger Workflow" action vs Voice AI call-end trigger; post-call Update Contact Field fires on hang-up/abandon               | Outcome 100 %                               | Reconciliation job sets `ABANDONED`/`TECH_FAILURE` from call log                                   |
| V8  | Call log API fields: transcript with **per-utterance timestamps**, recording URL, **dual-channel** recording, duration, actions executed, summary, sentiment | Per-call latency, QA                        | Latency only from scripted harness calls (we control the caller side)                              |
| V9  | Workflow API: can workflows be created/exported via API? (Expected: no)                                                                                      | Provisioning-as-code                        | Workflows built in UI from versioned spec + checklist, shipped in snapshot                         |
| V10 | Snapshot update push excludes custom values, KB, calendars (T-113)                                                                                           | Client config safety                        | Per-client override procedure documented                                                           |
| V11 | Speech keywords, pronunciation, idle reminders, interruption sensitivity, response speed settings exposed (UI and/or API)                                    | Voice tuning                                | Manual settings sheet in Git                                                                       |
| V12 | Working-hours + "answer directly vs backup" setting                                                                                                          | Pattern A/B                                 | Pattern-specific runbook                                                                           |
| V13 | API rate limits for Private Integration tokens (burst/daily)                                                                                                 | Load & retry design                         | Token bucket per location in middleware                                                            |
| V14 | Inbound SMS keyword trigger for owner "YES" reply                                                                                                            | WF-07                                       | Middleware SMS-reply parser via GHL webhook                                                        |
| V15 | Custom values usable in SMS templates and workflows                                                                                                          | WF templates config-only                    | Contact-level fields copied by router                                                              |

The spike is a script (`tools/spike/`) that exercises each item through the API where possible and outputs a pass/fail report, plus a manual checklist for UI-only items. **It needs MASTER-DEV access.**

---

## 5. Architecture (minimum production design)

```
Caller ─► Owner's number (divert) / GHL number ─► GHL LC Phone (A1)
        ─► GHL Custom Voice AI agent (A2)  ── prompt L0+L1+L2 (Git) + L3 custom values + L4 KB (A3/A4)
             │ during-call native actions: transfer, SMS, booking, field update, workflow (A5)
             │ during-call CUSTOM_ACTION (POST, ≤2 s) ─────────────┐
             ▼                                                     ▼
        GHL CRM / Calendar / Workflows WF-01..13 (A6)      Middleware "annie-api" (A5)
             │ post-call webhook (workflow) ───────────────►  stateless, UK region
             ▼                                               ├─ /actions/*   (service-area, call-context, booking adapter fallback, request-mode)
        Voice AI call logs ◄── reconciler / latency analyser ├─ /events/*    (post-call ingest, outcome validation)
                                                             ├─ Redis: idempotency, replay nonces, rate-limit buckets (TTL’d, no PII)
                                                             └─ OTel metrics + JSON logs ─► dashboards, alerts (A7)
```

### Middleware responsibilities (only what GHL native cannot do deterministically)

1. **`POST /v1/actions/check-service-area`** — normalise UK postcode, match against `service_area` districts. Deterministic; LLMs are unreliable at this. Target p99 < 50 ms (no external call; config cached with short TTL).
2. **`POST /v1/actions/call-context`** — in_hours / out_of_hours (Europe/London, DST-safe), `emergency_cover`, whether transfer is allowed for an urgency per `transfer_rules`. Deterministic escalation matrix.
3. **Booking adapter** (only if V4/V5 fail): the five contract operations on GHL Calendars API, idempotent on call id; on any error/timeout returns `status: "unavailable"` → agent switches to request mode.
4. **`POST /v1/events/call-ended`** — called by WF-01: validates outcome code, records call metrics, writes reconciled fields, emits alerts.
5. **Reconciler + latency analyser (scheduled job, same codebase)** — pulls call logs; any call without an outcome gets `ABANDONED`/`TECH_FAILURE`; computes per-call turn-latency where timestamps/recordings allow (V8).

### Stack (decision)

- **TypeScript on Node 22, Fastify, Zod** (schemas shared by config validator, contract, and tests), **pino** JSON logs, **OpenTelemetry** metrics/traces, **undici** pooled HTTP client.
- **Redis** (managed, UK region) for idempotency keys, replay nonces, rate-limit buckets — no call state in process memory. GHL stays the system of record; no second CRM/DB.
- **Container** deployed to a UK region (default: **GCP Cloud Run europe-west2 + Memorystore**, min instances ≥ 2 to avoid cold starts on the latency path). Portable to AWS eu-west-2 ECS if preferred.
- **k6** for load tests, **Vitest** for unit/integration/contract tests.

### Latency budget for a middleware action (target total ≤ 2 s, aim p95 < 300 ms)

| Segment                                        | Budget                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| GHL → middleware network (UK)                  | ~50–150 ms (measured from GHL timestamps where available)                    |
| Auth + validation + idempotency lookup (Redis) | < 10 ms                                                                      |
| Business logic (no external call)              | < 20 ms                                                                      |
| GHL API call when needed (calendar)            | timeout 1200 ms, 1 retry only if remaining budget > 600 ms                   |
| Hard deadline                                  | 1800 ms → return `unavailable` (request-mode fallback), never a fake success |

### Latency on every call — what is measured where

| Boundary (claude.md §9)                                               | Source                                                                               | Every call?                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| call start / end, duration                                            | Voice AI call log, post-call event                                                   | Yes                                                                 |
| action start / action response                                        | middleware span (server-received → response-sent), plus GHL API sub-spans            | Yes, every action                                                   |
| booking confirmation                                                  | booking span + outcome event                                                         | Yes                                                                 |
| speech detected / transcription / agent response start (turn latency) | call-log utterance timestamps or dual-channel recording analysis — **depends on V8** | Yes if V8 passes; otherwise every harness call + sampled real calls |

Every log line carries `correlation_id`, `ghl_call_id`, `location_id`, `action`, `status`, `outcome`, `latency_ms`, `error_code`, `retry_count`. Phone numbers, names, addresses, transcripts are never logged (postcode logged only as district, e.g. `LS6`).

### Failure matrix (each dependency)

| Dependency              | Timeout            | Retry                                           | Fallback                                                                    | Caller hears                                                           | Log/alert                                      |
| ----------------------- | ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| GHL Calendars API       | 1200 ms            | 1× if budget allows, jittered; never on 4xx     | request mode                                                                | "I'll take your preferred times and {owner} will confirm by text"      | `booking_unavailable`, alert if > 5 % / 15 min |
| GHL Contacts/fields API | 1500 ms            | 3× exp. backoff (async path)                    | reconciler retries                                                          | nothing (post-call)                                                    | `crm_write_failed`, alert on any after retries |
| GHL 429                 | —                  | honour `Retry-After`, token bucket per location | queue/defer post-call writes                                                | —                                                                      | `rate_limited` metric                          |
| Redis                   | 50 ms              | none                                            | fail **closed** for booking (request mode), fail open for read-only actions | as above                                                               | alert immediately                              |
| Config missing/invalid  | —                  | —                                               | "I'll get {owner} to confirm that"                                          | —                                                                      | `config_invalid`, blocks onboarding            |
| Transfer                | GHL ring timeout   | backup number                                   | message + WF-09                                                             | "He's not able to pick up — I'll make sure he gets this straight away" | `transfer_failed`                              |
| SMS                     | GHL                | GHL                                             | owner alert via second channel (email)                                      | —                                                                      | alert                                          |
| Middleware down         | GHL action timeout | —                                               | agent continues natively; booking → request mode                            | covered by "check the diary" phrasing                                  | uptime alert                                   |

---

## 6. Proposed repository structure

```
annieanswer/
├─ claude.md
├─ docs/
│  ├─ V1_IMPLEMENTATION_PLAN.md        (this file)
│  ├─ architecture.md                  decisions log (ADRs inline)
│  ├─ ghl-capabilities.md              spike results V1–V15
│  ├─ booking-contract.md              + T4 mapping document (one external system)
│  ├─ failure-matrix.md
│  ├─ runbooks/ onboarding.md, release.md, incident.md, daily-review.md
│  └─ load-test-report.md
├─ prompts/                            source of truth, versioned
│  ├─ L0-guardrails.md
│  ├─ L1-core-receptionist.md
│  ├─ L2-trades/plumbing.md
│  ├─ safety-scripts/ (PO-approved fixed text, one file per scenario)
│  ├─ greeting.md
│  └─ CHANGELOG.md
├─ config/
│  ├─ schema/business-config.schema.ts  (Zod; 25 keys)
│  ├─ schema/contact-fields.ts           (13 universal fields)
│  ├─ clients/demo.yaml                  (fictional DEMO business)
│  └─ clients/<client>.yaml
├─ ghl/                                provisioning-as-code where the API allows
│  ├─ agent-settings.yaml              voice/model/silence/interruption/keywords
│  ├─ actions.yaml                     during-call + post-call actions
│  ├─ custom-fields.yaml, tags.yaml, pipeline.yaml
│  ├─ workflows/WF-01..WF-13.md        build specs (UI) + checklists
│  └─ sms-templates.yaml
├─ src/
│  ├─ app.ts, server.ts                Fastify bootstrap, graceful shutdown
│  ├─ config/                          env loading (secrets via env only)
│  ├─ core/  outcome.ts, urgency.ts, job-types.ts, errors.ts
│  ├─ observability/ logger.ts, metrics.ts, timing.ts, redact.ts
│  ├─ security/ auth.ts, replay.ts, limits.ts
│  ├─ store/ redis.ts, idempotency.ts
│  ├─ ghl/ client.ts (pooled, timeout, retry, rate-limit), calendars.ts, contacts.ts, voice-ai.ts
│  ├─ domain/ postcode.ts, service-area.ts, hours.ts, escalation.ts
│  ├─ booking/ contract.ts, ghl-calendar.adapter.ts, request-mode.adapter.ts, external.adapter.ts (interface only)
│  ├─ routes/ actions.ts, events.ts, health.ts
│  └─ jobs/ reconciler.ts, latency-analyser.ts
├─ tools/
│  ├─ spike/                           Phase 0 capability probe
│  ├─ compile-prompt.ts                render/lint/push prompt
│  ├─ onboard.ts                       validate client yaml → push custom values
│  └─ call-harness/                    scripted phone-call runner + scorer
├─ tests/ unit/ integration/ contract/ failure/ safety/ conversation/ security/ regression/
├─ load/ k6 scenarios (10 → 1000+)
├─ .github/workflows/ ci.yml, release.yml
├─ Dockerfile, docker-compose.yml (redis for local/integration)
└─ package.json, tsconfig.json, eslint, prettier
```

---

## 7. Test strategy

| Suite                       | What                                                                                                                                                                                                       | Where it runs       | Gate                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------ |
| Unit                        | postcode normaliser (40-postcode set), service area, hours/DST (both sides of 25 Oct 2026), escalation matrix, outcome enum, redaction, config schema                                                      | CI, every push      | blocking                 |
| Contract                    | booking contract I/O (all 5 ops) for each adapter; GHL API response fixtures; custom-action request schema                                                                                                 | CI                  | blocking                 |
| Integration                 | Fastify + real Redis (docker) + mocked GHL (recorded fixtures)                                                                                                                                             | CI                  | blocking                 |
| Failure                     | TC020–TC022, TC055–TC062: timeouts, 5xx, 429, malformed, duplicate, Redis down, restart mid-load                                                                                                           | CI                  | blocking                 |
| Security                    | TC063–TC068 at API level: bad auth, replay, oversize, malformed, injection payloads in params                                                                                                              | CI                  | blocking                 |
| Prompt lint                 | L0–L2 contain no business facts; safety scripts byte-identical to approved text; placeholders all defined in schema; response-length rules present                                                         | CI                  | blocking                 |
| Safety (offline)            | rendered prompt + same model family as the GHL agent, LLM-simulated callers, 8 safety + TC027–TC032, scored by deterministic checks (approved script present, correct number, no improvised advice)        | CI on prompt change | **blocking**             |
| Conversation (offline)      | TC001–TC040 text simulations; metrics: words/turn ≤ 25, re-asks = 0, slot capture accuracy, no hallucinated facts                                                                                          | CI on prompt change | blocking for regressions |
| Scripted phone calls (real) | call harness dials MASTER-QA number, plays pre-recorded caller turns, records both legs, measures turn latency on the waveform, scores outcome/fields via API — core 20 every change, full ~90 per release | MASTER-QA           | **release gate**         |
| Accent/environment matrix   | 8 accents × 4 environments (16 scenarios), human callers per Build Plan + recorded samples replayed by harness                                                                                             | MASTER-QA           | release gate (≥ 95 %)    |
| Load                        | k6: 10/50/100/250/500/1000+ concurrent action calls; p50/p90/p95/p99, errors, timeouts, retries, CPU, memory, connections                                                                                  | staging             | documented capacity      |
| E2E                         | TC041–TC054 against MASTER-QA (contact/fields/workflow/SMS/calendar/outcome write-back verified via API)                                                                                                   | MASTER-QA           | release gate             |

Honest limitation: offline text simulation is a fast pre-gate, **not** a substitute for real calls — GHL's runtime (STT, turn-taking, its model settings) is only exercised by the phone harness. Production readiness is claimed only on real-call results.

---

## 8. Deployment strategy

- **Middleware:** CI (format, lint, typecheck, unit, contract, integration, failure, security, safety, regression) → build image tagged `vX.Y.Z` + git sha → deploy to `staging` (UK region) → smoke + k6 short run → manual approval → `production` with traffic split/rollback by revision. Min instances ≥ 2 across zones; health `/healthz` (liveness) and `/readyz` (Redis + config). Secrets from the cloud secret manager into env.
- **GHL assets:** edit only in MASTER-DEV (prompts pushed from Git by `compile-prompt`, never hand-edited) → cut snapshot `vX.Y` → load MASTER-QA → core-20 + safety + full pack at release → push to client sub-accounts (client-owned assets excluded, V10) → release notes + prompt CHANGELOG naming the failure fixed.
- **Rollback:** previous snapshot re-push + previous middleware revision; both versions recorded in the release notes.
- **Environments:** MASTER-DEV ↔ middleware `dev`; MASTER-QA ↔ `staging`; DEMO + CLIENT-* ↔ `production`. Each env has its own API keys and shared secrets.

---

## 9. Phased implementation (IMPLEMENT → TEST → FIX → VERIFY each)

| Phase                    | Content                                                                                                                                                                                                                                                                                                                                                                                                  | Needs GHL access?  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **P0 Spike**             | `tools/spike` capability probe + manual checklist → `docs/ghl-capabilities.md`; locks C4/C5/V-items                                                                                                                                                                                                                                                                                                      | **Yes**            |
| **P1 Foundation**        | repo, TS toolchain, CI; config schema (25 keys) + DEMO yaml + validator; outcome/urgency/job-type enums; logging with redaction, correlation ids, latency timing, metrics; auth, replay protection, size limits; Redis idempotency; health; postcode + service-area + hours/DST + escalation domain logic; `check-service-area` and `call-context` actions; full unit/integration/failure/security tests | No                 |
| **P2 Prompts**           | L0–L2 + greeting + safety scripts (draft until PO approval), prompt lint, compiler, offline safety + conversation harness                                                                                                                                                                                                                                                                                | Push step only     |
| **P3 Actions & booking** | booking contract + request-mode; GHL calendar adapter if V4 fails; post-call ingest; GHL client with timeouts/retry/rate limits; reconciler                                                                                                                                                                                                                                                              | Yes for live tests |
| **P4 GHL provisioning**  | custom fields, values, tags, pipeline, actions via API; WF-01..13 + SMS template specs; snapshot                                                                                                                                                                                                                                                                                                         | Yes                |
| **P5 Monitoring**        | latency analyser, dashboards, alerts (TECH_FAILURE, ABANDONED spike, sentiment, action error rate, latency SLO burn)                                                                                                                                                                                                                                                                                     | Yes                |
| **P6 Test at scale**     | phone call harness, core 20 / full pack, accent matrix support, k6 load runs + report                                                                                                                                                                                                                                                                                                                    | Yes                |
| **P7 Release**           | env pipelines, onboarding runbook + timed DEMO onboarding, docs, v1.0.0                                                                                                                                                                                                                                                                                                                                  | Yes                |

---

## 10. Inputs needed from the business

1. Confirm C1 (no Retell bake-off).
2. MASTER-DEV agency/sub-account access + a Private Integration token with Voice AI, contacts, calendars, custom values/fields, workflows scopes.
3. Cloud account for UK hosting (default: GCP europe-west2) or a different preference.
4. PO artefacts: approved safety scripts (with verified emergency numbers), recording notice, SMS templates, scenario pack, UK terminology guide, vulnerable-household rule.
5. Pilot client config values (or DEMO values to start).
6. Team alert channel (Slack/Teams webhook) for alerting.
