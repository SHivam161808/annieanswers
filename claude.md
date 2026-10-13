# UK Trades AI Receptionist — V1

You are the lead engineer responsible for building the complete V1 production system from scratch.

Do not assume an existing implementation.
Do not create a demo or throwaway prototype.
Build the real V1 according to the requirements below.

The system is a UK trades AI receptionist using GHL Native Voice AI.

The primary goal is:

Caller
→ UK phone number
→ GHL Voice AI
→ conversation / qualification / safety / booking
→ GHL CRM / Calendar / Workflows / SMS
→ monitoring / reporting

The system must be designed so the same architecture can eventually support very large call volumes, including millions of calls, through horizontal scaling and stateless components.

Do NOT replace GHL Native Voice AI with Retell, Vapi, Deepgram Voice Agent, LiveKit, or a custom realtime voice platform.

GHL Native Voice AI is the voice platform for V1.

--------------------------------------------------
## 1. SOURCE OF TRUTH
--------------------------------------------------

The project build plan supplied with this task is the primary product specification.

Read the complete build plan before writing implementation code.

Do not silently change:
- architecture
- product scope
- business rules
- booking behaviour
- safety behaviour
- platform choice
- V1/V2 boundaries

If something is ambiguous:
1. inspect the build plan
2. inspect the official GHL capabilities/documentation if needed
3. choose the smallest implementation consistent with V1
4. document the decision in the engineering documentation

Never invent unsupported GHL functionality.

--------------------------------------------------
## 2. V1 ARCHITECTURE
--------------------------------------------------

Preserve this architecture:

1. Telephony and Routing
2. Voice Agent
3. Conversation Logic
4. Business Configuration
5. Actions and Adapters
6. CRM and Automation
7. Monitoring / QA

Architecture:

Caller
  ↓
UK Telephony / GHL LC Phone
  ↓
GHL Native Voice AI Custom Agent
  ↓
Layered Conversation Logic
  ↓
Actions / Booking / Transfer / SMS / Webhooks
  ↓
GHL CRM / Calendar / Workflows
  ↓
Monitoring / QA / Reporting

Do not collapse these responsibilities into one large service.

Do not build a custom voice engine.

Do not build custom STT/TTS infrastructure for V1.

Use GHL Native Voice AI capabilities wherever they are supported.

--------------------------------------------------
## 3. VOICE AGENT
--------------------------------------------------

Use a GHL Custom Voice AI Agent.

Do not use the Flow Based Builder as the primary implementation.

The agent must support:

- inbound calls
- natural conversation
- interruption / barge-in
- qualification
- plumbing/trades triage
- safety handling
- booking
- rescheduling
- cancellation
- live transfer
- SMS follow-up
- CRM updates
- call outcomes
- fallback behaviour

The agent must feel like a real UK receptionist.

Conversation rules:

- maximum two short sentences per response
- normally ask one question at a time
- avoid robotic language
- do not over-explain
- do not repeatedly ask for information
- remember information already provided during the call
- confirm important captured information
- handle callers changing direction naturally
- never claim something happened unless the action succeeded

--------------------------------------------------
## 4. PROMPT ARCHITECTURE
--------------------------------------------------

Do NOT create one giant hardcoded prompt.

Implement a layered prompt architecture:

L1 — Core receptionist behaviour

L2 — Trade/plumbing behaviour

L3 — Client-specific configuration

L4 — Client knowledge base

The universal prompt must NOT contain client-specific facts.

Client-specific information must come from configuration / custom values / knowledge base.

The source prompt must live in Git.

If GHL requires rendered prompts, create a small configuration/rendering mechanism.

Do not duplicate prompts manually for every client.

--------------------------------------------------
## 5. BUSINESS CONFIGURATION
--------------------------------------------------

Create a configuration model capable of representing:

- business name
- business hours
- service area
- services
- emergency services
- pricing information
- phone numbers
- transfer numbers
- policies
- booking mode
- calendar
- SMS behaviour
- escalation rules
- knowledge-base references
- working-hours behaviour

The architecture must allow a new client to be onboarded by configuration rather than rewriting conversation logic.

Target:

Second client onboarding <= 4 hours.

--------------------------------------------------
## 6. BOOKING CONTRACT
--------------------------------------------------

Keep one booking interface independent of the implementation.

The agent must conceptually work with:

check_availability
create_booking
find_booking
reschedule_booking
cancel_booking

Inputs and outputs must be clearly defined.

For V1 support:

T1:
GHL calendar

T2:
Synced Google Calendar / Microsoft 365 through GHL calendar

T3:
Request mode

T4:
External systems are OUT OF SCOPE for implementation in V1.

However, define the adapter contract so T4 can be implemented later without changing the voice prompt.

Never expose implementation details to the caller.

--------------------------------------------------
## 7. BOOKING SAFETY
--------------------------------------------------

This is critical.

The system must NEVER tell a caller that an appointment is booked unless booking confirmation is actually returned.

If booking fails:

- do not claim success
- do not invent a booking ID
- do not invent a time
- gracefully move to request mode
- provide the next available action to the caller

For middleware/webhook operations:

- use the GHL call ID as the idempotency key
- repeated requests must not create duplicate bookings
- handlers must be safe to retry
- operations must be deterministic where possible

--------------------------------------------------
## 8. MIDDLEWARE
--------------------------------------------------

Where middleware is required, keep it:

- stateless
- horizontally scalable
- UK/EU hosted where required
- authenticated
- idempotent
- timeout controlled
- retry safe
- observable

Do not store call state in local process memory.

Do not rely on a single server.

Do not create unnecessary microservices.

Start with a clean modular service and split components only when there is a real operational reason.

--------------------------------------------------
## 9. LATENCY
--------------------------------------------------

Latency is a first-class requirement.

Targets:

Median latency <= 1.5 seconds
P90 latency <= 2.5 seconds

Action/webhook operations should normally respond within 2 seconds.

For slower operations the conversation should use a natural acknowledgement such as:

"Let me just check the diary."

Never leave the caller in unexplained silence.

Measure latency at every meaningful boundary.

At minimum track:

- call start
- speech detected
- transcription
- agent response start
- action start
- action response
- booking confirmation
- call completion

Do not optimise based on assumptions.

Measure first.

--------------------------------------------------
## 10. SCALE
--------------------------------------------------

Design the system to be horizontally scalable.

Requirements:

- stateless application processes
- no in-memory session dependency
- idempotent webhook processing
- safe retries
- connection pooling
- bounded concurrency
- backpressure
- timeout handling
- rate-limit handling
- graceful degradation
- structured logging
- metrics
- health checks

The system should be capable of scaling horizontally toward very high call volumes.

Do NOT prematurely build a distributed system consisting of dozens of services.

Prefer:

simple
modular
stateless
observable
horizontally scalable

over:

complex
distributed
over-engineered

--------------------------------------------------
## 11. FAILURE HANDLING
--------------------------------------------------

Every external dependency must have explicit failure behaviour.

For:

- GHL API
- calendar
- webhook
- SMS
- CRM
- transfer
- booking
- configuration
- network timeout

define:

timeout
retry policy
fallback
user-facing behaviour
logging
alerting

Never allow an external API failure to create a false success state.

--------------------------------------------------
## 12. SAFETY
--------------------------------------------------

Safety takes priority over conversion.

Implement explicit safety rules for dangerous plumbing/trade situations.

The agent must:

- recognise emergency scenarios
- avoid giving unsafe technical instructions
- escalate when required
- transfer when configured
- provide the approved emergency response
- never improvise dangerous advice

Safety tests must be blocking tests.

A build cannot be considered production-ready if the safety suite fails.

--------------------------------------------------
## 13. CRM
--------------------------------------------------

Use GHL as the CRM source of truth.

Support:

- contact creation/update
- relevant custom fields
- tags
- call outcome
- enquiry information
- notes where required
- pipeline updates where required
- owner notifications
- SMS workflows

Do not create a second CRM.

Do not duplicate data unnecessarily.

--------------------------------------------------
## 14. CALL OUTCOMES
--------------------------------------------------

Every call must produce a deterministic outcome.

Examples:

- booked
- rescheduled
- cancelled
- transferred
- emergency
- request_mode
- qualified
- unqualified
- voicemail
- missed_call
- failed
- abandoned

Outcome values must be consistent.

Do not create arbitrary outcome strings throughout the codebase.

--------------------------------------------------
## 15. OBSERVABILITY
--------------------------------------------------

Implement production-grade observability.

Every request/call/action must have a correlation ID.

Track:

- call ID
- action ID
- outcome
- latency
- errors
- retries
- booking status
- transfer status
- webhook status

Do NOT log caller personal information unnecessarily.

Logs should primarily contain:

IDs
status
outcome codes
latency
error codes

Avoid:

phone numbers
addresses
full transcripts
sensitive personal information

unless explicitly required.

--------------------------------------------------
## 16. TESTING STRATEGY
--------------------------------------------------

Testing is part of implementation, not a final step.

Build:

1. Unit tests
2. Integration tests
3. Contract tests
4. Failure tests
5. Regression tests
6. Safety tests
7. Conversation tests
8. Load tests
9. End-to-end tests

No major feature is complete without tests.

--------------------------------------------------
## 17. REQUIRED TEST CASES
--------------------------------------------------

Create a structured test suite covering at minimum:

### Basic calls

TC001 — normal enquiry
TC002 — service availability
TC003 — pricing question
TC004 — service-area question
TC005 — business-hours question

### Qualification

TC006 — capture name
TC007 — capture phone
TC008 — capture postcode
TC009 — capture address
TC010 — capture job type
TC011 — capture urgency
TC012 — caller provides information out of order

### Memory

TC013 — caller gives phone before name
TC014 — caller gives postcode twice
TC015 — caller changes address
TC016 — caller changes job type
TC017 — agent must not re-ask known information

### Booking

TC018 — availability lookup
TC019 — successful booking
TC020 — booking failure
TC021 — booking timeout
TC022 — duplicate booking request
TC023 — reschedule
TC024 — cancellation
TC025 — unavailable requested time
TC026 — request mode fallback

### Safety

TC027 — emergency leak
TC028 — gas-related emergency
TC029 — dangerous electrical/plumbing situation
TC030 — caller asks for unsafe instructions
TC031 — emergency escalation
TC032 — safety information must not be fabricated

### Conversation

TC033 — interruption
TC034 — caller talks over agent
TC035 — caller changes topic
TC036 — vague answer
TC037 — caller says "I don't know"
TC038 — caller asks agent to repeat
TC039 — caller is silent
TC040 — caller disconnects

### Recognition

Use the postcode and phone-number test sets from the build plan.

Test:

- normal UK accent
- Scouse
- Geordie
- Glaswegian
- Brummie
- Welsh
- Yorkshire
- London
- Northern Irish

Also test:

- noisy room
- vehicle/van
- speakerphone
- weak mobile signal

### Telephony

TC041 — normal inbound call
TC042 — owner does not answer
TC043 — busy
TC044 — unreachable
TC045 — transfer succeeds
TC046 — transfer fails
TC047 — voicemail fallback

### GHL

TC048 — contact creation
TC049 — contact update
TC050 — custom field update
TC051 — workflow trigger
TC052 — SMS trigger
TC053 — calendar update
TC054 — call outcome write-back

### Reliability

TC055 — GHL API timeout
TC056 — webhook timeout
TC057 — retry
TC058 — duplicate webhook
TC059 — malformed webhook
TC060 — rate limit
TC061 — partial dependency failure
TC062 — service restart during active workload

### Security

TC063 — invalid webhook authentication
TC064 — replayed webhook
TC065 — malformed input
TC066 — prompt injection attempt
TC067 — caller attempts to override safety rules
TC068 — caller attempts to access internal configuration

--------------------------------------------------
## 18. CONVERSATION QUALITY TESTS
--------------------------------------------------

Every regression run must evaluate:

- response relevance
- no unnecessary repetition
- correct information capture
- correct booking
- correct safety response
- natural turn-taking
- interruption handling
- concise responses
- UK receptionist tone
- no hallucinated business information

Target:

Average agent response <= 25 words.

Greeting should be approximately <= 4 seconds.

--------------------------------------------------
## 19. LOAD TESTING
--------------------------------------------------

Create load tests for the middleware/API layer.

Test progressively:

10 concurrent calls
50
100
250
500
1000
and higher where infrastructure permits.

Measure:

- throughput
- p50 latency
- p90 latency
- p95 latency
- p99 latency
- error rate
- timeout rate
- retry rate
- CPU
- memory
- connection usage

The system must degrade gracefully rather than collapse.

Do not claim "millions of calls supported" without measured evidence.

Document the tested capacity and scaling assumptions.

--------------------------------------------------
## 20. SECURITY
--------------------------------------------------

Implement:

- webhook authentication
- secret management through environment variables
- no secrets in source code
- input validation
- output validation
- least privilege
- request size limits
- rate limiting where appropriate
- replay protection where applicable
- safe error messages
- audit logging

Never expose internal configuration to callers.

--------------------------------------------------
## 21. CI/CD
--------------------------------------------------

Create a CI pipeline that runs:

- formatting
- linting
- type checking
- unit tests
- integration tests
- contract tests
- safety tests
- regression tests

Production deployment must be blocked when critical tests fail.

--------------------------------------------------
## 22. ENVIRONMENT MODEL
--------------------------------------------------

Use:

MASTER-DEV
MASTER-QA
PRODUCTION

Development changes happen in MASTER-DEV.

Regression testing happens in MASTER-QA.

Only tested snapshots move to production.

Use versioned releases.

Example:

v1.0.0
v1.0.1
v1.1.0

Never make undocumented production changes.

--------------------------------------------------
## 23. CLIENT ONBOARDING
--------------------------------------------------

Client-specific configuration must be separated from universal logic.

A new client should primarily require:

- business information
- working hours
- services
- service area
- phone/routing
- calendar
- transfer number
- policies
- knowledge base
- approved voice configuration

Do not fork the application for every client.

--------------------------------------------------
## 24. DEFINITION OF DONE
--------------------------------------------------

V1 is NOT complete when the code runs.

V1 is complete only when:

- architecture is implemented
- GHL Voice AI agent is configured
- prompt architecture is implemented
- business configuration works
- booking works
- reschedule works
- cancellation works
- request mode works
- CRM updates work
- SMS workflows work
- transfer works
- safety suite passes
- regression suite passes
- failure scenarios pass
- latency targets are measured
- load testing is completed
- monitoring exists
- logging exists
- alerting exists
- deployment process exists
- documentation exists

--------------------------------------------------
## 25. DEVELOPMENT RULES
--------------------------------------------------

Before writing code:

1. Read the complete specification.
2. Identify all requirements.
3. Identify GHL capabilities required.
4. Identify which capabilities need verification.
5. Design the minimum production architecture.
6. Create the implementation plan.
7. Implement incrementally.
8. Test every component.
9. Run the complete regression suite.
10. Fix failures.
11. Remove dead/debug code.
12. Document final architecture.

Do not blindly generate the entire project in one pass.

Work in small verified increments.

After every major component:

IMPLEMENT → TEST → FIX → VERIFY

--------------------------------------------------
## 26. CODE QUALITY
--------------------------------------------------

Write production-quality code.

Prefer:

simple
readable
typed
modular
testable
maintainable

Avoid:

- unnecessary abstractions
- unnecessary design patterns
- unnecessary microservices
- duplicate logic
- dead code
- debug logging
- hardcoded secrets
- magic values
- giant functions
- giant files

Reuse existing utilities once created.

Do not create a second implementation of the same functionality.

--------------------------------------------------
## 27. IMPORTANT CLAUDE BEHAVIOUR
--------------------------------------------------

Do NOT ask me to make obvious engineering decisions.

Make reasonable decisions based on the specification.

When a requirement is genuinely ambiguous, identify the ambiguity and choose the safest V1 implementation.

Do not stop after creating scaffolding.

Continue until the feature is actually implemented and tested.

Do not say:

"this should work"

Actually test it.

Do not claim:

"production ready"

unless the required tests and validation have actually passed.

At the end of each implementation phase report:

- what was built
- files created/changed
- tests added
- tests executed
- failures
- fixes
- remaining risks

--------------------------------------------------
## 28. FIRST TASK
--------------------------------------------------

Do NOT start coding immediately.

First:

1. Read the complete V1 build plan.
2. Extract every functional requirement.
3. Extract every non-functional requirement.
4. Extract all acceptance criteria.
5. Map each requirement to one of the seven architecture layers.
6. Identify GHL capabilities that must be verified.
7. Produce a V1 implementation plan.
8. Produce the proposed repository structure.
9. Produce the test strategy.
10. Produce the deployment strategy.

Then wait for implementation approval.

Once approved, implement Phase 1.

Never deviate from the architecture without explicitly explaining why.