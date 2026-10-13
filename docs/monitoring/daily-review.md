# Daily call review and weekly improvement loop (T-1001, T-1002, T-1006)

Every pilot call is reviewed **daily** from the GHL Voice AI call log (recording, transcript,
summary, actions executed). Each fault is logged against the fixed failure-mode list below. Once a
week the log drives the fixes. (Build Plan, "Monitoring"; FR-33.)

Where to look: sub-account → Voice AI → call logs ⚠ verify screen name; the contact record for the
`ai_*` fields and tags; Opportunities → `AI Receptionist Enquiries` for the pipeline stage.
Optional automatic check on any call: export it as a transcript JSON (format in
[docs/qa/test-plan.md](../qa/test-plan.md#3-running-scenarios-as-scripted-phone-calls)) and run
`npm run score -- <dir>`; this only works for calls named after a scenario id, so for real calls
the review below is the main check.

---

## 1. Daily review — one page per day

Copy this block for each day.

```
Date:               Reviewer:              Client / sub-account:
Snapshot version:   Middleware version:

Calls today:        Reviewed:        (target: all of them)
Outcome logged:     __ / __   (target 100%; any "outcome-missing" tag = bug)
TECH_FAILURE:       __        ABANDONED: __   (spike? compare with last 7 days)
Emergencies:        __        Owner alerted for each? Y / N
Bookings:           __        Each in the calendar or confirmed by owner? Y / N
Transfers:          __        Each answered or followed by a missed-transfer SMS? Y / N
Callbacks due:      __        Any overdue against the callback promise? Y / N
Negative sentiment: __        (Voice AI dashboard)

Faults logged today: __   (one row each in the failure log)
Safety fault today?  Y / N    → if Y: stop and escalate now, don't wait for the weekly loop
Anything the client raised:
Actions for today:
```

### Per-call checklist (about 2 minutes a call)

1. Listen to the first 10 seconds: greeting correct, business name right.
2. Read the transcript. Did the agent understand the problem, ask only useful questions, and
   never ask twice for something already given?
3. Safety: if gas, CO or water near electrics came up, was the script said word for word, first?
4. Facts: any price, hour, area or policy not in the client's config or knowledge base?
5. Actions: did the call log show the actions the agent claimed ("booked", "sent an alert",
   "putting you through")? Did each succeed?
6. Close: recap, next step stated, caller knew what happens next.
7. Record: `ai_call_outcome` correct? `ai_issue_summary`, postcode and address right?
8. Any slow gap you noticed on the recording? Note the timestamp.

Anything that fails → one row in the failure log.

---

## 2. Failure log

Fixed failure-mode list — use **only** these eight codes, so faults can be counted week to week:

| Code            | Failure mode                  | Example                                                                               |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `RECOGNITION`   | Recognition error             | Heard "LS16" as "LS60"; wrong surname spelling                                        |
| `REASK`         | Re-asked detail               | Asked for the postcode after the caller already gave it                               |
| `WRONG_INTENT`  | Wrong intent                  | Treated a reschedule as a new job                                                     |
| `WRONG_URGENCY` | Wrong urgency                 | Burst pipe booked as routine; dripping tap escalated                                  |
| `ACTION_FAILED` | Action failed                 | Booking, transfer, SMS or area check errored, timed out, or was claimed but never ran |
| `LATENCY`       | Latency spike                 | Gap of more than about 2.5 s before the agent spoke                                   |
| `WRONG_INFO`    | Wrong or invented information | Gave a price not in config; said "we cover that" without an area check                |
| `POOR_CLOSE`    | Poor close                    | No recap; caller unsure what happens next; ended mid-question                         |

Severity: **S1** safety or a customer left without help (emergency not escalated, false booking) ·
**S2** wrong outcome or lost booking · **S3** quality only (caller still served).

Failure log table — keep one running file (or sheet) per client; one row per fault:

| Date | Call id | Client | Snapshot | Code | Severity | What happened (no caller personal data) | Time in call | Likely layer (L0–L4, config, KB, action, workflow, telephony) | Fixed in | Status |
| ---- | ------- | ------ | -------- | ---- | -------- | --------------------------------------- | ------------ | ------------------------------------------------------------- | -------- | ------ |
|      |         |        |          |      |          |                                         |              |                                                               |          | open   |

Rules:

- Reference calls by GHL call id only. No names, numbers, addresses or transcript quotes
  containing personal data.
- One fault per row; a call with two faults gets two rows.
- **S1 faults are not left for the weekly loop**: tell the developer and the PO the same day. If
  it's a safety fault, the client's divert can be switched off while it's fixed (see the
  [runbook rollback](../onboarding/runbook.md#rollback)).
- A config or knowledge-base fault for one client (wrong price, wrong hours) is fixed in that
  client's YAML or knowledge base, not in the universal prompt.

---

## 3. Weekly improvement loop

Once a week, same day, about an hour. Owners: reviewer, developer, PO.

1. **Review the failure log.** Count open rows by code and severity across all clients. Look for
   repeats of the same cause.
2. **Pick the top three.** Highest severity first, then most frequent. Write each as one sentence
   naming the failure code and the call ids that show it.
3. **Fix them.** In Git only — prompt layers in MASTER-DEV via provisioning, never hand-edited in
   GHL. Add or tighten a scenario in `scenarios/*.yaml` that reproduces each fault, so it can't
   come back unnoticed.
4. **Regress.** `npm run ci`, then the core 20 as phone calls on MASTER-QA, scored with
   `npm run score -- <dir>` — safety 100% and no category worse than last week
   ([test-plan.md](../qa/test-plan.md#4-core-20)).
5. **Release a new snapshot.** Cut `annie-vX.Y` per
   [environments-and-snapshots.md](../ghl/environments-and-snapshots.md), with a
   `prompts/CHANGELOG.md` entry that **names the failure fixed**, e.g.:

   ```
   ## v0.3 — 2026-10-23
   - Fixes REASK: agent re-asked postcode after an area check (calls <id>, <id>). Scenario STR002 tightened.
   - Fixes WRONG_URGENCY: ceiling leak with no electrics booked as P3 (call <id>).
   - Fixes WRONG_INFO: ...
   ```

6. **Close the rows.** Fill "Fixed in" with the snapshot version and set status `fixed`. If the
   same code comes back next week, reopen and link the earlier row.

Rule (Build Plan change control): every change names the failure it fixes, passes the core 20, and
ships only in a new snapshot.
