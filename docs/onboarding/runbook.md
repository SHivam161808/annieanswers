# Onboarding runbook — signed client to live number (T-209)

Target: **≤ 4 hours of hands-on work, configuration only** (Build Plan; AC-07, NFR-10). No prompt,
workflow or code edits. If a step seems to need one, stop and raise it — that's a product bug,
not an onboarding task.

Steps marked 🖱 are done in the GHL screen (no API). GHL screen names marked ⚠ verify are not yet
confirmed in our account; tell the developer if the screen differs.

**Owners**

| Role   | Who                                                            |
| ------ | -------------------------------------------------------------- |
| Ops    | Onboarding lead (runs the call, writes the config)             |
| Dev    | Integration engineer (env files, middleware, tools)            |
| Client | The plumber (answers, divert, test calls)                      |
| PO     | Product owner (approves anything spoken word for word, if new) |

---

## Before the clock starts (lead time, not counted in the 4 hours)

| What                                                                                                                                                                                  | Owner        | Why                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------- |
| Submit the UK number regulatory bundle as soon as the contract is signed 🖱 (LC Phone / Phone Numbers → Regulatory bundle ⚠ verify). Client supplies proof of identity and UK address. | Ops + Client | Approval has a lead time; the number can't go live without it. |
| Send the [intake form](intake-form.md) and the [knowledge base template](knowledge-base-template.md) to the client.                                                                   | Ops          | Answers ready before the call.                                 |
| Book a 30-minute intake call and a 30-minute test-call slot.                                                                                                                          | Ops          | Build Plan assumes a 30-minute setup call.                     |

---

## Steps

| #   | Step                                       | Owner        | Time           |
| --- | ------------------------------------------ | ------------ | -------------- |
| 1   | Intake call                                | Ops + Client | 30 min         |
| 2   | Write `config/clients/<client>.yaml`       | Ops          | 15 min         |
| 3   | Validate config and build the prompt       | Ops          | 5 min          |
| 4   | Create the sub-account from the snapshot 🖱 | Ops          | 15 min         |
| 5   | Private integration token + env file       | Dev          | 10 min         |
| 6   | Load the config into the middleware        | Dev          | 15 min         |
| 7   | Provision                                  | Dev          | 10 min         |
| 8   | Add UI-only action parameters 🖱            | Dev          | 10 min         |
| 9   | Link workflows                             | Dev          | 5 min          |
| 10  | Knowledge base 🖱                           | Ops          | 25 min         |
| 11  | UK number attached to the agent 🖱          | Ops          | 10 min         |
| 12  | Verify                                     | Dev          | 5 min          |
| 13  | Call divert                                | Client + Ops | 15 min         |
| 14  | Test calls                                 | Ops + Client | 40 min         |
| 15  | Go-live checklist and sign-off             | Ops          | 10 min         |
|     | **Total**                                  |              | **3 h 40 min** |

Buffer: 20 minutes. If you go past 4 hours, note which step overran in the onboarding log — it
feeds the next snapshot.

### 1. Intake call — Ops + Client, 30 min

Go through [intake-form.md](intake-form.md) Part B. Read back every word-for-word sentence
(prices, quote policy, call-back promise, cancellation policy) and get a "yes" on each. Collect the
knowledge base answers.

### 2. YAML config — Ops, 15 min

```
cp config/clients/demo.yaml config/clients/<client>.yaml
```

Fill every key from the form. Leave `ghl_location_id` as a placeholder until step 4.

### 3. Validate — Ops, 5 min

```
npm run validate:config -- config/clients/<client>.yaml
npm run prompt:build
```

Both must pass. Read `build/prompts/<client_id>/greeting.txt` out loud: it must sound natural and
fit in about four seconds (lint enforces the word budget).

### 4. Create the sub-account from the snapshot 🖱 — Ops, 15 min

Follow [docs/ghl/environments-and-snapshots.md](../ghl/environments-and-snapshots.md):

1. Agency view → **Sub-Accounts → Create Sub-Account** → load from the current release snapshot
   (`annie-vX.Y`) ⚠ verify the snapshot option on this screen. Name it `CLIENT-<name>`.
2. Timezone `Europe/London`, country `GB`.
3. Copy the location id into `ghl_location_id` in the YAML. Re-run `npm run validate:config` (it
   also rejects a location id already used by another client).

The snapshot brings the workflows WF-01…WF-13 and the `AI Receptionist Enquiries` pipeline. It
does not bring client-owned assets (custom values, knowledge base, calendar, number).

### 5. Private integration token + env file — Dev, 10 min

1. 🖱 Inside the new sub-account: Settings → **Private Integrations** → create a token with the
   same scopes as `.env` (Voice AI, contacts, custom fields/values, calendars, conversations,
   workflows view, locations view, phone numbers view).
2. Create `.env.<client>` (never committed) from `.env.example`, with at least:

   ```
   GHL_PRIVATE_TOKEN=<token from step 5.1>
   GHL_LOCATION_ID=<location id from step 4>
   WEBHOOK_SECRETS=<the production middleware secret>
   ```

   Every tool below is run with `ANNIE_ENV_FILE=.env.<client>`. The tools find the client config
   by matching `GHL_LOCATION_ID` to `ghl_location_id`.

### 6. Load the config into the middleware — Dev, 15 min

The middleware reads every YAML in `config/clients/` at startup and refuses to start if one is
invalid (decisions D3, D4). Deploy the commit containing the new YAML, then check the
middleware's `/readyz` returns 200. Put the public middleware URL in `build/logs/public-url.txt`
— `verify.ts` reads it from there.

### 7. Provision — Dev, 10 min

```
ANNIE_ENV_FILE=.env.<client> npx tsx tools/demo/provision.ts <middleware-url>
```

`<middleware-url>` must start with `https://`. Creates or updates (idempotent, safe to re-run):
calendar, L3 custom values and workflow values, the Voice AI agent (prompt + greeting), the custom
actions `call_context`, `check_service_area`, `escalation`, native `book_appointment`, the
universal contact fields and the post-call extraction actions. Ids are saved in
`build/state/<locationId>.json`.

Known gaps in the tool today (it was written for DEMO), to raise with the developer, not to patch
during an onboarding:

- The agent and calendar it creates are named `DEMO – <business_name_spoken>`. Internal only
  (callers never hear it), but rename in the screen if the client will see it.
- It always creates its own calendar from `opening_hours` and books into that; it does not read
  `calendar_id` from the YAML. For `synced_calendar`, connect the client's Google/Outlook calendar
  to that calendar 🖱 ⚠ verify. For `request_mode`, the booking action is still created.

### 8. Add UI-only action parameters 🖱 — Dev, 10 min

GHL API bug: custom actions created with parameters can't be read or updated through the API
(see [docs/ghl-capabilities.md](../ghl-capabilities.md), decision D24). So add these by hand:
Voice AI → Agents → the agent → Actions → edit ⚠ verify.

| Action               | Parameter  | Type          | Description to enter                                           |
| -------------------- | ---------- | ------------- | -------------------------------------------------------------- |
| `check_service_area` | `postcode` | text ⚠ verify | The postcode the caller gave, full or partial.                 |
| `escalation`         | `trigger`  | text ⚠ verify | One of P1, P2, P3, P4, asks_for_owner, complaint, agent_stuck. |

After this, re-running `provision.ts` prints `skip <action>: has UI-added parameters` for these
two. That is expected — it deliberately leaves them alone.

### 9. Link workflows — Dev, 5 min

```
ANNIE_ENV_FILE=.env.<client> npx tsx tools/ghl/link-workflows.ts
```

Attaches WF-01 Outcome router to call end and WF-06 Emergency escalation as the mid-call action
`alert_owner_urgent`. Every `FAIL` means a workflow is missing, misnamed or unpublished — fix it in
the screen per [docs/ghl/workflows.md](../ghl/workflows.md). Optional, if time allows (it waits
several minutes for the router):

```
ANNIE_ENV_FILE=.env.<client> npx tsx tools/ghl/test-workflows.ts
```

### 10. Knowledge base 🖱 — Ops, 25 min

Write the client's entries with [knowledge-base-template.md](knowledge-base-template.md), create the
knowledge base in the sub-account and attach it to the agent ⚠ verify screen names. Record its id
in `knowledge_base_ids` in the YAML. No tool pushes or checks the knowledge base yet.

### 11. UK number 🖱 — Ops, 10 min

1. Once the regulatory bundle is approved, buy a UK number in the sub-account (LC Phone / Phone
   Numbers ⚠ verify).
2. Attach it to the agent as its inbound number, agent answering directly (pattern A) ⚠ verify the
   setting name in the agent's phone settings.

### 12. Verify — Dev, 5 min

```
ANNIE_ENV_FILE=.env.<client> npx tsx tools/demo/verify.ts
```

Read-only. Must end `ALL CHECKS PASSED`: live prompt and greeting byte-identical to Git, safety
scripts verbatim, UK number attached, actions present with no duplicates, contact fields and
extractions present, calendar exists, middleware reachable.
Known caveat: one check asks the middleware about `M1 1AE` and expects "not covered" — it fails
falsely for a client who covers Manchester M1. Confirm by hand and note it in the log.

### 13. Call divert — Client + Ops, 15 min

Follow [docs/telephony/divert-instructions.md](../telephony/divert-instructions.md) with the client
on their own phone. Divert must point at the new GHL number, never at `transfer_number_primary`.

### 14. Test calls — Ops + Client, 40 min

Ring the client's **own** number (so the divert is tested too) and check each by ear and in the
GHL contact record. The scored regression pack runs on MASTER-QA per release
([docs/qa/test-plan.md](../qa/test-plan.md)); these calls check this client's values.

| #   | Call                                                           | Pass when                                                                                                             |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Hang on until it diverts (no answer)                           | Greeting with the right spoken name and virtual assistant notice                                                      |
| 2   | Routine job, in-area postcode, book                            | Booking appears in the calendar (or request-mode SMS reaches `alert_sms_number`); confirmation SMS; outcome field set |
| 3   | Out-of-area postcode                                           | Polite decline; never "we cover that"; outcome `OUT_OF_AREA`                                                          |
| 4   | "How much is a call-out?"                                      | Exact `pricing_statements` wording, or "{owner} will confirm" if none                                                 |
| 5   | Service in `services_not_offered`                              | Declines and signposts                                                                                                |
| 6   | "I can smell gas"                                              | Gas safety script verbatim, then escalation; owner gets the urgent alert                                              |
| 7   | "Can I speak to {owner}?" in hours (if `asks_for_owner` is on) | Transfer rings `transfer_number_primary`; if unanswered, backup then message                                          |
| 8   | Ask about something in the knowledge base                      | Short answer in the KB's wording                                                                                      |

### 15. Go-live checklist — Ops, 10 min

- [ ] `npm run validate:config` passes and the YAML is merged.
- [ ] `npm run prompt:release-check` passes (all PO approvals in place — readiness B3).
- [ ] `verify.ts` passed (caveat above noted if it applies).
- [ ] `link-workflows.ts` shows every workflow `ok`.
- [ ] Owner received an emergency alert SMS and a new-enquiry SMS during test calls.
- [ ] A transfer reached a real person on the primary number.
- [ ] Divert tested for no answer, busy and unreachable.
- [ ] Client knows how to switch the divert off (their fallback if anything goes wrong).
- [ ] Client has seen their first test enquiry in the GHL app.
- [ ] Client added to the daily review ([docs/monitoring/daily-review.md](../monitoring/daily-review.md)).
- [ ] Onboarding log: start/end time per step, anything that overran.

---

## Rollback

| Problem                                   | Action                                                                                                                                                                       | Owner  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Agent misbehaving on live calls (any)     | Client cancels the divert (instructions in the divert doc). Calls ring the client's phone as before. Fastest and safest.                                                     | Client |
| Wrong business fact after a config change | Revert the YAML commit, redeploy the middleware, re-run `provision.ts` and `verify.ts` for the client.                                                                       | Dev    |
| Bad snapshot release                      | Re-push the previous snapshot, re-run `provision.ts` from the previous Git tag, verify (per [environments-and-snapshots.md](../ghl/environments-and-snapshots.md#rollback)). | Dev    |

## Off-boarding

1. **Client** cancels the divert; ring their number to confirm it reaches them, not the agent.
2. **Ops** exports anything the client is entitled to (contacts, call history) 🖱 ⚠ verify export
   screen and the agreed retention period.
3. **Ops** detaches the number from the agent and releases it 🖱 (or arranges a port-out if the
   client keeps it) ⚠ verify.
4. **Dev** deletes the agent, actions and calendar in the sub-account 🖱 — there is no teardown
   tool in the repo yet.
5. **Dev** removes `config/clients/<client>.yaml` in a reviewed commit and redeploys the
   middleware, then runs `npm run validate:config`.
6. **Dev** revokes the sub-account's Private Integration token 🖱, deletes `.env.<client>` and
   `build/state/<locationId>.json`.
7. **Ops** suspends or deletes the sub-account 🖱 according to the contract's data terms.
