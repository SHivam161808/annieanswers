# Review — "Document 1" receptionist knowledge series (7 documents)

Received 2026-10-12. Source: three receptionist workshops, consolidated by the client.
Files: `Document_1_*_Receptionist_Knowledge_Developer_Reference_FINAL.docx` (project root).

**Client boundary (binding):** behavioural / conversational source material only. Not technical
plumbing guidance. Not to be pasted into the AI. Technical causes, customer instructions, safety
rules and urgency thresholds come from the 7 UK-plumber documents still to arrive.

## What the series establishes

One principle runs through all seven:

> Presentation → important unknown → one purposeful question → branch → capture useful
> information → book / escalate. A capable receptionist, "not a form being read aloud and not a
> plumber pretending to diagnose over the phone."

| #   | Area                             | Real-world lesson (the "first description is not the problem" example)                    |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Toilets                          | Recurring blocked toilet → downstairs shower also gurgling                                |
| 2   | Drains & blockages               | Blocked kitchen sink → washing machine backing up, downstairs toilet gurgling             |
| 3   | Leaks & water damage             | "Roof leak" ceiling stain → bathroom above, appears after showers                         |
| 4   | Boilers, heating & hot water     | Repeated pressure top-ups → damp patch below bathroom, smell near boiler                  |
| 5   | Water supply & pressure          | "Water company problem" → neighbours fine, bill up, damp patch by front door              |
| 6   | Taps, fixtures & installations   | "Ten-minute tap swap" → wall-mounted vs sink-mounted, new pipework, no fittings, deadline |
| 7   | Behaviour, emergencies, unknowns | Vague symptoms, frustrated/panicked callers, process failures, technical questions        |

Each document also gives: customer language families, a purposeful question pool (explicitly not
a checklist), emotional-state behaviour, information worth passing to the plumber, and a list of
what must not be imported as technical fact.

## Gaps and conflicts against the current build

| #   | Current build                                                                                                                                                           | Documents say                                                                                                                                                                               | Action                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| G1  | `stopcock_advice` safety script tells callers to turn the water off at the stopcock (live on the demo agent)                                                            | Isolation / valve instructions must not be given without UK-plumber validation (Leaks §7, Water Supply §7)                                                                                  | **Remove from the live prompt now**; restore only if the plumber documents validate it                                  |
| G2  | L2 triage table maps keyword → job type with a fixed question list per type                                                                                             | Do not keyword-match to diagnosis or job type; questions only when they change the next step                                                                                                | Rewrite L2 around the 7 presentation families: important unknowns + what to capture, classification after clarification |
| G3  | Vulnerable-household question asked on P2–P4 calls (heard on a dripping-tap test call)                                                                                  | Purposeful questions only                                                                                                                                                                   | Ask only when it can change the outcome (loss of an essential service) or when the caller volunteers it                 |
| G4  | L1 has no emotional-state behaviour                                                                                                                                     | Calm / frustrated / panicked / confused / embarrassed handling; never "calm down"; reassure through action; distress ≠ technical urgency                                                    | Add a short emotional-state section to L1                                                                               |
| G5  | No rule for technical questions ("is my boiler safe?", "can I use drain cleaner?", "can it wait till Monday?", "what does this error code mean?", "will this tap fit?") | Acknowledge uncertainty; never guess                                                                                                                                                        | Add to L0 never-invent rules and L1                                                                                     |
| G6  | Post-call capture is CRM fields + 1–3 sentence summary                                                                                                                  | Plumber needs: caller's own words, location, timing pattern, what was tried, previous work, other fixtures affected, make/model/error code/pressure, access, what the agent told the caller | Add a structured job-notes extraction (post-call)                                                                       |
| G7  | Fixture jobs booked by job type only                                                                                                                                    | Distinguish repair / like-for-like replacement / new installation; who supplies the item; same or new position; never promise fit, time or price                                            | Add to L2 fixtures family and appointment-type selection                                                                |
| G8  | Process failures (late plumber, missed callback) handled as "existing job → take a message"                                                                             | Listen, no blame or excuses, only a realistic next step                                                                                                                                     | Extend L1 existing-job handling                                                                                         |
| G9  | "No water at all" is always P2                                                                                                                                          | Check whether neighbours are affected before treating it as a property fault; don't simply agree it's the water company                                                                     | Add to water-supply family (urgency itself pending plumber validation)                                                  |
| G10 | Scenario pack has no cases from the documents                                                                                                                           | Seven named real-world examples                                                                                                                                                             | Add one regression scenario per example, plus the technical-question cases from G5                                      |

## Unchanged by this series

- P1 safety scripts for gas, carbon monoxide and water on electrics: the documents defer all
  safety wording to UK validation; ours are already DRAFT and release-blocked pending PO approval.
- P1–P4 urgency model: from the Build Plan, not the receptionists; thresholds to be validated by
  the plumber documents.

## Document issues to report to the client

1. Leftover AI citation markers in the text: Leaks §1 (`fileciteturn10file0L226-L250`) and Taps §1
   (`fileciteturn13file0L242-L271`).
2. Boilers §8 repeats the **toilet** example (recurring blocked toilet / gurgling shower) instead of
   the boiler example given in its own §1 (pressure loss, damp patch, smell).
3. Water Supply §7 appears copied from the toilet document ("recommendations to replace a toilet",
   "plunge").
4. Boilers §3: the developer-rule box sits in the middle of the question list (formatting only).
