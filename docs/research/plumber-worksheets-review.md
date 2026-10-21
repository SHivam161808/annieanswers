# Plumber worksheets (R. Chua, Oct 2026) — review and how they were used

Six technical worksheets were received on 2026-10-21 and used alongside the receptionist research
(Document 1 series), not as verified fact. Result: `knowledge/symptoms/*.yaml`, served to the agent
through the `symptom_guidance` action.

| Worksheet                      | Call types served | Tentative explanations | Claims flagged (unsafe / not UK / other) |
| ------------------------------ | ----------------- | ---------------------- | ---------------------------------------- |
| Boiler, heating & hot water    | 10                | 23                     | 5 / 6 / 11                               |
| Toilets                        | 8 (+2 held)       | 20                     | 1 / 9 / 8                                |
| Drains & blockages             | 8                 | 17                     | 2 / 3 / 7                                |
| Leaks & water damage           | 10                | 23                     | 3 / 1 / 4                                |
| Water supply & pressure        | 10 (+1 held)      | 20                     | 1 / 3 / 7                                |
| Taps, fixtures & installations | 9 (+1 held)       | 21                     | 1 / 1 / 6                                |

## What changed in the agent

- After the caller describes the problem, the agent fetches guidance for that presentation: the 2–3
  most useful questions, what it may explain **as a possibility only** ("that can often be…, the
  engineer will confirm on the visit"), signs that raise urgency, notes for the engineer, and how
  to qualify and book the job. It no longer defaults to "I'll pass this to the plumber".
- Every spoken line is checked automatically: explanations must be tentative; nothing may tell the
  caller to touch, reset, drain, bleed, top up or isolate anything; no "definitely", "it's just",
  "safe to use" or "can wait"; no chemicals, plungers or boiling water.
- Safety handling is unchanged: gas, carbon monoxide and water-on-electrics use only the approved
  scripts. Nothing from the worksheets was added to them.
- UK terms throughout (cistern, pan, stopcock, combi, cylinder, immersion heater, gully, consumer
  unit, Gas Safe registered engineer). US terms in the worksheets are kept only so the agent
  recognises callers who use them.

## Decisions needed from the client

1. **Water isolation (stopcock) advice.** The plumber endorses "turn off the main stopcock / the
   toilet's isolating valve if it is safe and accessible" for active leaks. The research said this
   would return only once a UK plumber validated it. Restore it as an approved script? (Currently
   off: the agent only asks whether they've already turned the water off.)
2. **Short safety one-liners** the plumber recommends: "stop flushing", "stop using that tap or
   appliance", "keep away from the waste water". Approve any as scripts? (Currently not said.)
3. **Water company line.** "If the neighbours are affected too, it can sometimes be the shared
   sewer / a supply issue, which the water company usually looks after." Keep or remove? (It is
   served now, always tentative; it differs in Northern Ireland and may lead callers away from
   booking.)
4. **Gas script: turning off at the meter.** National guidance includes it if safe; our approved
   script does not. Add it?
5. **No smoke/fire script.** Smoke, sparks or scorch marks escalate as P1, but the agent has no
   approved words to say. Add a short script?
6. **Urgency calls to confirm:** loud bang when the boiler lights (P1); sagging ceiling (P2);
   scalding-hot water (not yet placed); gurgling in several drains (P3) vs dirty water coming up
   inside (P2); drain cleaner on skin, in eyes or swallowed (P1 — not in the worksheets).
7. **Wet electrics then plumbing:** the plumber wants an electrician to make it safe first. Is
   that the business's process?
8. **Approvals still outstanding:** the safety scripts are still drafts (8 approvals).

## Questionable claims, by worksheet

These are not served. Most common issues: US equipment and terms (water heaters, tanks, pilot
lights, gas hoses, flapper valves, faucets), causes stated without basis, and answers that asked the
AI to explain nothing even where a tentative explanation is standard and safe.

## Boiler, heating & hot water

10 call types served, 23 tentative explanations, 22 claims flagged.

**Unsafe**

- §7 must NOT: "must not tell the customer to drain the system themselves if they are not familiar with the system." — Implies a familiar customer could be told to drain it. The AI must never instruct anyone to drain or open any part of the system.
- §8 gas smell question: "Can you see any visible gas leak using a soap-and-water test? ... before the valve or after the valve?" — Dangerous. It asks the caller to stay near and trace a gas leak. The UK procedure is to leave, avoid switches and flames, and ring the National Gas Emergency Service on 0800 111 999 (NI 0800 002 001).
- §8: "Could you close the valve before the plumber arrives?" and "Closing the valve is the immediate action a customer can take before the plumber arrives." — Unsafe framing. Gas emergencies are attended by the gas emergency service, then a Gas Safe registered engineer, not a plumber. Our approved script says only leave and call the emergency line. Turning off at the meter is in national guidance but not in our approved script.
- §8: "Does the gas smell spread throughout the house, or is it only near the hose connection?" / "Do you see any visible cuts on the gas hose?" / cause "a gas leak from the hose". — Asks the caller to inspect gas fittings, which is tracing a leak. "Gas hose" is US or appliance language; UK boilers are fed by rigid pipework. Not used.
- §8 and Part 2 B: "Shut off the main gas valve only if it is safe to do so ... wait for the plumber or emergency service to attend"; "A gas leak may be urgent if it has not been shut off at the valve." — A gas smell is always an emergency, whether or not the supply is off. The agent says only the approved script (leave, no switches or flames, call 0800 111 999) and escalates P1. Any meter-valve wording must be added to the approved script by the client first. §8 also has no carbon monoxide handling (Part 3 covers it).

**Not UK practice / US terms**

- §1 no hot water: causes are a faulty heating element, faulty thermostat, wiring/power fault tripping the circuit breaker, and a damaged "upper or lower heating element" in the "water heater". — This is the US electric storage water-heater model. Most UK homes have a combi, or a system/regular boiler with a hot-water cylinder (often with an immersion heater as backup); electric showers are separate. Element and thermostat causes only fit an immersion heater, and the common combi and cylinder causes are not listed.
- §1: "Popping or rumbling from the tank — possible sediment or mineral buildup." — US tank framing. The UK equivalent is "kettling" from limescale or sludge on the boiler heat exchanger. Not used as written.
- §6 noises: "Popping noise, like popcorn: most likely caused by sediment deposits at the bottom of the tank." — US water-heater framing. A combi or wall-hung boiler has no tank. The UK equivalent is kettling from limescale or sludge in the heat exchanger.
- §7: "a pipe connection may be misaligned and cause water to leak into the sink cabinet." — US under-sink water-heater framing. UK boilers are usually wall-mounted in a kitchen, airing cupboard or loft.
- §8 causes: "The pilot light might be out" and "the igniter may not be working, and the pilot light may also be out". — Modern UK boilers do not have a standing pilot light (only some older boilers and back boilers do). Mentioning pilot lights invites relighting attempts. A gas smell must never be explained.
- §8 cause: "The heating may be operating without water in the tank." — US water-heater "dry fire" concept. It is not a cause of a gas smell and does not apply to UK combi or system boilers.

**Unsupported or overconfident**

- §4 error codes: causes listed are "low boiler pressure", "a clogged boiler strainer", and "air in the system, sediment, or debris"; first question is "Have you read the maintenance manual and followed its instructions?" — These are generic guesses. A code's meaning depends on the make and model, and "strainer" is not normal UK boiler language. The manual question is fine for recording history but can sound like blame, so we ask what they've already tried. The agent gets the make and code and uses lookup_fault_code.
- §5 pressure dropping: causes are "a heavy buildup of minerals caused by hard water", "low water pressure", "a buildup of minerals inside the pipe or strainer"; likelihood answer is "the boiler's motherboard may be old, worn out, or outdated". — Not correct for a sealed (pressurised) heating system. Mains water pressure, limescale and the circuit board do not make it lose pressure. The usual UK causes are a leak on the system, the pressure relief valve letting water out, the expansion vessel losing its charge, or an automatic air vent. Part 2 A (record history, do not assume a cause) is sound and is what we used.
- §5 "What could the AI safely explain" and "must NOT" answers refer to a "displayed code" and to having "read and followed the manual"; the engineer-information list repeats §3. — These appear to have been copied from §3 and §4 rather than written for pressure loss. We could not use them as pressure-specific guidance.
- §6 noises: "Crackling noise: may be caused by condensation dripping onto the hot burner." — No basis for this as a UK boiler fault description. Not used.
- §6 noises: "Loud humming or banging against the pipe: mostly associated with water hammer." — Partly right. Banging when a tap is turned off is typically water hammer, but humming is more often the pump or fan. We only use water hammer for pipe banging when taps are turned off.
- §6: "The receptionist can explain the different types of noises a customer may hear from a water heater and what those noises mean." — Overconfident, and "water heater" is US terminology. Noises can only be linked tentatively to possible causes. Hissing must also be checked against a gas smell (Part 3 lists hissing as a gas sign).
- §7 boiler leak: causes are "a drain valve may be only partly open", "the stopcocks may not be fully open, restricting the water flow", "the overflow pipe may be incorrectly aligned", "the thermostat may not be working properly". — Mostly unsupported. A partly closed stopcock restricts flow but does not cause a leak, and a thermostat does not leak. The usual UK causes are the pressure relief (discharge) pipe dripping outside, a condensate pipe joint, or an internal seal or component (engineer only). Water near the boiler's electrics needs the water_on_electrics script.

**Too cautious (we explain tentatively instead)**

- §1 What could the AI safely explain: "The AI should not explain possible technical causes or offer technical advice." — Too cautious. Tentative, well-established explanations are safe and useful (for example the combi diverter, immersion element or thermostat, an electric shower being separate from the boiler), as long as the engineer confirms on the visit.
- §2 What could the AI safely explain: "The AI should not explain possible radiator faults." — Too cautious. The worksheet itself lists trapped air (cold at the top) and sludge (cold at the bottom); these are textbook UK explanations that can be given tentatively without instructing the caller to bleed or adjust anything.
- §3 What could the AI safely explain: the AI should not "interpret error codes". — Too cautious against our design. The agent may give the manufacturer's published meaning of a code through lookup_fault_code, while saying the engineer confirms the actual cause. It never diagnoses or instructs beyond the manufacturer's guidance.
- Part 4: "Only the customer's visible symptoms and reported observations can be explained. Hidden mechanisms and underlying causes cannot be reliably explained." — Too cautious against the client's brief. Tentative "this can sometimes be..." explanations of common causes are safe when the engineer confirms on the visit. The worksheet's own example of a misleading statement ("the pressure is low because of a leak") is misleading only because it is stated as fact.

## Toilets

8 call types served, 20 tentative explanations, 18 claims flagged.

**Unsafe**

- Part 2 B: "ask whether the customer is currently using a hand pump and record the answer." — Asking about a hand pump (plunger) during an active overflow can sound like encouragement to keep plunging. We record it only if the caller mentions it.

**Not UK practice / US terms**

- §1 question: "Is water flowing from your faucet, and is the water supply valve open?" — US wording (faucet) and it asks the caller to inspect a valve. Replaced with "Is water coming out of your other taps normally?" with no valve check.
- §1 question: "Does the water tank feel half full or full?" — Asks the caller to lift the cistern lid and judge the level, and "tank" is US for cistern. We ask instead whether the cistern refills after a flush.
- §1 and §4 causes: "broken flapper chain", "damaged flapper", "mineral buildup around the flapper", "flush lever may not have been set". — These describe US flapper cisterns. Most UK toilets use a siphon or a drop (flush) valve worked by a button or lever, so the fault is usually described as the flush valve, siphon or linkage.
- §2 question wording: "diapers, sanitary napkins". — US terms. In the UK these are nappies and sanitary towels or pads.
- §3 causes: "an already-full septic vault", "shared pipe stack in a high-rise", "simultaneous use of water closets with a poor vent", "trees near the soil pipe". — Septic vault, water closet and high-rise stack are US framing. In the UK it is a septic tank or cesspit, and most homes are on mains drainage. The usual cause of an overflow is a blockage in the pan or drain. Tree roots affect underground drains, not the soil pipe.
- §6 causes and questions: "a closed angle valve", "a frozen waterline", "Is water flowing from your other faucets?" — US terms. The UK equivalents are isolating (service) valve, supply pipe and taps. Not served.
- §6 note: "leaving a faucet slightly open to maintain a small flow may help prevent pipe freezing". — US-style advice. UK guidance is to lag pipes and keep some heating on. It is excluded either way because it is an instruction.
- Part 3: "water flowing onto nearby electrical outlets or electrical panels". — US terms. In the UK these are sockets and the consumer unit or fuse box. The hazard itself is right and uses the water-on-electrics script.
- Throughout: "tank", "flush tank", "faucet", "apartment/unit", "water closets". — US terminology. The agent uses cistern, taps, flat and toilet.

**Unsupported or overconfident**

- §1 cause: "damaged or failed mechanism associated with high water pressure". — The worksheet itself says this needs assessment. Mains pressure is not a usual cause of a toilet not flushing, so we don't use it.
- §2 cause: "a poorly installed or blocked vent pipe" is one of the two main causes of a blocked toilet. — Most single-toilet blockages are in the pan or the drain close to it, usually from wipes or similar. Venting problems tend to cause gurgling or slow draining rather than a blockage. Also, "vent pipe" in the UK is the soil and vent pipe or an air admittance valve.
- §3 question: "Is your area prone to flooding?" — Low value for a toilet overflow. If sewage comes up from outside drains or the sewer, that is a different presentation, so we don't ask it.
- §5 causes: only "a cracked ceramic toilet bowl" or "a crack inside the bowl not visible externally". — Incomplete and could steer the caller. Commoner sources of water round a UK toilet are the pan connector, the cistern-to-pan seal or bolts, the supply connection or valve, and condensation. The worksheet itself says the source must be found on site.
- §7 causes: "exceeding the toilet's load capacity" and "earth movement". — Speculative. Common UK causes include impact, overtightened fixings or seat bolts, and age. Not used, and the agent never states how damage happened.
- Part 3: "If the customer can shut off the fixture's water supply valve, the issue may be handled through normal scheduling", and "The receptionist can recommend shutting off the toilet's water supply valve". — The client has not approved isolation advice. Small isolating valves can be seized or missing, and urgency should depend on what is happening, not on a DIY step. Held for client decision.

**Too cautious (we explain tentatively instead)**

- §1–§8 and Part 4: "The receptionist must not disclose these possibilities", "must not provide probable diagnoses … for a customer's specific problem". — Too cautious for common, well-understood faults. A running cistern, weak flush or slow refill can be explained tentatively (flush or fill valve), and the engineer still confirms. We explain these but give no diagnosis for leaks with an unclear source.
- §4–§8: "Remind the customer in every such case to watch for hazards and stay away from unsafe areas or equipment." — A generic hazard warning on a running cistern, cracked seat or slow refill is unnecessary and may alarm callers. Hazard handling is triggered by real signs, such as water near electrics, which gets the approved script.

## Drains & blockages

8 call types served, 17 tentative explanations, 12 claims flagged.

**Unsafe**

- §8 "Unexplained smell" gives only drain causes (vent seal, dry trap, open cover) and no step to rule out gas. — An unplaced smell in the house could be gas. The AI must ask first whether it could be gas and use the approved gas script if so, before treating it as drains.
- Part 2 B and Part 3: "If water is near electrical equipment, keep away" / "do not enter the affected area or touch electrical switches." — Sensible advice, but it is improvised electrical safety wording. The AI must use only the approved water_on_electrics script; any extra wording needs adding to that script first.

**Not UK practice / US terms**

- "Floor drain" used throughout §3 and §8 (e.g. "Water is coming up through the floor drain", "A dried-out floor drain trap"). — Floor drains are a US/commercial feature; most UK homes do not have them. UK callers will say shower or wet-room drain, plughole, outside gully, drain cover or manhole.
- §1 lists "A faulty or unpowered waste disposal unit" as a main cause and asks "is it operating as usual?" as a top-three question. — Waste disposal units are uncommon in UK kitchens, so this should not be a standard question. Asking about power also edges toward electrics; the AI should only note it if the caller mentions one.
- §4 and §8 use "yard drain" and "service drain cover". — UK equivalents are outside gully, drain grid or cover, and manhole or inspection chamber. Used as keywords only, with UK terms preferred in speech.

**Unsupported or overconfident**

- §1 lists "A blocked or restricted drain vent" as a main cause of a single slow fixture. — Venting problems more usually show as gurgling or smells across several fittings than one slow sink. Not offered to callers for a single fixture.
- §5 gives the causes of a washing machine backing up into the sink as only increased drainage demand from modifications and inadequate ventilation. — It leaves out the most common cause, a partial blockage (grease, lint) in the shared kitchen waste or trap. It also implies a past installer's fault, which the AI must not suggest.
- §2 lists "Recent installation of additional fixtures that may have affected the drainage system's capacity" as a main cause. — Possible but uncommon in homes, and it implies faulty earlier work. Kept as a question for the engineer's notes, never as an explanation to the caller.
- §4 groups "Whenever it rains, my garage fills with water" with foul-drain causes (damaged drain pipe, full septic tank, sewer surcharge). — Rainwater flooding is often surface-water drainage (gully, channel drain, downpipe, ground levels) and may not be a plumbing job. Separated in the explanations; the owner confirms whether the business covers it.
- §3 lists "A full septic tank" as one of three main causes of water coming back up inside, and asks about excavation and tree roots as a first question. — Septic tanks and cesspits only apply to off-mains properties, a minority in the UK. Excavation and tree-root history is engineer detail, low priority while sewage is actively coming up.

**Too cautious (we explain tentatively instead)**

- Part 3 says whether "a public sewer or private drain is responsible" cannot be assessed, and §4 and §6 raise the public sewer without saying anything the AI can tell the caller. — It is standard UK knowledge that shared sewers beyond the boundary are usually the water company's responsibility (since 2011 in England and Wales; different in Northern Ireland). A tentative line helps when neighbours are affected; added with "usually" and "can sometimes".
- §1 "What could the AI safely explain": only "Slow drainage can have several possible causes, including a blockage or an issue with the waste pipework." — Standard knowledge supports more. A single fixture slowing gradually is commonly a build-up in its own trap or waste. Added as a tentative explanation for when other fixtures are confirmed unaffected.

## Leaks & water damage

10 call types served, 23 tentative explanations, 8 claims flagged.

**Unsafe**

- Water near electrics (Part 1 §2, Part 3): "If the electricity can be isolated from a dry, safe location ... switch off the relevant supply"; "Switch off the electricity only if the breaker can be reached from a dry, safe location"; otherwise "leave it to ... emergency service". — Conflicts with the water_on_electrics script, which tells callers not to touch the fuse box. A caller can't judge what is a "dry, safe location" in an emergency. UK wording is consumer unit / fuse box / trip switch; 999 is for fire or injury, otherwise an electrician. Not served.
- Appliance leak (§6): "If safe, stop using the appliance and shut off its water supply." — Means reaching behind a wet, plugged-in machine to its valve and socket. Water-isolation advice is not yet approved by the client. Not served; the agent only records what the caller did.
- Scenario A/B: "the customer may place a basin underneath if safe"; "advise moving belongings only if safe". — Sensible in many cases, but standing under a wet or sagging ceiling or near a wet light fitting can be dangerous, and these are instructions outside an approved script. Needs client approval as an approved script with limits before use.

**Not UK practice / US terms**

- US terms in §4 and §5: "kitchen faucet", "toilet tank", "P-trap", "disposer" (waste disposal unit), "shut-off valve", "vent arrangement". — UK equivalents are tap, cistern, trap or U-bend, waste disposal unit (uncommon in UK homes), isolating valve or stopcock, and soil and vent pipe. The agent uses the UK terms.

**Unsupported or overconfident**

- Burst pipe causes (§3): "Excessive water pressure causing a pipe or connection to fail" listed first; freezing is not mentioned. — In UK homes, frost is a classic cause of burst pipes in winter and should be among the main causes. High mains pressure is a possible factor but not usually the leading one; we don't mention pressure to callers.
- Use-linked leak (§7): "Poor or inadequate drainage venting affecting wastewater flow" and "an overloaded or improperly connected shared drainage pipe" as main causes of a leak. — Venting problems usually show as gurgling, smells or traps emptying, not visible leaks; the wording reads like US plumbing-code thinking. A partly blocked shared waste backing up is plausible and is kept. Shower seals, tray and waste are the usual UK cause and are missing.

**Too cautious (we explain tentatively instead)**

- Under-sink leak (§4): the AI may only explain that there are supply pipes, waste pipes and a P-trap under the sink and that a plumber can inspect them. — The worksheet's own reasoning (leaks only when draining point to the waste or trap; constant leaks point to a supply connection or hose) is standard and safe to give tentatively, so the agent offers it with the engineer confirming.
- Ceiling/wall damp (§1) and suspected source (§8): the AI can only say "the source cannot be confirmed" and "a plumber will need to inspect". — It is standard, safe and useful to explain that water can travel along pipes and joists before it shows, and that stains below a bathroom often relate to the bathroom above (the research's own real-world example). The agent says this tentatively.

## Water supply & pressure

10 call types served, 20 tentative explanations, 11 claims flagged.

**Unsafe**

- §1 question: "Is the water meter moving when no taps are being used?" — As a question it effectively sends the caller to check the meter, which in the UK is often in a pavement chamber or boundary box, and contradicts the worksheet's own rule not to guide meter checks. We only ask whether they have already noticed it.

**Not UK practice / US terms**

- §3 question: "Is a pump or pressure tank installed?" — "Pressure tank" is a US (well-system) term. UK equivalents are a loft cold-water tank, a shower or booster pump, an accumulator, or an unvented (pressurised) cylinder.
- §4 causes: "rust build-up around the water-heater connections", "water-heater connections or flexible supply hoses"; AI should tell the customer "not to touch or open the water heater". — US terminology and equipment. UK homes have a combi boiler or a hot-water cylinder (with immersion). The worksheet also omits the most common UK reason hot is weaker than cold: hot fed from a cylinder and loft tank (gravity) while cold comes from the mains.
- Customer examples use "faucet" (§3) and the research uses "toilet tank". — US terms. UK callers say tap and cistern; the agent should use UK wording (faucet kept only as a recognition keyword).

**Unsupported or overconfident**

- §4 customer example "The shower goes hot and then cold, then hot again" listed as low hot-water pressure. — Temperature swings are a different symptom (shower valve, combi flow rate, demand elsewhere) and should not be treated as a pressure problem. Handled under "pressure drops when another tap is used".
- §2 low pressure throughout the property — causes given only as "Regional Water Service Repair" and "Peak Hours Water Usage". — Omits common property-side causes (partly closed or old stopcock, a leak on the supply pipe, old narrow lead or galvanised supply pipe, gravity-fed system, scale). Listing only water-company causes risks the AI steering callers to blame the water company, the exact trap the receptionist research warns about.
- §6 "Sudden change / unusually high pressure" — causes include dirt at a tap outlet and limescale inside an older tap. — Dirt or scale at one tap reduces flow at that tap and usually builds gradually; it does not explain a sudden whole-house change or higher pressure. Only the supply-level explanation is served.
- §8 "Excessive water pressure may contribute to leaks at pipe connections, and the pressure-reducing valve (PRV) may need adjustment." — Many UK homes have no separate PRV (one is usually part of an unvented cylinder, or fitted in high-pressure areas). Linking a damp patch to high pressure is overconfident, and PRV adjustment must never be mentioned to a caller.
- §1 cause: "A burst pipe due to excessive pressure or an old pipe connection." — Attributing a burst to excessive pressure is stated without basis; in the UK, freezing and thaw, age and corrosion, or damage are at least as likely. Not served as a cause.

**Too cautious (we explain tentatively instead)**

- §2, §3, §5, §6 "What could the AI safely explain": gather information only; leave checks to the plumber; no diagnosis. — Too cautious, and inconsistent with the worksheet's own Part 4, which lists neighbours or area supply, single-outlet problems and post-work problems as explainable. Standard tentative explanations (area supply, busy times, one outlet, upstairs with a loft tank, several outlets at once) are safe and useful, and are served.
- §7 brown/cloudy water, spitting taps and banging pipes: AI may only "acknowledge the customer's observations". — Too cautious. Discoloured water after mains work, cloudy water from air that clears bottom up, air in pipes after the supply was off, and water hammer when a tap shuts are standard explanations UK water companies give themselves. Served tentatively, with no "safe to drink" statement.

## Taps, fixtures & installations

9 call types served, 21 tentative explanations, 8 claims flagged.

**Unsafe**

- Part 3 Q4, "What actions should the AI never instruct": the answer repeats Q3 word for word ("stop using the fixture... a water shut-off valve should only be operated if readily accessible and safe to use without force or tools"). — The question about what the AI must never instruct (dismantling, forcing, isolating, fitting) was not answered. Also, the shut-off valve advice is reasonable in principle, but it is isolation advice the client has not yet approved, so it is not served.

**Not UK practice / US terms**

- Customer examples use "faucet" (Part 1 §1, §3, §7, §8) and "toilet bowl" (§5, §7). — These are US terms. They are kept as caller keywords, but the agent should say "tap" and "toilet pan" or "toilet" back to UK callers.

**Unsupported or overconfident**

- Part 1 §5 and §6, "What could the AI safely explain": the answer repeats the "information for the plumber" answer word for word. — No explanation content was supplied for like-for-like or new-position installations. The tentative explanations used (fittings vary between models; new positions may need supply and waste extending) are drawn from Part 5 §3 and §6 of the same worksheet, not from these sections.
- Part 2 B: "advise the customer to keep away from the affected area" when water is near electrics. — The intent is right, but it is free-form safety wording. The agent must use the approved water_on_electrics script only, so this wording is not served.
- Part 1 §3 questions and causes include a "closed isolation valve" as a likely cause of no water from one tap. — This is plausible, but saying it to a caller invites them to start turning valves, which the client has not approved. It is kept for the engineer's notes only and not spoken.
- Part 1 §6: "Do you have a plumbing plan or floor plan showing the new position?" — Domestic callers rarely have plumbing plans, so this is low-value as a first question. It is replaced by asking whether supply and waste are near the spot, with plans or photos noted if offered.

**Too cautious (we explain tentatively instead)**

- Part 1 §1–§4, "What could the AI safely explain": only "the plumber will assess/inspect/check" for dripping taps, stiff or loose taps, no water from one tap and shower hose leaks. — Too cautious and inconsistent with the worksheet's own Part 4, which says these presentations can be given cautious probable explanations. Standard, tentative explanations (worn washer or cartridge, loose mounting, split hose, limescale) have been added.
- Part 1 §7 and §8, "What could the AI safely explain": only that the request will be passed to the team. — Too cautious for installations. The worksheet itself says compatibility depends on dimensions and connections, not brand, which is a safe and useful thing to tell a caller.
