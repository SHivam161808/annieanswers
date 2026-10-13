# Naming and versioning (T-104, T-004)

The tools in `tools/` find GHL assets **by name**. A renamed workflow, field, value or action breaks
provisioning, linking and verification, often without an obvious error. Use the names below
**exactly**: same case, same spacing, same punctuation.

Source of truth for each list is the code file named. If this page and the code disagree, the
code wins; fix this page.

---

## 1. GHL sub-accounts

| Name            | Purpose                                         | Env file           | Client config                      |
| --------------- | ----------------------------------------------- | ------------------ | ---------------------------------- |
| `MASTER-DEV`    | Build environment; the only place logic changes | `.env`             | `config/clients/demo.yaml` (today) |
| `MASTER-QA`     | Loaded from each snapshot; regression runs here | `.env.qa`          | `config/clients/<qa config>.yaml`  |
| `DEMO`          | Fictional plumber for sales demos               | `.env.demo`        | `config/clients/demo.yaml`         |
| `CLIENT-<name>` | One per paying business                         | `.env.<client_id>` | `config/clients/<client_id>.yaml`  |

- Today the sub-account **AnnieAnswers** acts as MASTER-DEV (`docs/ghl/environments-and-snapshots.md`).
  Rename it `MASTER-DEV` when convenient; no tool depends on the sub-account name.
- `<name>` (proposal): the client's `client_id` from its config file, in **upper case**. `client_id`
  is a lowercase slug (`^[a-z0-9][a-z0-9-]{1,62}$`, `config/schema/business-config.ts`).
  Example: `client_id: smith-and-sons` → sub-account `CLIENT-SMITH-AND-SONS`, env file
  `.env.smith-and-sons`, config `config/clients/smith-and-sons.yaml`.
- Each client config's `ghl_location_id` must match its sub-account.

## 2. Workflows

Format: **`WF-NN <Name>`**: two-digit number, one space, then the name.

| Name                                       |
| ------------------------------------------ |
| `WF-01 Outcome router`                     |
| `WF-02 Booking confirmation`               |
| `WF-03 Reminders`                          |
| `WF-04 Reschedule and cancel confirmation` |
| `WF-05 Owner enquiry alert`                |
| `WF-06 Emergency escalation`               |
| `WF-07 Request-mode confirmation`          |
| `WF-08 Callback deadline`                  |
| `WF-09 Missed transfer`                    |
| `WF-10 Non-customer`                       |
| `WF-11 Agent failure fallback`             |
| `WF-12 Daily digest`                       |
| `WF-13 Customer SMS replies`               |

Rules (from `tools/ghl/client.ts` `findWorkflow`):

- The tools match a workflow whose name **starts with `WF-NN ` (with the space)**. `WF-1 Outcome
router`, `WF01 …` or `WF-01-Outcome router` are **not found**.
- **Exactly one** workflow per prefix. If there are two (e.g. GHL's `WF-01 Outcome router (copy)`), the
  lookup treats it as ambiguous and fails. Delete or rename copies (e.g. `OLD WF-01 …`) straight away.
- The text after the prefix is for people; keep it as listed so the build guide
  (`docs/ghl/workflows.md`) matches.
- New workflows take the next free number. Never reuse a retired number.

## 3. Custom fields (contact)

Key = name = **snake_case**, exactly as in `config/schema/contact-fields.ts`. Provisioning creates
each field with `name` set to the key and finds it again by that name.

| Key                                                                                                                                                                                                        | Written by                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ai_call_outcome`, `ai_issue_type`, `ai_urgency`, `ai_issue_summary`, `ai_job_notes`, `job_postcode`, `job_address`, `in_service_area`, `property_type`, `caller_role`, `access_notes`, `preferred_window` | Post-call extraction action `extract_<key>` (one per field) |
| `ai_last_call_at`, `ai_call_count`                                                                                                                                                                         | WF-01                                                       |

- GHL turns a field name into a merge key such as `{{contact.ai_issue_type}}`. Because our names are
  already snake_case, the key should equal the name (⚠ verify for each new field: open the field in
  Settings → Custom Fields and check the key).
- New field: add it to `contact-fields.ts` first (description ≤ 500 characters, the GHL limit), then
  provision. Never create fields by hand in a client sub-account.

## 4. Custom values

Name = key, exactly as in `src/prompt/custom-values.ts`. The prompt references them as
`{{custom_values.<key>}}`; prompt lint rejects unknown keys.

| Used by        | Keys                                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prompt (L3)    | `business_name`, `business_name_spoken`, `owner_first_name`, `persona_sentence`, `services_offered_text`, `services_not_offered_text`, `gas_work_statement`, `opening_hours_text`, `emergency_cover_text`, `pricing_text`, `quote_policy`, `payment_methods_text`, `callback_promise`, `cancellation_policy` |
| Workflows only | `alert_sms_number`, `transfer_number_primary`, `transfer_number_backup` (never in the prompt)                                                                                                                                                                                                                |

Values come from the client's YAML via provisioning (decision D3); do not edit them in GHL.

## 5. Tags

All lower case, words joined by hyphens.

| Tag               | Meaning                                                                    | Set by    |
| ----------------- | -------------------------------------------------------------------------- | --------- |
| `ai-call`         | Contact has had at least one AI-answered call                              | WF-01     |
| `outcome-<code>`  | Outcome of a call. `<code>` = outcome code in lower case with `_` → `-`    | WF-01     |
| `outcome-missing` | No valid outcome was written (a bug; triggers a team alert)                | WF-01     |
| `non-customer`    | Spam, sales or wrong number                                                | WF-10     |
| `workflow-test`   | Synthetic contact created by `tools/ghl/test-workflows.ts`; safe to delete | test tool |

Outcome tags (rule from `tools/ghl/test-workflows.ts`: `outcome-${code.toLowerCase().replaceAll('_', '-')}`;
codes from `src/core/outcome.ts`):

`outcome-booked`, `outcome-booking-requested`, `outcome-rescheduled`, `outcome-cancelled`,
`outcome-emergency-transferred`, `outcome-emergency-alerted`, `outcome-transferred`,
`outcome-callback-requested`, `outcome-message-taken`, `outcome-info-only`, `outcome-out-of-area`,
`outcome-out-of-scope`, `outcome-non-customer`, `outcome-abandoned`, `outcome-tech-failure`.

Never invent an outcome tag; a new outcome code is a code change (claude.md §14, decision D2).

## 6. Calendars and Voice AI agent

| Asset          | Pattern                                               | Example                       | Source                    |
| -------------- | ----------------------------------------------------- | ----------------------------- | ------------------------- |
| Calendar       | `<LABEL> – <business_name_spoken> diary`              | `DEMO – Smith and Sons diary` | `tools/demo/provision.ts` |
| Voice AI agent | `<LABEL> – <business_name_spoken>`, max 40 characters | `DEMO – Smith and Sons`       | `tools/demo/provision.ts` |

- The separator is an **en dash** (`–`) with spaces, not a hyphen.
- `<LABEL>` is `DEMO` in the current tool. Proposal for other sub-accounts: `DEV`, `QA`, or the
  client's `CLIENT-<name>`. ⚠ The label is hard-coded today; a per-environment label is a
  developer change.
- The client's booking calendar id is set in their config (`calendar_id`); the tools use the id, not
  the name. A client's own existing calendar (T2) keeps its own name.

## 7. Pipeline

Name **`AI Receptionist Enquiries`**. Stages, in this order, spelt exactly as in `src/core/outcome.ts`
`PIPELINE_STAGES` and `docs/ghl/workflows.md`:

`Booked`, `Awaiting confirmation`, `Callback needed`, `Emergency`, `Lost or cancelled`.

Opportunity name (set in WF-01): `{{contact.name}} – {{contact.ai_issue_type}}`.

## 8. Voice AI actions

Action names are **snake_case**. `tools/demo/provision.ts` and `tools/ghl/link-workflows.ts` find
actions by name; `tools/demo/verify.ts` fails if any is missing.

| Action name           | Type                                                   | When        | Purpose                                                 |
| --------------------- | ------------------------------------------------------ | ----------- | ------------------------------------------------------- |
| `call_context`        | Custom action (GET, middleware)                        | During call | In hours / out of hours, emergency cover, can book live |
| `check_service_area`  | Custom action (GET, middleware)                        | During call | Postcode normalisation and coverage                     |
| `escalation`          | Custom action (GET, middleware)                        | During call | Escalation matrix (transfer, alert, booking priority)   |
| `book_appointment`    | Native appointment booking                             | During call | Book on the client's calendar                           |
| `alert_owner_urgent`  | Workflow trigger → `WF-06`                             | During call | Urgent owner alert                                      |
| `extract_<field key>` | Post-call data extraction (one per field in section 3) | After call  | e.g. `extract_ai_call_outcome`, `extract_job_postcode`  |

Caller parameters for the three custom actions are added in the GHL screen (GHL API bug, decision
D24). Renaming a parameter there must match the middleware's expected names.

## 9. Versioning

### 9.1 Release numbers

One release number covers prompts, GHL assets and middleware together: **semantic versioning
`vX.Y.Z`** (claude.md §22; NFR-12).

| Part      | Bump when                                                                                                                        | Example  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| MAJOR `X` | Change a client must act on: new required config key, routing pattern change, contact field removed/renamed, outcome code change | `v2.0.0` |
| MINOR `Y` | New behaviour: new workflow, new action, new trade module, prompt behaviour change                                               | `v1.1.0` |
| PATCH `Z` | Fix with no new behaviour: prompt wording fix, middleware bug fix, SMS template typo                                             | `v1.0.1` |

Pre-releases: `v1.1.0-rc.1` for builds loaded into MASTER-QA before sign-off (proposal).

### 9.2 Where the version appears

| Place                     | Format                   | Notes                                                                                                                                                                                                     |
| ------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git tag                   | `vX.Y.Z` (annotated)     | `git tag -a v1.0.0 -m "v1.0.0"` on the commit that was tested in MASTER-QA. Never move a tag.                                                                                                             |
| `package.json` `version`  | `X.Y.Z` (no `v`)         | Currently `0.1.0`.                                                                                                                                                                                        |
| `RELEASE_VERSION` env var | `X.Y.Z`                  | Read in `src/config/env.ts` (default `0.0.0-dev`); attached to every log line by the logger (`src/server.ts`). Set it in each deployed environment to the released version, so logs show what is running. |
| Container image           | `vX.Y.Z` plus git sha    | Per the plan (§8); release pipeline not built yet.                                                                                                                                                        |
| GHL snapshot              | `annie-vX.Y`             | Created by hand (no API). See 9.3.                                                                                                                                                                        |
| `prompts/CHANGELOG.md`    | `## vX.Y.Z — YYYY-MM-DD` | One entry per release; see 9.4.                                                                                                                                                                           |

### 9.3 Snapshot names

The runbook names snapshots **`annie-vX.Y`** (e.g. `annie-v0.1`, `annie-v1.0`) and says the name must
match `RELEASE_VERSION` and the CHANGELOG. A two-part snapshot name cannot tell `v1.0.0` from
`v1.0.1`.

**Proposal (needs product owner agreement):**

- `annie-vX.Y` for `vX.Y.0` releases.
- `annie-vX.Y.Z` when a patch release changes GHL assets (e.g. `annie-v1.0.1`).
- A middleware-only patch needs **no new snapshot**; the CHANGELOG entry says "snapshot: unchanged
  (annie-v1.0)".
- Snapshot description field (⚠ verify GHL has one): git tag and commit sha.
- Never delete a released snapshot; it is the rollback (`docs/ghl/environments-and-snapshots.md`).

### 9.4 CHANGELOG rules

`prompts/CHANGELOG.md`: "Every change names the failure it fixes, passes the core 20, and ships only
in a new snapshot."

- Every entry under **Fixed** names the **failure**: what went wrong, on which call, scenario or test,
  in plain words. "Improved prompt" is not acceptable; "Agent said 'we cover that area' when
  `check_service_area` returned not recognised (live call 2026-10-09)" is.
- Use the fixed failure-mode list from daily call review (FR-33) or a scenario / TC id where one
  exists.
- Record test evidence: core 20 result, safety 100 %, `npm run prompt:release-check`.
- Record the rollback: previous snapshot and previous middleware version.
- Work in progress goes under `## Unreleased` and is moved into the version heading at release.

### 9.5 CHANGELOG entry template

```markdown
## vX.Y.Z — YYYY-MM-DD

Snapshot: annie-vX.Y[.Z] | Git tag: vX.Y.Z (<short sha>) | Middleware: vX.Y.Z
Rollback to: annie-vA.B / middleware vA.B.C

### Fixed

- <Failure, in plain words> — seen in <call id / scenario id / TC id / date>.
  Fix: <what changed, which file/layer (L0–L4, WF-NN, action, middleware)>.

### Added

- <New behaviour> (<requirement id, e.g. FR-24>).

### Changed

- <Behaviour change a client or operator would notice>.

### Client action needed

- None. | <What each client sub-account must do, e.g. new custom value to fill>.

### Evidence

- CI: green (<run link>)
- Core 20 real calls on MASTER-QA: <n>/20 pass; safety <n>/<n> (must be 100 %)
- `npm run prompt:release-check`: pass
- `tools/demo/verify.ts` on MASTER-QA: pass
- Approved by: <product owner>, <date>
```

---

## Sources

- Semantic Versioning 2.0.0 — https://semver.org/
- Repo: `tools/ghl/client.ts` (`findWorkflow`), `tools/ghl/link-workflows.ts`, `tools/ghl/test-workflows.ts`,
  `tools/demo/provision.ts`, `tools/demo/verify.ts`, `config/schema/contact-fields.ts`,
  `config/schema/business-config.ts`, `src/prompt/custom-values.ts`, `src/core/outcome.ts`,
  `src/config/env.ts`, `prompts/CHANGELOG.md`, `docs/ghl/workflows.md`,
  `docs/ghl/environments-and-snapshots.md`, `docs/V1_IMPLEMENTATION_PLAN.md`, `docs/architecture.md`, `claude.md`.
