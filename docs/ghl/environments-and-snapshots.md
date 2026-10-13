# Environments and snapshots — runbook (T-103, T-114, T-115)

Build Plan model: change only in MASTER-DEV → snapshot `vX.Y` → load into MASTER-QA → pass
regression → push to clients. GHL has no API to create snapshots, so steps marked 🖱 are done in the
GHL screen; everything else is a command.

| Sub-account                                 | Role                                                                | What may change there                                    |
| ------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| **AnnieAnswers** (acts as MASTER-DEV today) | Build environment                                                   | prompts (via `provision.ts`), workflows, fields, actions |
| MASTER-QA                                   | Loaded from each snapshot; regression runs here; own UK test number | nothing by hand                                          |
| DEMO                                        | Fictional plumber for sales demos                                   | config values only                                       |
| CLIENT-&lt;name&gt;                         | One per paying business                                             | config values, knowledge base, calendar, number only     |

Each sub-account has its **own** Private Integration token and env file (never committed):

```
.env        → AnnieAnswers / MASTER-DEV
.env.qa     → MASTER-QA
.env.demo   → DEMO
```

and its **own** client config in `config/clients/` whose `ghl_location_id` matches.

## 1. Create MASTER-QA and DEMO (T-103) 🖱

1. Agency view → **Sub-Accounts → Create Sub-Account** → blank → name `MASTER-QA` (repeat for `DEMO`).
2. Inside each: Settings → **Private Integrations** → create a token with the same scopes as `.env`
   (Voice AI, contacts, custom fields/values, calendars, conversations, workflows view, locations
   view, phone numbers view). Put it in `.env.qa` / `.env.demo` with that sub-account's location id.
3. Add a client config for it (copy `config/clients/demo.yaml`, change `client_id` and
   `ghl_location_id`), then `npm run validate:config`.

## 2. Cut a snapshot (T-114) 🖱

1. Make sure MASTER-DEV is green: `npm run ci` and `npx tsx tools/demo/verify.ts`.
2. Agency view → **Account Snapshots → Create New Snapshot** → source sub-account AnnieAnswers →
   name `annie-v0.1` (semver; must match `RELEASE_VERSION` and the prompt CHANGELOG entry).
3. Record it in `prompts/CHANGELOG.md`: version, date, what changed, which failure it fixes.

## 3. Load into MASTER-QA and test (T-114)

1. 🖱 Agency view → Account Snapshots → `annie-v0.1` → **Push / Load to sub-account** → MASTER-QA.
2. Configure and verify by command:

   ```
   ANNIE_ENV_FILE=.env.qa npx tsx tools/demo/provision.ts <middleware-url>
   ANNIE_ENV_FILE=.env.qa npx tsx tools/ghl/link-workflows.ts
   ANNIE_ENV_FILE=.env.qa npx tsx tools/demo/verify.ts
   ANNIE_ENV_FILE=.env.qa npx tsx tools/ghl/test-workflows.ts
   ```

3. Check (spike item V10): client-owned assets — custom values, knowledge base, calendars — are
   **not overwritten** by a snapshot push. Change one value in QA, push the snapshot again, confirm
   it survived. Record the result in `docs/ghl-capabilities.md`.
4. Run the real-call regression (core 20) against MASTER-QA's number and score with
   `npm run score -- <transcripts>`. Safety category must be 100%.

## 4. Release v1.0 (T-115)

Only when: CI green, MASTER-QA verify + workflow test green, core-20 real calls pass (safety 100%),
`npm run prompt:release-check` passes (all PO approvals in place).

1. 🖱 Create snapshot `annie-v1.0` from MASTER-DEV.
2. Release notes in `prompts/CHANGELOG.md`.
3. Push to client sub-accounts, then per client:
   `ANNIE_ENV_FILE=.env.<client> npx tsx tools/demo/verify.ts`.

## Rollback

Re-push the previous snapshot, re-run `provision.ts` from the previous Git tag, verify.
