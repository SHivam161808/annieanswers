# Client knowledge base template (T-207)

Each client has their own knowledge base (prompt layer L4). The agent uses it for general
questions, keeps to its wording, and answers in two short sentences
([`prompts/L4-knowledge.md`](../../prompts/L4-knowledge.md)). If the knowledge base and the business
config disagree, **the config wins**. If neither has the answer, the agent says the owner will
confirm — it never guesses.

## What goes where

| Put it in the **config** (`config/clients/<client>.yaml`, via the [intake form](intake-form.md)) | Put it in the **knowledge base**                                                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Anything said word for word or that drives a decision:                                           | Everything else a caller might ask that helps them, but doesn't change what happens on the call: |
| Prices (`pricing_statements`)                                                                    | What a first visit involves                                                                      |
| Quote policy, call-back promise, cancellation policy                                             | Guarantees and warranties on work                                                                |
| Opening hours, closed dates, emergency cover                                                     | Parking, access and pets                                                                         |
| Services offered / not offered, Gas Safe status                                                  | Whether you're insured, accreditations                                                           |
| Service area (postcode districts)                                                                | Whether you take landlord / letting agent jobs                                                   |
| Payment methods                                                                                  | Supplying parts, customer-supplied parts                                                         |
| Transfer numbers and rules                                                                       | Clean-up, waste removal                                                                          |

Rule of thumb: if getting it wrong would cost the plumber money or a booking, or it decides
where the call goes, it's config. Never repeat a price, hours or a policy in the knowledge base —
two copies drift apart. If the honest answer is "ask the owner", leave the entry out: the agent
already says the owner will confirm.

## Writing rules

1. **Short and spoken.** One or two sentences, under about 25 words, as you'd say it on the phone.
   No bullet lists, tables, links or symbols.
2. **Plain British English.** "Ring", "bank holiday", "postcode", "half eight".
3. **No technical advice.** No diagnosis, no "try this first", no part numbers, no instructions to
   touch valves, stopcocks, boilers, gas or electrics. Safety situations are handled by fixed
   scripts, never by the knowledge base.
4. **No promises the business can't keep.** No arrival times, no "same day" unless it is always
   true.
5. **No prices, numbers or addresses.** Prices live in config; the agent may only speak registered
   emergency numbers; the owner's personal details are never given out.
6. **One question per entry**, phrased the way a caller asks it. Add common alternative wordings.
7. **Facts the plumber has confirmed.** Every entry is read back to the plumber before go-live.

## Entry format

```
Q: <question as a caller would ask it>
Also asked as: <other wordings, optional>
A: <one or two spoken sentences>
```

---

## Example: Smith and Sons (fictional plumber, owner Dave)

**Q:** Are you insured?
**A:** Yes, we carry full public liability insurance. Dave can send you the details if you need them.

**Q:** Do you guarantee your work?
**Also asked as:** Is there a warranty?
**A:** Yes, our workmanship is guaranteed for twelve months. Manufacturers' guarantees cover the parts.

**Q:** Do you work for landlords and letting agents?
**A:** Yes, we do. We just need the tenant's contact details so we can arrange access.

**Q:** Can I supply my own tap or toilet?
**A:** You can, but we can only guarantee the fitting, not the part. Dave will talk it through with you.

**Q:** Do you take away the old bathroom suite?
**A:** Yes, removal of the old suite is included in our bathroom installs.

**Q:** Will you need to park outside?
**A:** It helps if there's somewhere close for the van. Let us know if parking is tricky and we'll plan around it.

**Q:** I've got a dog — is that a problem?
**A:** Not at all, we just ask that pets are kept in another room while we work.

**Q:** Do I need to be in when you come?
**A:** Someone over 18 needs to be in to let us in and show us the problem.

**Q:** Do you do weekend work?
**A:** Weekend jobs depend on the diary, so Dave will let you know if one's possible.

**Q:** Do you leave the place clean?
**A:** Yes, we use dust sheets and clear up before we leave.

**Q:** Can you give me a written quote?
**A:** Yes, quotes are sent by text or email after the visit.

**Q:** Will the same engineer come back if there's a problem?
**A:** We always try to send the same engineer back, so they know the job.

**Q:** Are you a family business?
**A:** Yes, it's Dave and his sons, and we've been working locally for over twenty years.

**Q:** Do you send a text before you arrive?
**A:** Yes, you'll get a text confirming your booking and a reminder before the visit.

**Q:** Do you do work for businesses as well as homes?
**A:** Mostly homes, but we do take on small shops and offices. Dave will confirm if it's a fit.

Notes on the examples: none of them carries a price, an hour of the day, a postcode or a
technical instruction — those come from config or are refused. "Same day" and arrival times are
deliberately absent. Check claims like "twenty years" and "twelve months" with the plumber;
they're illustrative.
