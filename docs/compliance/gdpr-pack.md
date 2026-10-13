# UK GDPR pack — AI receptionist service (Nifty T-607)

> **This is not legal advice.** It is a practical working pack written by the engineering team
> to organise what we know about the data the system handles. Every client contract, privacy
> notice and retention period must be reviewed by a qualified UK data protection adviser before
> it is used with a real customer. Anything marked **⚠ verify** is an assumption or an
> unconfirmed fact that must be checked before go-live.

Date: 2026-10-13. Companion to [V1_IMPLEMENTATION_PLAN.md](../V1_IMPLEMENTATION_PLAN.md) and
[architecture.md](../architecture.md).

---

## 1. Roles

| Party                                                                                                                                       | Role under UK GDPR                  | Why                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each plumbing business (the client, e.g. "Smith & Sons")                                                                                    | **Controller**                      | Decides why caller data is collected (to handle its enquiries and jobs) and owns the customer relationship.                                                                                                                                                                                                            |
| The agency (us — runs the GHL sub-account, prompts and middleware)                                                                          | **Processor**                       | Processes caller data only on the client's documented instructions, to provide the receptionist service.                                                                                                                                                                                                               |
| HighLevel / LeadConnector (GHL)                                                                                                             | **Sub-processor** (appointed by us) | Hosts the CRM, Voice AI agent, telephony, recordings, transcripts, workflows and SMS. HighLevel's DPA says it acts as sub-processor where its customer is itself a processor.                                                                                                                                          |
| GHL's own sub-processors: OpenAI (LLM), Twilio (communications), Google Cloud and AWS (storage), LeadConnector LLC (communications/support) | **Sub-processors of GHL** (onward)  | Named on HighLevel's published sub-processor list (all listed as United States). Which LLM, speech-to-text and text-to-speech vendors the Voice AI actually uses for our agent is **⚠ verify** — the demo agent runs GPT-4.1 (docs/ghl-capabilities.md), but the STT/TTS vendors are not named on the list we checked. |
| Middleware hosting provider (planned: GCP Cloud Run, europe-west2 London + Memorystore)                                                     | **Sub-processor** (appointed by us) | Caller data passes through the middleware in requests (postcode, call id). Currently the middleware runs on a laptop + ngrok (readiness blocker B2) — **that is not acceptable for real caller data; ngrok is then also a sub-processor ⚠ verify.**                                                                    |

Points to note:

- The agency is also a **controller** for its own business data (client contacts, billing,
  staff). That is out of scope here.
- If the agency starts using caller data for its own purposes (e.g. training prompts on
  real transcripts across clients, benchmarking), it may become a controller for that use. Do
  not do this without a written instruction/agreement from each client. **⚠ verify with adviser.**
- ICO data protection fee: whether the agency must pay it depends on its own processing as a
  controller. **⚠ verify** on the ICO fee self-assessment.

---

## 2. Data inventory

### 2.1 What the system captures about callers

| Data                                                           | Where it is stored                                                        | Source                 | Personal data?                                       | Notes                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Caller phone number (CLI)                                      | GHL contact, call log, conversations                                      | Telephony              | Yes                                                  | Used for callback, SMS confirmations.                                                                   |
| Caller name, email (if given)                                  | GHL contact standard fields                                               | Agent / caller         | Yes                                                  |                                                                                                         |
| `ai_call_outcome`                                              | GHL contact custom field                                                  | Post-call extraction   | Linked to a person                                   | One of the 15 outcome codes.                                                                            |
| `ai_issue_type`                                                | GHL contact custom field                                                  | Post-call extraction   | Linked to a person                                   | Job-type code.                                                                                          |
| `ai_urgency`                                                   | GHL contact custom field                                                  | Post-call extraction   | Linked to a person                                   | P1–P4.                                                                                                  |
| `ai_issue_summary`                                             | GHL contact custom field (large text)                                     | Post-call extraction   | Yes                                                  | Instructed to exclude phone numbers and emails.                                                         |
| `ai_job_notes`                                                 | GHL contact custom field (large text)                                     | Post-call extraction   | Yes — may contain **special category data**          | Caller's own words. Could include health or disability information (see 2.3).                           |
| `job_postcode`                                                 | GHL contact custom field                                                  | Post-call extraction   | Yes (with name/number)                               |                                                                                                         |
| `job_address`                                                  | GHL contact custom field                                                  | Post-call extraction   | Yes                                                  | First line only.                                                                                        |
| `in_service_area`                                              | GHL contact custom field                                                  | Post-call extraction   | Linked to a person                                   | yes / no / unknown.                                                                                     |
| `property_type`                                                | GHL contact custom field                                                  | Post-call extraction   | Linked to a person                                   | house / flat / commercial.                                                                              |
| `caller_role`                                                  | GHL contact custom field                                                  | Post-call extraction   | Linked to a person                                   | owner_occupier / tenant / landlord / agent.                                                             |
| `access_notes`                                                 | GHL contact custom field (large text)                                     | Post-call extraction   | Yes — may reveal when a home is empty, key locations | **Security-sensitive** (e.g. "key under the mat"). Treat as confidential; never put into SMS templates. |
| `preferred_window`                                             | GHL contact custom field                                                  | Post-call extraction   | Linked to a person                                   |                                                                                                         |
| `ai_last_call_at`, `ai_call_count`                             | GHL contact custom fields                                                 | Workflow WF-01         | Linked to a person                                   |                                                                                                         |
| Tags, pipeline stage/opportunity                               | GHL                                                                       | Workflow WF-01 router  | Linked to a person                                   |                                                                                                         |
| Appointments                                                   | GHL calendar (T1); mirrored to the owner's Google/Microsoft calendar (T2) | Native booking action  | Yes                                                  | T2 means data also sits with Google or Microsoft under **the client's** own account and terms.          |
| Call recording (audio)                                         | GHL Voice AI call log                                                     | GHL                    | Yes (voice, everything said)                         | Retention period and deletion controls in GHL **⚠ verify**.                                             |
| Transcript (`human:` / `bot:` text)                            | GHL Voice AI call log                                                     | GHL                    | Yes                                                  | Same.                                                                                                   |
| Call summary, sentiment, actions executed                      | GHL Voice AI call log                                                     | GHL                    | Yes                                                  |                                                                                                         |
| SMS messages (confirmations, reminders, owner alerts, replies) | GHL Conversations                                                         | Workflows WF-02..WF-13 | Yes                                                  | Owner alert SMS contains first name, postcode, summary — goes to the owner's own phone.                 |
| Owner/staff transfer and alert numbers                         | Client YAML in Git, GHL custom values                                     | Onboarding             | Yes (business contacts, often personal mobiles)      | `transfer_number_primary`, `transfer_number_backup`, `alert_sms_number`.                                |

The universal contact fields are defined in
[`config/schema/contact-fields.ts`](../../config/schema/contact-fields.ts).

### 2.2 What the middleware holds (by design: no caller PII at rest)

| Data                                                                                                                                | Where                            | Retention                                                                               | Notes                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured logs: `correlation_id`, `ghl_call_id`, `location_id`, `action`, `route`, `status`, `latency_ms`, `outcome`, `error_code` | Log sink of the hosting platform | Per log-sink setting **⚠ set and record**                                               | Bodies never logged; redact list covers phone, name, email, address, postcode, transcript, notes (`src/observability/logger.ts`). Postcode appears only as district (e.g. `LS6`) where logged. |
| Metrics (latency histograms, counters)                                                                                              | `/metrics` (Prometheus)          | Per metrics backend                                                                     | No personal data.                                                                                                                                                                              |
| Redis: rate-limit buckets, idempotency keys                                                                                         | Redis (planned UK region)        | Rate-limit: seconds/minutes. Idempotency results: 24 h TTL (`src/store/idempotency.ts`) | Current live actions are read-only and do not store results. **If a booking adapter is built, stored idempotency results may contain booking details → review before enabling.**               |
| Client business configuration                                                                                                       | `config/clients/*.yaml` in Git   | Life of contract + 6 years (proposal)                                                   | Contains owner first name and phone numbers (business contacts).                                                                                                                               |

Known gap to check:

- **⚠ verify:** custom actions are **GET** requests (decision D24), so the caller's postcode
  travels in the **URL query string**. Our logger does not log it, but the hosting platform's
  request logs (Cloud Run request logs, any load balancer, ngrok) may record the full URL.
  Either disable/trim URL query logging on the platform or set a short retention on those logs.
  A postcode plus a timestamp and call id is personal data once joined with the GHL record.

### 2.3 Special category and sensitive data

- The vulnerable-household rule (`prompts/L2-trades/plumbing.md`) means callers may mention that
  someone at home is elderly, disabled, unwell or a young child. Health and disability
  information is **special category data** (UK GDPR Article 9) and needs an Article 9 condition
  as well as an Article 6 basis. **⚠ verify with adviser** which condition applies (candidates
  sometimes cited: vital interests where the person cannot consent; a DPA 2018 Schedule 1
  substantial public interest condition such as safeguarding). Practical minimisation: the
  extractor should record that a vulnerable person is present and the effect on urgency, not
  the medical detail. **Proposed change (not made here):** tighten the `ai_job_notes`
  extraction wording to exclude health details beyond "vulnerable person at home".
- Access notes (keys, empty property times, pets) are not special category but are high
  impact if leaked. Keep them out of SMS and out of any export to third parties unless needed.
- Children: the service is not aimed at children; if a child calls, the agent handles it like
  any caller. No age verification. **⚠ verify** whether any extra step is wanted.

---

## 3. Lawful basis analysis

| Processing                                                                                               | Proposed Article 6 basis                                                                                                        | Reasoning                                                                                                | Notes                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Answering the call, capturing problem, address, contact details, booking or taking a request             | **Contract — steps at the request of the data subject before entering a contract** (Art 6(1)(b))                                | The caller asks for a plumber; we take what is needed to quote or book.                                  | Applies where the caller is the person who will contract (owner-occupier, or landlord). For tenants/letting agents calling about someone else's property, use legitimate interests.                                          |
| Same, where (b) does not fit (tenant, agent, third party, general enquiry)                               | **Legitimate interests** (Art 6(1)(f))                                                                                          | The business's interest in handling enquiries and jobs; the caller expects it.                           | Document a legitimate interests assessment (LIA) — template outline in 3.1.                                                                                                                                                  |
| Call recording and transcript                                                                            | **Legitimate interests**                                                                                                        | Quality, dispute resolution, safety audit (the safety scripts must be provably spoken), fixing failures. | Callers must be told (greeting notice). Consent is not the proposed basis — it would have to be freely given and withdrawable mid-call, which is impractical. **⚠ verify.**                                                  |
| Emergency escalation (gas/CO/water on electrics)                                                         | Legitimate interests; possibly **vital interests** (Art 6(1)(d)) in a genuine danger-to-life case                               | Protecting people from harm.                                                                             |                                                                                                                                                                                                                              |
| Transactional SMS (confirmation, reminder, reschedule, request-mode confirmation, missed-call text-back) | Contract / legitimate interests                                                                                                 | Service messages about the caller's own enquiry.                                                         | **No marketing consent needed for pure service messages**, but they must contain no promotional content — the ICO treats a message with any promotional element as direct marketing.                                         |
| Owner alerts and daily digest                                                                            | Legitimate interests                                                                                                            | Passing the enquiry to the business that will do the job.                                                |                                                                                                                                                                                                                              |
| Marketing SMS / email (offers, reviews requests with promotion, newsletters)                             | **Not in V1.** Would need PECR-compliant consent (or the soft opt-in for the business's own customers, **⚠ verify** conditions) | PECR regulation 22 applies to unsolicited electronic marketing; a GDPR lawful basis alone is not enough. | The Build Plan and `ghl/sms-templates.yaml` already require transactional-only SMS. Review requests: **⚠ verify** whether a plain "how did we do?" link counts as marketing under the current ICO direct marketing guidance. |
| Agency QA review of calls (daily call review, regression fixes)                                          | Processing on the controller's instruction (part of the service)                                                                | Covered in the DPA as a service purpose.                                                                 | Keep reviewer access minimal; no copies outside GHL.                                                                                                                                                                         |

### 3.1 Legitimate interests assessment — outline (one per client, can be shared)

1. **Purpose test:** what interest (handling enquiries, quality, safety evidence) and who benefits.
2. **Necessity test:** could it be done with less data? (e.g. recording: is a transcript enough?)
3. **Balancing test:** caller expectations (people expect a business to record what they ask
   for; they are told about recording), impact, vulnerable callers, safeguards (access control,
   retention limits, no marketing use).
4. Outcome and review date.

---

## 4. Transparency

### 4.1 Spoken notice on the call

The current draft greeting (`prompts/greeting.md`, not yet PO-approved — readiness blocker B3):

> "{business_name_spoken}, virtual assistant speaking. Calls are recorded. How can I help?"

Considerations:

- A recording notice is also needed under the Investigatory Powers (Interception by Businesses
  etc. for Monitoring and Record-keeping Purposes) Regulations 2018 (reasonable efforts to tell
  users). Wording options, objection handling and the GHL "Play Call Recording Message" setting
  are covered in [docs/telephony/recording-and-retention.md](../telephony/recording-and-retention.md) §2.
- It tells the caller they are speaking to an AI and that the call is recorded — the two most
  important facts up front, inside the ~4-second / 13-word greeting budget (D16).
- It does not give the full Article 13 information; that is acceptable only if the full notice
  is easily available elsewhere (layered approach). **⚠ verify** with adviser whether a
  pointer is needed, e.g. an optional phrase the agent can say if asked: "Our privacy notice is
  on our website, or I can ask {owner} to text you a link."
- The agent must answer truthfully if asked "Are you recording this?" or "Is this a robot?"
  (L0 guardrail already covers admitting it is AI).
- If a caller objects to recording, the options are: transfer to the owner (if available),
  take a message and end the call, or offer a callback. GHL may not support stopping a recording
  mid-call **⚠ verify**. Do not promise "I've stopped recording" unless it is true.

### 4.2 Privacy notice wording — template for the client's website

> Replace everything in [brackets]. Have it reviewed before publishing.

---

**How we handle your information when you call us**

**Who we are.** [Business legal name], [address], is responsible (the "controller") for the
personal information described here. Contact us at [email] or [phone] about anything in this
notice.

**Our phone assistant.** When you call [business name] your call may be answered by our virtual
(AI) assistant, which is provided for us by [agency name] using the HighLevel platform. Calls
answered by the assistant are recorded and transcribed.

**What we collect.** Your name, phone number, email (if you give it), the address and postcode
of the job, details of the problem and any access information you give us, the times that suit
you, the call recording and transcript, and a short summary of the call. If you tell us that
someone in the property is vulnerable, we note this so we can prioritise the job.

**Why we use it and our legal basis.**

- To deal with your enquiry, book or arrange a visit, and contact you about it — because you
  asked us to (steps before entering a contract), or in our legitimate interest in responding
  to enquiries.
- To send you text messages about your enquiry or appointment (confirmations, reminders,
  changes). These are service messages, not marketing.
- To keep a record of the call to check quality, resolve disputes and show that safety advice
  was given correctly — in our legitimate interests.
- In an emergency, to alert us or put you through to an engineer straight away.

We do not use your information for marketing unless you have separately agreed to it.

**Who we share it with.** Our service providers who run the phone assistant and our customer
records: [agency name], HighLevel (our CRM and phone platform) and their providers, which
include AI, telephony and cloud hosting companies. [If T2: our calendar provider (Google /
Microsoft).] They act only on our instructions.

**International transfers.** Some of these providers process data in the United States. Where
they do, the transfer is protected by [the UK–US data bridge / the UK International Data
Transfer Addendum to the EU Standard Contractual Clauses / the IDTA — ⚠ verify per provider].

**How long we keep it.** Call recordings and transcripts: [X] days. Enquiry records that did not
become a job: [X] months. Customer and job records: [X] years after the job, for accounts and
warranty purposes. [See our retention schedule / adjust to the agreed schedule.]

**Your rights.** You can ask for a copy of your information, ask us to correct it, delete it,
restrict or object to how we use it, and in some cases ask for it to be transferred. Contact
us at [email]. We will reply within one month.

**Complaints.** If you are unhappy with how we have used your information, please tell us first
at [email] and we will investigate. You can also complain to the Information Commissioner's
Office (ICO): ico.org.uk, 0303 123 1113.

Last updated: [date].

---

Note: the Data (Use and Access) Act 2025 adds a statutory duty for controllers to handle data
protection complaints (new s.164A DPA 2018, reported in force from **19 June 2026**), including
telling people about the right to complain in privacy notices and acknowledging complaints
within 30 days. **⚠ verify** current ICO guidance; the template above includes a complaints line
for this reason.

---

## 5. Retention schedule — **PROPOSAL ONLY**

> These periods are a starting proposal for discussion with each client and their adviser. They
> are not recommendations backed by law. The controller (client) decides. GHL's ability to apply
> automatic deletion to each item is **⚠ verify**.
>
> Kept consistent with the operator-facing schedule in
> [docs/telephony/recording-and-retention.md](../telephony/recording-and-retention.md) §4 — if
> one changes, change both.

| Data                                                                                                                             | Proposed period                                                           | Reason                                                                                                              | How (GHL / ours)                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Call recordings (audio)                                                                                                          | **90 days**                                                               | Long enough for daily review, disputes about what was said, and safety audit; audio is the most intrusive item.     | GHL Voice AI call-log retention setting **⚠ verify exists**; else scheduled deletion via API (**⚠ verify endpoint**) or manual monthly purge. |
| Transcripts and call summaries in the call log                                                                                   | **90 days**                                                               | Same purpose as the recording; key facts are already copied to contact fields.                                      | Same as above.                                                                                                                                |
| **Hold:** complaint, dispute, safety incident or rights request in progress                                                      | Keep the relevant recording/transcript until resolved, then **12 months** | Evidence. Record the hold and its end date.                                                                         | Manual.                                                                                                                                       |
| Enquiry contacts that never became a job (INFO_ONLY, OUT_OF_AREA, OUT_OF_SCOPE, ABANDONED, CALLBACK_REQUESTED with no follow-up) | **12 months** from last contact                                           | Repeat callers, follow-up of missed enquiries.                                                                      | Workflow/smart list on `ai_last_call_at` older than 12 months → delete contact **⚠ verify** bulk delete flow.                                 |
| NON_CUSTOMER (spam, sales, wrong number)                                                                                         | **30 days**                                                               | No business need.                                                                                                   | Smart list on tag + date.                                                                                                                     |
| Customers with a job (booked/completed)                                                                                          | **6 years after last job**                                                | Typical UK limitation period for contract claims and accounting records; client's own policy prevails. **⚠ verify** | Client's job records may live outside GHL; GHL copy can be shorter.                                                                           |
| SMS conversation history                                                                                                         | Same as the contact it belongs to                                         |                                                                                                                     | Deleted with the contact **⚠ verify** that deleting a contact deletes conversations.                                                          |
| T2 mirrored calendar events                                                                                                      | Client's own Google/Microsoft retention                                   | Outside our control.                                                                                                | Tell the client in the DPA.                                                                                                                   |
| Middleware application logs (no PII)                                                                                             | **30 days**                                                               | Incident investigation.                                                                                             | Log sink retention setting.                                                                                                                   |
| Hosting platform request logs (may contain postcode in URL — see 2.2)                                                            | **7 days**, or disable query-string logging                               | Minimisation.                                                                                                       | Platform setting **⚠ verify**.                                                                                                                |
| Redis keys                                                                                                                       | Minutes to 24 h (TTL)                                                     | Rate limiting / idempotency.                                                                                        | Already enforced by TTL.                                                                                                                      |
| Data after the client contract ends                                                                                              | Return/export then delete within **30 days** (proposal)                   | Article 28(3)(g).                                                                                                   | Export contacts + delete sub-account; GHL deletion of backups is "as soon as reasonably practicable" per its DPA.                             |
| Test/QA recordings made by the team (MASTER-QA, harness)                                                                         | **Until the next release + 30 days**                                      | Release evidence.                                                                                                   | Use team members or fictional data only; never real customers.                                                                                |

---

## 6. Data subject requests (access, erasure, rectification)

**Who handles them:** the client (controller) owns the response. The agency (processor) must
help (Article 28(3)(e)). Most requests will arrive at the business (phone, SMS, email) — the
client forwards them to the agency's single address [dsr@agency — set up] within 2 working days (proposal). If a request comes
to the agency directly, forward it to the client the same working day and do not respond to
the person without the client's instruction.

**Deadline:** one month from receipt (extendable by two further months for complex or multiple
requests, with notice to the person within the first month). The DUAA 2025 adds a "reasonable
and proportionate search" standard and a "stop the clock" while verifying identity or
clarifying **⚠ verify** commencement date and current ICO wording.

### 6.1 Common steps

1. Log the request (date received, channel, client, request type, deadline) in the DSR log.
2. **Verify identity** proportionately: e.g. text a code to the phone number on the contact
   record; never disclose data to a different number than the one on file.
3. Locate the person in the client's GHL sub-account: search Contacts by phone number (E.164
   and national format), name, email; check for duplicates (the same caller may have several
   contacts if they called from different numbers).
4. Check other places: Voice AI call logs (filter by contact / number **⚠ verify filter**),
   Conversations (SMS), calendar appointments, opportunities, and — for T2 — the owner's
   Google/Microsoft calendar (client must search that themselves).
5. Middleware: confirm there is nothing to retrieve (no PII stored). If a booking adapter is
   later built, check idempotency results in Redis (24 h TTL).
6. Respond via the client, record what was done, close the log entry.

### 6.2 Access (Article 15)

- Export the contact record including custom fields (GHL Contacts → select → Export; **⚠ verify**
  whether custom fields are included and whether a single-contact export exists).
- Download call recordings and transcripts from the Voice AI call log (**⚠ verify** download
  option per call, or via the call-log API: the plan lists "call logs list/get" as documented by
  GHL).
- Copy the SMS conversation thread.
- Redact third-party data (e.g. names of other people mentioned) before release.
- Include the supplementary information (purposes, recipients, retention, rights, source).

### 6.3 Rectification (Article 16)

- Correct the standard field or the relevant custom field (`job_address`, `job_postcode`, etc.)
  on the contact in GHL. The extracted fields are overwritten after each call, so a correction
  can be undone by the next call's extraction — note it in `ai_job_notes`/a contact note and
  tell the owner.
- Recordings and transcripts are records of what was said and are not "corrected"; add a note
  instead.

### 6.4 Erasure (Article 17)

- Check whether an exception applies (e.g. an open job, a dispute, accounting records for a
  completed job). If so, explain to the person what is kept and why.
- Otherwise in the client sub-account:
  1. Delete Voice AI call logs/recordings for the contact (**⚠ verify** whether GHL allows
     per-call deletion, and whether deleting the contact deletes its call logs).
  2. Delete calendar appointments (T1) — and ask the client to remove mirrored events in
     Google/Microsoft (T2).
  3. Delete the opportunity, then the contact (Contacts → contact → Delete). **⚠ verify** what
     is cascaded (conversations, notes, tasks, call logs).
  4. If data may persist with HighLevel beyond what the UI deletes (e.g. backups, sub-processor
     copies), submit HighLevel's **Data Deletion Requests form** linked from its "GDPR Compliance
     and Data Privacy" help article.
  5. Suppress: if the person must not be re-contacted, keep a minimal suppression entry (number
     only, "do not contact") — **⚠ verify** lawful basis with adviser; deleting everything means
     they may be added again on their next call.
- Middleware: nothing to delete (by design). Logs hold call ids only.
- Note: a caller who rings again after erasure creates a new record — that is expected.

### 6.5 Objection / restriction

- Objection to recording: there is no per-caller "don't record" switch known in GHL Voice AI
  **⚠ verify**. Offer to delete the recording after the call and handle future calls by
  transfer/callback where possible.

---

## 7. International transfers

- HighLevel's sub-processor list names Google Cloud, AWS, OpenAI, Twilio and LeadConnector,
  all located in the **United States**. Caller data in GHL should therefore be assumed to be
  processed in the US. No UK/EU data residency option for GHL was found **⚠ verify**.
- HighLevel's DPA (as read on 2026-10-13) relies, for UK transfers, on the **EU Standard
  Contractual Clauses with the UK International Data Transfer Addendum**, and states HighLevel
  is certified to the **UK Extension to the EU–US Data Privacy Framework** (the "UK–US data
  bridge"). **⚠ verify** the current DPF participant record and that the UK extension is
  active, and confirm the DPA version the agency has accepted.
- The agency → HighLevel transfer is a restricted transfer by the agency (as processor) on the
  client's instructions; the client must authorise it in the DPA. **⚠ verify** whether a
  transfer risk assessment (TRA) is needed when relying on the data bridge (generally not for
  data-bridge transfers; needed for IDTA/Addendum) — follow current ICO guidance.
- **LLM / speech providers:** OpenAI appears as a GHL sub-processor; the transfer is covered
  by GHL's onward contracts, not by us directly. Questions to put to HighLevel **⚠ verify**:
  - Which STT, TTS and LLM vendors process Voice AI calls for UK sub-accounts?
  - Do those vendors retain audio/text, and for how long? Is data used for model training?
    (Expectation: zero/limited retention via API terms; must be confirmed in writing.)
- **Middleware:** host in a UK region (europe-west2) — no restricted transfer for the
  middleware itself. Until B2 is fixed, the laptop + ngrok path routes data through ngrok
  (location **⚠ verify**): do not run real customer calls through it.
- **T2 calendars:** Google/Microsoft processing is under the client's own account terms.

---

## 8. Client DPA — template outline (UK GDPR Article 28)

> Outline only; the full text must be drafted or reviewed by a lawyer. Headings follow
> Article 28(3) plus usual commercial terms.

1. **Parties and roles** — client = controller, agency = processor.
2. **Subject matter and duration** — AI receptionist service; for the term of the service
   agreement plus the return/deletion period.
3. **Nature and purpose** — answering calls, qualifying enquiries, booking/requesting
   appointments, sending transactional SMS, alerting the owner, call quality review.
4. **Types of personal data** — section 2.1 inventory (contact details, job address, problem
   description, access notes, recordings, transcripts, SMS); possible special category
   data (health/vulnerability) and how it is minimised.
5. **Categories of data subjects** — callers (customers, prospective customers, tenants,
   landlords, agents, wrong numbers), the client's staff whose numbers are used for transfers.
6. **Controller's obligations** — lawful basis, privacy notice on its website, approving the
   recording notice and SMS templates, decisions on DSRs and retention.
7. **Art 28(3)(a) Documented instructions** — the service description, the client config
   (YAML) and written change requests are the instructions; processor tells the controller if
   an instruction appears unlawful.
8. **Art 28(3)(b) Confidentiality** — staff and contractors bound by confidentiality.
9. **Art 28(3)(c) Security (Article 32)** — summary of measures: GHL role-based access, MFA
   on agency GHL logins **⚠ verify enforced**, secrets in environment only, shared-secret
   auth on middleware, no PII in logs, UK hosting for middleware, TLS, rate limits, audit log.
10. **Art 28(2), 28(3)(d), 28(4) Sub-processors** — general written authorisation for the
    listed sub-processors (HighLevel and its list; hosting provider); notice of changes with a
    right to object (align to HighLevel's 30-day notice period so we can pass it on); flow-down
    of equivalent terms; processor remains liable.
11. **Art 28(3)(e) Assistance with data subject rights** — section 6 process, turnaround
    (e.g. 5 working days to supply data to the controller).
12. **Art 28(3)(f) Assistance with Articles 32–36** — security, breach notification, DPIA
    support, prior consultation.
13. **Breach notification to controller** — without undue delay; contractual target e.g.
    **within 48 hours** of becoming aware (proposal — must sit inside the controller's 72 h;
    HighLevel only commits to 72 h to us, so be realistic).
14. **Art 28(3)(g) Return or deletion at end** — export then delete within 30 days (proposal).
15. **Art 28(3)(h) Audit and information** — provide information, allow audits on notice;
    may rely on HighLevel's certifications/reports for the sub-processor layer.
16. **International transfers** — authorisation for US processing via HighLevel with the
    mechanism in section 7.
17. **Liability and indemnity, term, governing law (England and Wales)** — commercial terms.
18. **Annexes** — A: processing details (items 2–5); B: security measures; C: sub-processor
    list; D: retention schedule agreed with this client.

---

## 9. Breach handling

A personal data breach is any security incident leading to accidental or unlawful destruction,
loss, alteration, unauthorised disclosure of, or access to, personal data — e.g. an SMS with
caller details sent to the wrong number, a recording link shared publicly, a compromised GHL
login, a misconfigured workflow sending owner alerts to another client.

| Step                                                                                                                                                                                                   | Who                        | When                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Contain: revoke tokens/sessions, disable the workflow or action, rotate the middleware secret, pause the agent if needed (fallback WF-11 still answers).                                            | On-call engineer           | Immediately                                                                              |
| 2. Record in the breach log: what, when found, data and people affected, cause. Every breach is recorded, even if not reported.                                                                        | Engineer                   | Same day                                                                                 |
| 3. **Notify the affected client(s) (controller)** without undue delay with what is known so far; follow up as facts emerge.                                                                            | Agency lead                | Contract target (proposal 48 h), never later than needed for the client to meet its 72 h |
| 4. If HighLevel is the source, request their incident details (their DPA: notice to us within 72 h).                                                                                                   | Agency lead                | On awareness                                                                             |
| 5. Risk assessment with the client: likely risk to people's rights and freedoms? (access notes, vulnerability data and recordings raise the risk.)                                                     | Client with agency support | Within 72 h clock                                                                        |
| 6. **Client reports to the ICO within 72 hours of becoming aware** unless the breach is unlikely to result in a risk; reasons must be given if late; an initial report can be followed by more detail. | Client (controller)        | ≤ 72 h                                                                                   |
| 7. If high risk to individuals: client tells affected people without undue delay.                                                                                                                      | Client                     | Without undue delay                                                                      |
| 8. Fix, regress, document lessons (same change-control as prompts: changelog names the failure fixed).                                                                                                 | Engineering                | After containment                                                                        |

The processor does not report to the ICO on the client's behalf unless the client asks it to.

---

## 10. Checklist (per client, before go-live)

- [ ] DPA signed with the client (section 8), annexes completed.
- [ ] Agency has accepted HighLevel's current DPA; sub-processor list reviewed and subscribed
      to updates.
- [ ] Questions to HighLevel answered in writing: STT/TTS/LLM vendors, their retention, training
      use, data location (section 7). **⚠ open**
- [ ] UK–US data bridge / transfer mechanism confirmed and recorded.
- [ ] Middleware hosted in UK region (blocker B2 closed); no real calls via laptop/ngrok.
- [ ] Platform request-log retention set or query strings excluded (section 2.2).
- [ ] Recording notice approved by PO and client (blocker B3); greeting live.
- [ ] Client privacy notice published on its website with the AI/recording section (4.2).
- [ ] LIA completed for enquiry handling and recording (3.1).
- [ ] Special category data decision made and `ai_job_notes` extraction wording reviewed (2.3).
- [ ] Retention schedule agreed with client and configured where GHL allows (section 5).
- [ ] SMS templates confirmed transactional only, no promotional content (FR-31).
- [ ] `access_notes` never used in SMS templates.
- [ ] DSR mailbox set up; DSR log created; team knows the GHL steps (section 6).
- [ ] Breach log and contact list (client, HighLevel support) ready (section 9).
- [ ] Record of processing activities (Article 30(2), processor's record) updated with this client.
- [ ] GHL user access reviewed: only named staff, MFA on.
- [ ] Complaints handling process in place for the client (DUAA 2025, s.164A) **⚠ verify**.
- [ ] DPIA considered: new technology (AI) + recordings + possible vulnerability data may make a
      DPIA advisable or required **⚠ verify with adviser**.

---

## Sources

Checked 2026-10-13. Secondary sources are commentary; confirm against ICO / legislation.

- HighLevel — Customer Data Processing Addendum: https://www.gohighlevel.com/data-processing-agreement
- HighLevel — Sub-processors: https://www.gohighlevel.com/sub-processors
- HighLevel — GDPR Compliance and Data Privacy (links DPA, sub-processors, Data Deletion Requests form, DPF certification): https://help.gohighlevel.com/support/solutions/articles/48001210915-gdpr-compliance-and-data-privacy
- ICO — Direct marketing and the public sector (service messages vs marketing): https://ico.org.uk/for-organisations/direct-marketing-and-the-public-sector
- Hogan Lovells — ICO guidance on direct marketing using electronic mail and live calls: https://www.hlc.com/en/publications/new-ico-guidance-on-direct-marketing-using-electronic-mail-and-live-calls
- Burges Salmon — ICO updated guidance on direct email marketing: https://burges-salmon.com/news-and-insight/legal-updates/ico-issues-updated-guidance-on-direct-email-marketing
- Bates Wells — ICO Direct Marketing Code commentary: https://bateswells.co.uk/?p=1822
- Law Society — When do I have to report a data breach?: https://www.lawsociety.org.uk/Contact-or-visit-us/Helplines/Practice-advice-service/Q-and-As/When-do-I-have-to-report-a-data-breach
- Linklaters — Data breaches under the GDPR: five key questions: https://www.linklaters.com/en/insights/blogs/digilinks/data-breaches-under-the-gdpr-five-key-questions
- ICAEW — Personal data breaches know-how: https://icaew.com/-/media/corporate/files/technical/ethics/information-law-and-guidance/gdpr/personal-data-breaches-know-how.ashx
- RPC — ICO guidance on contracts and liabilities between controllers and processors: https://www.rpclegal.com/snapshots/data-protection/ico-guidance-on-contracts-and-liabilities-between-controllers-and-processors/
- Mondaq — ICO guidance on GDPR data processing contracts: https://mondaq.com/uk/data-protection/765564/new-guidance-on-gdpr-data-processing-contracts-published-by-the-uk-ico
- Sprintlaw — ICO IDTA: how to handle international data transfers: https://www.sprintlaw.co.uk/articles/ico-idta-how-to-handle-international-data-transfers
- URM Consulting — UK International Data Transfer Agreement: https://www.urmconsulting.com/blog/uk-international-data-transfer-agreement
- CMS — DUAA 2025: complaints handling from 19 June 2026: https://cms.law/en/gbr/legal-updates/data-use-and-access-act-2025-new-statutory-rules-on-handling-data-protection-complaints-from-19th-june-2026
- Mayer Brown — Preparing for the DUAA 2025 complaints procedure: https://www.mayerbrown.com/en/insights/publications/2026/02/preparing-for-the-data-use-and-access-act-2025-upcoming-complaints-procedure-requirement
- Kennedys — DUAA 2025 commencement dates and planned guidance for 2026: https://www.kennedyslaw.com/en/thought-leadership/article/2026/the-data-use-and-access-act-2025-commencement-dates-and-planned-guidance-for-2026
- Doyle Clayton — SAR timescales (ICO update): https://www.doyleclayton.co.uk/resources/news/timescales-responding-data-subject-access-requests-information-commissioner-updates-guidance
- Investigatory Powers (Interception by Businesses etc.) Regulations 2018, reg. 4: https://www.legislation.gov.uk/uksi/2018/356
- Jisc — GDPR and recording phone calls (legitimate interests): https://regulatorydevelopments.jiscinvolve.org/wp/2017/08/29/gdpr-recording-phone-calls/
- Internal: `config/schema/contact-fields.ts`, `src/observability/logger.ts`, `src/store/idempotency.ts`, `prompts/greeting.md`, `prompts/L2-trades/plumbing.md`, `ghl/sms-templates.yaml`, `docs/ghl-capabilities.md`, `docs/v1-readiness.md`.

Not yet checked against primary ICO pages (do this before relying on them): ICO lawful basis
and legitimate interests guidance, ICO right of access and right to erasure pages, ICO
international transfers and TRA guidance, ICO personal data breach guidance, ICO DPIA screening
list, ICO data protection fee self-assessment.
