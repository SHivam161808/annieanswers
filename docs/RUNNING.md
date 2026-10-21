# Running the system

Plain-English guide to every moving part, how to run it, and how a plumber uses it.
GHL screen names marked ⚠ may differ slightly in your account.

## 1. What the system is made of

```
Caller ──► owner's phone (diverts when unanswered) ──► GHL UK number (+44 117 463 3467 for the demo)
                                                         │
                                                         ▼
                                         GHL Voice AI agent (the receptionist)
                       prompt from Git ──┤  speaks, listens, books with GHL's calendar
                                         │  calls our server for: open now? area covered?
                                         │  escalation decision, find / move / cancel booking
                                         ▼
                              Our middleware (this repo) + Redis
                                         │
                                         ▼
                 GHL CRM: contacts + AI fields, calendar, pipeline, workflows, SMS
                                         │
                                         ▼
                         Plumber's GHL login / mobile app, owner SMS alerts
```

| Part                                                  | Where it runs                                          | Who looks after it               |
| ----------------------------------------------------- | ------------------------------------------------------ | -------------------------------- |
| Voice AI agent, number, calendar, contacts, workflows | GHL, one **sub-account per plumbing business**         | Set up by our tools + GHL screen |
| Middleware (`src/`)                                   | This laptop (testing) → Fly.io London (production)     | Us                               |
| Redis                                                 | Local (testing) → Upstash Redis in London (production) | Us                               |
| Prompt, config, tests, docs                           | This Git repo                                          | Us                               |

## 2. Running it today (testing, on this laptop)

```bash
cd ~/Documents/annieanswer
npm ci && npm run build
node --env-file=.env dist/src/server.js     # terminal 1 — the middleware on :8080
ngrok http 8080                              # terminal 2 — public HTTPS address for GHL
npm run demo:logs                            # terminal 3 (optional) — live log with latency per action
MIDDLEWARE_URL=$(cat build/logs/public-url.txt) npx tsx tools/demo/verify.ts   # all checks must pass
```

**Keep the laptop awake and online** while anyone calls the number: if it sleeps, the agent's
postcode, escalation and booking-change actions fail mid-call. This is why production uses Cloud Run.

`.env` must contain `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `WEBHOOK_SECRETS`, `METRICS_TOKEN`,
`REDIS_URL` (see `.env.example`). It is never committed.

## 3. Running it in production (UK server, London)

1. One-time: `fly auth login` (browser; the Fly account needs a payment card), then
   `fly redis create --region lhr` and note the `rediss://` URL.
2. Put the secrets in `deploy/fly/secrets.production.env` (git-ignored), one `KEY=value` per line:
   `WEBHOOK_SECRETS`, `METRICS_TOKEN`, `REDIS_URL`, `GHL_TOKENS` (JSON: location id → token).
3. `git tag v1.1.0 && ENVIRONMENT=production VERSION=v1.1.0 deploy/fly/deploy.sh` — runs all checks,
   deploys two machines in London and waits until `/readyz` is ready.
4. Point each sub-account at it: `MIDDLEWARE_URL=https://annie-api-production.fly.dev npx tsx tools/demo/provision.ts`
   (with that sub-account's env file, see §4), then update the URL of the actions that have
   UI-added parameters in the GHL screen.
5. `MIDDLEWARE_URL=… npx tsx tools/demo/verify.ts` — must say ALL CHECKS PASSED.
6. Daily review and alerts run from GitHub Actions (`.github/workflows/call-review.yml`) once its
   secrets are set; run it by hand any time with `npm run ops:call-review -- --hours 24`.

Google Cloud Run (London) works the same way: [deploy/cloud-run.md](deploy/cloud-run.md).

### Owner SMS alerts and after-call processing

The middleware does what workflows WF-01/05/06 would do, so nothing has to be built in the GHL screen:

- **During the call:** P1/P2 escalations text the owner at once (`alert_sms_number` in the client
  config). If the text fails, the agent is told not to say the owner was alerted.
- **After the call (every minute):** each finished call gets tags (`ai-call`, `outcome-…`), AI fields,
  a card in the "AI Receptionist Enquiries" pipeline (create the pipeline once in the GHL screen), and
  the owner gets the outcome text (booked, callback, message, emergency, missing outcome).
- Each text is sent once per call. Test with your own number: put
  `ALERT_SMS_OVERRIDES='{"<location id>":"+44…"}'` in `.env` (never in Git).
- Run it by hand: `curl -X POST -H "x-annie-secret: …" <server>/v1/jobs/post-call`.

### Boiler fault-code library

`knowledge/boilers/<manufacturer>.yaml`, from official manufacturer documents only. Check with
`npm run validate:knowledge` (prints coverage per manufacturer). To withdraw an entry, set
`status: withdrawn` and redeploy. Gaps callers ask about are logged as `knowledge_gap`.

## 4. Onboarding a plumbing business (target ≤ 4 hours, configuration only)

Full runbook: [onboarding/runbook.md](onboarding/runbook.md). In short:

1. **Intake** — the plumber fills in the intake form ([onboarding/intake-form.md](onboarding/intake-form.md)).
2. **Config** — copy `config/clients/demo.yaml` to `config/clients/<client>.yaml`, fill it in,
   `npm run validate:config`, `npm run prompt:build`.
3. **Sub-account** — GHL Agency view → Sub-Accounts → create from the latest snapshot
   ([ghl/environments-and-snapshots.md](ghl/environments-and-snapshots.md)).
4. **Token** — inside the new sub-account: Settings → Private Integrations → create a token with
   the scopes listed in the runbook. Save it in `.env.<client>` with that sub-account's location id.
5. **Provision** — `ANNIE_ENV_FILE=.env.<client> MIDDLEWARE_URL=<url> npx tsx tools/demo/provision.ts`
   (creates calendar, values, fields, agent, actions; safe to re-run). Put the calendar id it
   prints into the client YAML if asked, then redeploy the middleware.
6. **GHL screen** — add the `postcode` parameter to `check_service_area` and `trigger` to
   `escalation`; build/receive workflows from the snapshot; pick a British voice.
7. **Number** — regulatory bundle → buy a local UK number → attach it to the agent
   (Deploy tab ⚠ or our tools) → the plumber sets up the divert
   ([telephony/divert-instructions.md](telephony/divert-instructions.md)).
8. **Verify** — `ANNIE_ENV_FILE=.env.<client> MIDDLEWARE_URL=<url> npx tsx tools/demo/verify.ts`,
   then the test calls in the runbook.

Off-boarding: `ANNIE_ENV_FILE=.env.<client> npx tsx tools/demo/teardown.ts --confirm <locationId>`
(keeps contact data unless `--include-fields`).

## 5. The plumber's login

Each business gets its **own GHL sub-account**; the plumber only ever sees their own business.

**Give the plumber access** ⚠

1. Agency view → open the business's sub-account → **Settings → My Staff / Team → Add Employee**.
2. Enter their name, email and mobile; role **User** (or Admin if they manage their own settings);
   restrict permissions to: Contacts, Conversations, Calendars, Opportunities, (optionally) Reporting.
   Leave Settings, Workflows, Voice AI and Phone Numbers off so nothing can be broken by accident.
3. They get an email invite. They log in at the agency's GHL web address (or white-label domain)
   and install the **LeadConnector** mobile app with the same login.

**What the plumber sees and does**

| Where (GHL / app)                             | What's there                                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contacts**                                  | Every caller, with the AI fields: issue type, urgency, summary, engineer notes, postcode, address, property type, caller role, preferred times, outcome, plus the call summary note |
| **Calendar**                                  | Bookings the receptionist made, moved or cancelled; their own Google/Outlook if synced (T2)                                                                                         |
| **Opportunities → AI Receptionist Enquiries** | Each enquiry in its stage: Booked, Awaiting confirmation, Callback needed, Emergency, Lost or cancelled                                                                             |
| **Conversations**                             | Customer SMS replies and the texts the system sent                                                                                                                                  |
| **Their phone (SMS)**                         | Owner alerts: new booking, urgent/emergency, callbacks due, booking requests to reply YES to (once the workflows are built)                                                         |
| **Voice AI call logs** ⚠                      | Recording, transcript and summary of every call                                                                                                                                     |

**What the plumber does day to day:** answer their phone as normal (missed calls divert to the
receptionist), act on alerts, ring back "Callback needed" enquiries, reply YES to booking requests
(request mode), keep their calendar up to date. Nothing else.

## 6. Keeping it healthy

| Check                                | How                                                                 | When                                 |
| ------------------------------------ | ------------------------------------------------------------------- | ------------------------------------ |
| Live deployment matches Git          | `npx tsx tools/demo/verify.ts`                                      | after every change                   |
| Booking change path works end to end | `npx tsx tools/ghl/test-booking.ts` (creates and removes test data) | after middleware or calendar changes |
| Outcome routing                      | `npx tsx tools/ghl/test-workflows.ts`                               | after workflow changes               |
| Daily call review + alerts           | `npm run ops:call-review -- --hours 24 --alert`                     | daily (scheduled)                    |
| Full test suite                      | `npm run ci` (and `npm run test:mutation` weekly)                   | every change                         |
