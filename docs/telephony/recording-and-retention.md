# Call recording notice and data retention (T-113)

Practical guidance for operators. **This is not legal advice.** Each client business is the
controller of its callers' data and must be happy with this set-up. Where a point needs a data
protection adviser, it says so. Anything marked **⚠ verify** has not been confirmed in our GHL
account or against current guidance.

> Note on the task ID: in the Build Plan PDF, T-113 is the check that snapshot pushes do not
> overwrite client-owned assets (`docs/ghl/environments-and-snapshots.md` §3). This page uses T-113
> as given in the task board. Check which is correct.

Status: **PROPOSAL.** The recording notice wording (release blocker B3 in `docs/v1-readiness.md`)
and the retention periods in section 4 need approval from the **product owner** and from **each
client**.

---

## 1. What is recorded and where it lives

| Data                                                                                                                                                                                | Where                                                                                                   | Who can see it                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Call audio (recording)                                                                                                                                                              | GHL: Voice AI call log of the client's sub-account; possibly also the contact's conversation (⚠ verify) | Sub-account users; agency staff with access |
| Transcript (`human:` / `bot:` text), call summary, actions executed                                                                                                                 | GHL Voice AI call log (verified: transcript and actions present, `docs/ghl-capabilities.md`)            | as above                                    |
| Contact record: name, phone, plus the 12 AI fields (`ai_call_outcome`, `ai_issue_summary`, `ai_job_notes`, `job_postcode`, `job_address`, …) and `ai_last_call_at`, `ai_call_count` | GHL contact (`config/schema/contact-fields.ts`)                                                         | as above                                    |
| SMS sent to the caller and to the owner                                                                                                                                             | GHL conversations                                                                                       | as above                                    |
| Middleware logs                                                                                                                                                                     | UK-hosted middleware. **No PII**: ids, status, outcome, latency, postcode district only (NFR-06)        | Engineering                                 |
| Phone-harness test recordings                                                                                                                                                       | MASTER-QA and the test machine. Test callers and synthetic data only                                    | Engineering                                 |

Processing also passes through GHL's telephony, speech-to-text, text-to-speech and the language
model (the demo agent runs GPT-4.1). These are GHL's sub-processors. ⚠ verify GHL's current
sub-processor list and the data hosting location (we believe GHL is US-hosted; not confirmed).

---

## 2. The recording notice

### 2.1 Current draft (in `prompts/greeting.md`, status: draft)

> "Smith and Sons, virtual assistant speaking. Calls are recorded. How can I help?"

This does three things the Build Plan asks for in about four seconds (13-word budget, D16): it names
the business, says it's a virtual assistant (an AI), and gives the recording notice.

### 2.2 Why a notice is needed

- **Interception law.** Businesses may record calls on their own system for record-keeping and
  monitoring, provided they make "all reasonable efforts" to tell users their calls may be
  intercepted (Investigatory Powers (Interception by Businesses etc. for Monitoring and
  Record-keeping Purposes) Regulations 2018, reg. 4). A spoken notice at the start of every call is
  the simplest way to meet this.
- **UK GDPR transparency.** Privacy information must be given at the time data is collected. The ICO
  accepts a **layered** approach: a short notice now, with fuller information easy to find (for
  example, the business's privacy notice). A website link on its own, without telling people, is not
  enough.

### 2.3 Wording options for the product owner

| Option                | Wording (after "…virtual assistant speaking.") | Words | Comment                                                                                                                                                                   |
| --------------------- | ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A (current draft)** | "Calls are recorded."                          | 3     | Short and true. Doesn't say why. The reason can be given when asked (2.4).                                                                                                |
| B                     | "Calls are recorded for our records."          | 6     | Gives a purpose. Watch the 13-word greeting budget with long business names (prompt lint enforces it).                                                                    |
| C                     | "This call is recorded."                       | 4     | Same as A.                                                                                                                                                                |
| Avoid                 | "…may be recorded for training purposes"       | —     | "May be" is inaccurate (every call is recorded). Only say "training" if recordings are actually used for training; claiming a purpose you don't have breaks transparency. |

**Recommendation: keep A**, and add the follow-up answers in 2.4 so the agent can explain on request.
Final wording is the product owner's decision (approval recorded in `prompts/greeting.md`
front matter, `approved_by`).

### 2.4 When a caller asks or objects (proposal; not yet in the prompt)

The current prompt has no rule for "why are you recording?" or "I don't want to be recorded". Proposed
behaviour, to be added to L1 by a developer after PO approval:

| Caller says                             | Agent (proposal)                                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Why are you recording?"                | "So {{owner}} has an accurate note of what you need. It's kept by {{business}} and not shared for marketing."                                                                                               |
| "Who sees it?" / "How long is it kept?" | "{{owner}} and the team who run the phone service. {{owner}} can tell you more, or it's in their privacy notice." (Don't quote periods unless they are in config.)                                          |
| "I don't want to be recorded."          | Offer an alternative: "No problem. I can take just your name and number for {{owner}} to ring you back, or you can call back later to speak to him directly." Outcome `MESSAGE_TAKEN`/`CALLBACK_REQUESTED`. |
| Safety emergency + objection            | **Safety script first, always.** The objection never delays a safety script.                                                                                                                                |

Whether recording can be stopped mid-call in GHL Voice AI is **⚠ verify** (we found no such control).
Until confirmed, the agent must **not** say it has stopped recording.

### 2.5 Do not double up the notice

GHL phone numbers have a **"Play Call Recording Message"** option (a message played before recording
starts). Our greeting already gives the notice. If both are on, callers hear two notices and the
greeting is delayed past the four-second budget.

- Proposal: leave "Play Call Recording Message" **off** on client numbers; the greeting is the notice.
- ⚠ verify whether the number-level setting affects calls answered by Voice AI at all, and whether
  Voice AI calls are recorded when the number-level "Call Recording" toggle is off.

---

## 3. UK GDPR and PECR — practical points

Check each of these with the client during onboarding. Items with **(adviser)** need someone
qualified in data protection to confirm.

| Topic                       | What we do / propose                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Roles**                   | Client business = **controller**. Agency = **processor** (runs the service). GHL and its providers = **sub-processors**. A written data processing agreement is needed between client and agency, and the agency needs GHL's terms/DPA to cover onward processing. **(adviser)**                                                                                                 |
| **Lawful basis**            | Most likely **legitimate interests** (accurate record of the job request; quality checking of an automated service) and **steps before entering a contract** (taking booking details at the caller's request). Consent is a poor fit: the caller can't easily refuse and still be served. A short written legitimate interests assessment per client is advisable. **(adviser)** |
| **Health / vulnerability**  | Callers may say someone at home is elderly, disabled or unwell (the L2 vulnerability rule raises urgency). Health information is **special category data** and needs an extra condition. Keep it minimal: the urgency and "vulnerable household", not medical detail. Review `ai_job_notes` extraction against this. **(adviser)**                                               |
| **Privacy notice**          | The client's privacy notice (website, or available on request) should mention the AI receptionist, call recording and transcription, the processors, and retention periods. We can supply a paragraph; the client publishes it.                                                                                                                                                  |
| **International transfers** | If GHL or its AI/telephony providers process data outside the UK, a transfer mechanism is needed (for example, UK IDTA or the UK Addendum to EU SCCs, or UK–US data bridge). ⚠ verify GHL's hosting and mechanism. **(adviser)** Our middleware is UK-hosted and logs no PII.                                                                                                    |
| **Minimisation**            | Already designed in: agent never reads out stored details (L0); middleware logs no PII; summaries exclude phone numbers and emails (`ai_issue_summary` extraction rule).                                                                                                                                                                                                         |
| **Rights requests**         | Subject access and erasure requests must be answered within **one month**. Recordings and transcripts are in scope. The client forwards requests to us; we find the contact, call logs and recordings in GHL and export or delete them. ⚠ verify how to export a Voice AI recording and whether deleting a contact deletes its call logs and recordings.                         |
| **Security**                | Access to sub-accounts on a need-to-know basis; staff accounts with 2FA (⚠ verify GHL 2FA settings); recording links not pasted into chat tools.                                                                                                                                                                                                                                 |
| **PECR**                    | PECR mainly bites on **marketing** by phone, SMS and email. Our SMS are transactional only, never marketing (FR-31); keep it that way. Callers' details must not be reused for marketing without the proper consent / soft opt-in. Recording itself falls under UK GDPR and the 2018 interception regulations above, not PECR.                                                   |
| **Changing law**            | The Data (Use and Access) Act 2025 amends UK GDPR and PECR. The ICO says some guidance is under review. ⚠ re-check the points above before go-live. **(adviser)**                                                                                                                                                                                                                |

---

## 4. Retention policy — PROPOSAL

> **For approval by the product owner and each client. Not in force until approved.**
> UK GDPR sets no fixed periods; each period must be justified by its purpose and reviewed. The
> figures below are a starting point, not a legal requirement.

| Data                                                                                  | Proposed period                                                                          | Reason                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Call recordings (audio)                                                               | **90 days** from the call                                                                | Enough to settle "what did I say / what did the AI promise" questions and for daily QA review. Audio is the most intrusive form.                                   |
| Transcripts and call summaries (Voice AI call log)                                    | **90 days**                                                                              | Same purpose as the recording. Key facts are already copied to the contact fields.                                                                                 |
| Contact record and AI fields — **customers** (booked, requested, called back)         | **Per the client's own customer-records policy.** Suggestion: 6 years after the last job | Job and invoice records; 6 years matches the limitation period for contract claims in England and Wales (5 years in Scotland). ⚠ verify with the client's adviser. |
| Contact record — **no job** (`INFO_ONLY`, `OUT_OF_AREA`, `OUT_OF_SCOPE`, `ABANDONED`) | **12 months** from last call                                                             | Lets the business recognise a repeat caller; no ongoing need beyond that.                                                                                          |
| Contact record — **non-customers** (`NON_CUSTOMER`: spam, sales, wrong number)        | **30 days**                                                                              | No business purpose. Kept briefly in case of mis-classification.                                                                                                   |
| SMS history                                                                           | Follows the contact record                                                               | Part of the customer record.                                                                                                                                       |
| Middleware logs (no PII)                                                              | **30 days** (⚠ confirm the hosting log retention setting matches)                        | Debugging and latency analysis.                                                                                                                                    |
| QA and harness recordings (MASTER-QA, test callers only)                              | **Until the next release + 30 days**                                                     | Release evidence. Must never contain real customer data.                                                                                                           |
| **Hold**: complaint, dispute, safety incident or rights request in progress           | Keep the relevant recording/transcript until resolved, then **12 months**                | Evidence. Record the hold and its end date.                                                                                                                        |

How it would be enforced (all ⚠ verify; to design once confirmed):

1. **GHL recordings / call logs:** ⚠ verify whether GHL offers a retention setting or automatic
   deletion for call recordings and Voice AI call logs. We found no documented setting. If none
   exists: a monthly manual purge from the call log, or a scheduled middleware job using the Voice AI
   API (⚠ verify a delete endpoint exists).
2. **Contacts:** a monthly review using a smart list filtered by tag (`outcome-non-customer`, etc.)
   and `ai_last_call_at`, then bulk delete. ⚠ verify the GHL workflow "delete contact" action as an
   alternative.
3. **Backups:** ⚠ verify how long GHL keeps deleted data in backups. The ICO expects deletion to
   reach backups in due course.
4. Record each purge (date, sub-account, counts) in the client's onboarding record.

---

## 5. Where the settings live in GHL

| Setting                                             | Location                                                                                                                         | Status                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Call Recording (per number)                         | Sub-account → Settings → Phone System → Phone Numbers → ⋮ next to the number → Edit Configuration → **Call Recording**           | From GHL help article; ⚠ verify in our account and whether it governs Voice AI calls     |
| Play Call Recording Message (per number)            | Same screen → **Play Call Recording Message**                                                                                    | From GHL help article; keep off (section 2.5)                                            |
| Welcome message (our recording notice)              | Voice AI agent → welcome message field. Pushed from `prompts/greeting.md` by `tools/demo/provision.ts`; **never edited by hand** | Verified (live prompt matches Git, `tools/demo/verify.ts`)                               |
| Voice AI call logs (recording, transcript, summary) | Sub-account → AI Agents → Voice AI → call logs / dashboard ⚠ verify menu names; API `GET /voice-ai/dashboard/call-logs`          | API verified; UI path ⚠ verify                                                           |
| Recording retention / auto-delete                   | Not found                                                                                                                        | ⚠ verify with GHL support                                                                |
| Recording costs                                     | GHL help lists recording at US$0.0025/min and storage at US$0.0005/min/month                                                     | From GHL help article; ⚠ verify current pricing and whether it applies to Voice AI calls |
| Voice AI enablement terms                           | A third-party guide says enabling Voice AI requires accepting call-recording compliance terms (agency Settings → Labs)           | ⚠ verify (Voice AI may no longer be in Labs)                                             |

---

## 6. Onboarding checklist (recording and data)

- [ ] Client agrees the recording notice wording (PO-approved version).
- [ ] Client agrees retention periods (section 4) or gives their own; recorded in the onboarding record.
- [ ] Data processing agreement signed (client ↔ agency).
- [ ] Client's privacy notice updated to mention the AI receptionist and recording.
- [ ] "Play Call Recording Message" off on the client's number; one notice heard on a test call.
- [ ] Rights-request route agreed: client forwards requests to the agency within 2 working days (proposal).

---

## Sources

Checked October 2026.

- Investigatory Powers (Interception by Businesses etc. for Monitoring and Record-keeping Purposes) Regulations 2018 (SI 2018/356), reg. 4 — https://www.legislation.gov.uk/uksi/2018/356
- ICO, "Principle (e): Storage limitation" — https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/
- ICO, "What methods can we use to provide privacy information?" (layered approach; Data (Use and Access) Act 2025 review note) — https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-methods-can-we-use-to-provide-privacy-information/
- ICO, International Data Transfer Addendum (version B1.0, in force 21 March 2022). Found in search results; the page was not opened, so check the current ICO international transfers guidance.
- HighLevel, "Overview of Phone Number Configuration Options" (Call Recording, Play Call Recording Message, costs) — https://help.gohighlevel.com/support/solutions/articles/48001229976-phone-number-settings-explained
- HighLevel ideas board, "Record only incoming calls (not outgoing)" (recording is per number, on/off) — https://ideas.gohighlevel.com/lcphonesystem/p/record-only-incoming-calls-not-outgoing
- Growwstacks, GoHighLevel AI voice agent set-up (third party; Labs and recording terms) — https://growwstacks.com/blog/gohighlevel-ai-voice-agent-setup-demo/
- Repo: `prompts/greeting.md`, `config/schema/contact-fields.ts`, `docs/ghl-capabilities.md`, `docs/v1-readiness.md`, `docs/V1_IMPLEMENTATION_PLAN.md` (FR-07, FR-31, NFR-06).
