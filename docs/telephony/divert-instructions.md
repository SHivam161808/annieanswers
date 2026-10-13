# Conditional call divert to the AI receptionist (T-110, T-111)

Routing **pattern A** (Build Plan default, FR-02): the business keeps its own number. When the owner
does not answer, is on another call, or has no signal, the network sends the call to the business's
**GHL UK number**, where the Voice AI agent answers directly (agent set to answer directly,
`isAgentAsBackupDisabled: true`; see `docs/ghl-capabilities.md`).

Audience: agency staff walking a plumbing business owner through set-up, usually on a phone call or
in person. Allow 10 minutes, plus 5 minutes for the test.

Anything marked **⚠ verify** has not been confirmed against the network's own current help pages or
on a real handset. Confirm it the first time you do it and update this page.

---

## 1. Before you start

| Check                                                          | Why                                                                                                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The client's GHL number is attached to their agent and working | Ring the GHL number directly first. If the AI doesn't answer there, a divert won't help.                                                                                         |
| Write the GHL number in **+44 format**, no spaces              | e.g. `+441174633467` (DEMO). Vodafone's help page uses +44 format in the codes; it works on every network. Some networks reject a leading 0 in MMI codes (⚠ verify per network). |
| Which network / landline provider is the owner on?             | Codes and timers differ (sections 2 and 4).                                                                                                                                      |
| Pay monthly or pay as you go?                                  | Vodafone says **PAYG can only divert to voicemail**. Other PAYG plans may have the same limit (⚠ verify). A PAYG owner may need to switch plan or use pattern B.                 |
| Does the owner currently use their network voicemail?          | Setting the no-answer divert **replaces** the voicemail divert. Missed calls will go to the AI, not to voicemail. Tell the owner this before you start.                          |
| Is "divert all calls" (unconditional) switched on?             | An active all-calls divert overrides the conditional ones. Check with `*#21#` and cancel with `##21#` first.                                                                     |

---

## 2. Mobile: the standard GSM codes

The divert codes are part of the GSM standard (ETSI TS 122 030), so they are the same on EE,
Vodafone, O2 and Three. Type them on the **phone keypad** (the dialler) and press call. The phone
shows a confirmation message from the network.

Replace `NUMBER` with the GHL number in +44 format.

| Purpose                                         | Set up                   | Check   | Cancel            |
| ----------------------------------------------- | ------------------------ | ------- | ----------------- |
| Divert when **not answered**                    | `**61*NUMBER#`           | `*#61#` | `##61#`           |
| Divert when **busy** (engaged/declined)         | `**67*NUMBER#`           | `*#67#` | `##67#`           |
| Divert when **unreachable** (off/no signal)     | `**62*NUMBER#`           | `*#62#` | `##62#`           |
| All three at once (conditional)                 | `**004*NUMBER#` ⚠ verify | —       | `##004#` ⚠ verify |
| Divert **all** calls (do NOT use for pattern A) | `**21*NUMBER#`           | `*#21#` | `##21#`           |
| Cancel **every** divert, including voicemail    | —                        | —       | `##002#`          |

Set up the three conditional diverts **separately** (61, 62, 67). The combined `**004*` code is part
of the GSM standard but we have not confirmed it on UK networks (⚠ verify); doing them one by one
lets you check each.

**Warning about `##002#`:** it cancels all diverts, including the one that sends missed calls to the
owner's voicemail. If the owner later stops using the service, they will need to set voicemail up
again (section 2.3), or they will have no voicemail at all.

### 2.1 No-answer timer (how long the owner's phone rings first)

The no-answer divert takes an optional ring time. Calls ring the owner for that many seconds, then go
to the AI.

| Network  | Code with timer                                       | Range                                                                             |
| -------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Vodafone | `**61*NUMBER*10*SECONDS#` (Vodafone's published form) | Vodafone does not publish the allowed range (⚠ verify)                            |
| O2       | `**61*NUMBER*11*SECONDS#`                             | Sources say 5–25 s or 5–30 s in 5-second steps (⚠ verify)                         |
| EE       | `**61*NUMBER*11*SECONDS#` ⚠ verify                    | EE does not publish a ring-time code. EE community posts say 5–25 s (⚠ verify)    |
| Three    | `**61*NUMBER*11*SECONDS#` ⚠ verify                    | Three does not publish divert codes. Use the handset menu if the code is rejected |

The `10` / `11` in the middle is a GSM "service" field. `11` means voice calls. `10` means all
voice-type services. Either should work for voice calls (⚠ verify on each network). Use a multiple of 5.
Some sources say other values are rounded.

**Recommended timer: 20 seconds** (proposal). Shorter means the owner rarely gets a chance to answer.
Longer means callers hang up before the AI answers. Agree it with the owner and record it in the
onboarding record. If no timer is given, the network default applies. O2 says the default is 30 s
(⚠ verify). We could not find the default for the other networks.

### 2.2 Network-specific differences

| Network                                                                       | What's different                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EE** (and BT Mobile)                                                        | EE's own business help page gives a **150 voice menu**: dial 150, then 1, 2, 4, 1 to set up a divert (1, 2, 4, 2 to remove). EE says diverts must be set up from the phone itself, not by customer services. EE's help page lists conditional diverts as "busy or unanswered". The GSM codes also work according to an EE community moderator (⚠ verify). BT Mobile runs on EE. |
| **Vodafone** (and VOXI, Asda Mobile ⚠ verify host)                            | The only one of the four with a full published code list (matches the table above). **PAYG: voicemail only.** Diverts only to UK numbers. Ring-time format uses `*10*`.                                                                                                                                                                                                         |
| **O2** (and Tesco Mobile, giffgaff ⚠ verify host)                             | Standard codes. O2 help gives the `*11*` ring-time form. Diverting to anything other than O2 voicemail is charged (see section 5).                                                                                                                                                                                                                                              |
| **Three** (and Smarty ⚠ verify host)                                          | Three **does not publish** divert codes. The standard codes usually work but are not a documented, supported Three feature. If a code fails, use the handset settings (section 3). One third-party source says a conditional divert sometimes needs the phone restarting before it takes effect (⚠ verify).                                                                     |
| **MVNOs** (giffgaff, Tesco Mobile, Sky Mobile, iD Mobile, Lebara, Lyca, etc.) | MVNOs run on a host network and normally behave like it. Host networks quoted by third parties: giffgaff → O2, Tesco Mobile → O2, Sky Mobile → O2, iD Mobile → Three, Smarty → Three, VOXI → Vodafone, Asda Mobile → Vodafone, BT Mobile → EE (**all ⚠ verify**; MVNOs sometimes change host). PAYG restrictions may apply. Check the MVNO's own help page.                     |

### 2.3 Putting voicemail back (if the client leaves)

Point the no-answer, busy and unreachable diverts back at the network voicemail number. Third-party
sources give the following numbers. **All ⚠ verify** with the network before using:

| Network  | Voicemail number to divert to |
| -------- | ----------------------------- |
| EE       | `+447953222222`               |
| Vodafone | `+447836121121`               |
| O2       | `901`                         |
| Three    | `+447782333123`               |

If unsure, the owner can ring their network and ask for voicemail to be switched back on.

---

## 3. Mobile: phone settings instead of codes

Use this when a code is rejected, or the owner prefers menus. Menu names vary by model, software
version and network.

| Phone                            | Path                                                                                                           | Conditional options?                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **iPhone**                       | Settings → Apps → Phone → Call Forwarding (iOS 18 and later); Settings → Phone → Call Forwarding (earlier iOS) | **No.** The iPhone menu forwards **all** calls only (unconditional). That is **not** pattern A: the owner's phone would never ring. **On iPhone, use the keypad codes** (section 2) or EE's 150 menu. |
| **Samsung (Android)**            | Phone app → ⋮ (More) → Settings → Supplementary services → Call forwarding → (choose SIM) → Voice calls        | Yes: _Always forward_, _When busy_, _When unanswered_, _When unreachable_. Set the last three; leave _Always forward_ off. Some models let you set the no-answer delay here (⚠ verify).               |
| **Google Pixel / other Android** | Phone app → ⋮ → Settings → Calling accounts → (SIM) → Call forwarding ⚠ verify exact names                     | Usually the same four options as Samsung (⚠ verify).                                                                                                                                                  |

The handset menu sends the same request to the network as the codes. Afterwards, check with `*#61#`,
`*#62#`, `*#67#`.

---

## 4. Landlines and office phone systems

### 4.1 BT landline (including BT Digital Voice)

BT calls the service **Call Diversion**. BT's codes use a **single** star.

| Purpose                              | Set up        | Check   | Cancel |
| ------------------------------------ | ------------- | ------- | ------ |
| Not answered within **15 seconds**   | `*61*NUMBER#` | `*#61#` | `#61#` |
| Busy (engaged)                       | `*67*NUMBER#` | `*#67#` | `#67#` |
| All calls (do NOT use for pattern A) | `*21*NUMBER#` | `*#21#` | `#21#` |

- Dial from a touch-tone phone on that line. With Digital Voice, use a phone plugged into the BT Hub,
  or the Digital Voice handset menu: Calling Features → Call Diversion → Set Up.
- The no-answer time is fixed at **15 seconds** on BT. We found no option to change it.
- There is **no "unreachable" divert** on a BT landline. A landline can't be switched off like a
  mobile can. A line or Hub fault is a different matter (⚠ verify BT's behaviour on a Hub power cut).
- Use the GHL number with a leading 0 on a landline, e.g. `01174633467`. Whether BT accepts +44
  format is ⚠ verify.
- An intermittent dial tone when lifting the handset shows a divert is active.
- BT Business: Call Diversion is a paid add-on that must be ordered. BT Digital Voice: included.
  See section 5 for call charges.

### 4.2 Other landline providers (Sky, Virgin Media, TalkTalk, Vodafone, etc.)

Many use the same star codes (`*61*`, `*67*`, `*21*`), but the feature may need ordering or may cost
extra. ⚠ verify with the provider's help page for each client. Do not assume BT's codes work.

### 4.3 Hosted VoIP / cloud phone systems (3CX, RingCentral, Microsoft Teams Phone, Vonage, etc.)

These systems are configured in the admin portal or user app, not with star codes. They all offer
conditional forwarding. The menu names differ (all **⚠ verify** on the client's system):

| System                | Where to look (generic)                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 3CX                   | The extension's forwarding rules / status profiles (separate rules for no answer and busy)                        |
| RingCentral           | User → Call handling and forwarding (business-hours and after-hours rules, ring time, then forward)               |
| Microsoft Teams Phone | Teams Settings → Calls → call answering rules ("If unanswered" → forward to a number); admin can set it centrally |
| Vonage Business       | Extension call forwarding settings, and "call continuity" for when the device is offline                          |

What to set, whatever the system:

1. Forward on **no answer** after the agreed ring time (15–20 s) to the GHL number (external number).
2. Forward on **busy** to the GHL number.
3. Forward on **unreachable / offline / device unregistered** to the GHL number, if offered.
4. Leave "forward all calls" off.
5. Check the system allows forwarding to an **external** number. Some plans restrict or charge for
   it, and some need an outbound call permission on the extension.
6. If a ring group or hunt group is the published number, set the overflow / final destination of
   the **group**, not just one person's extension.

---

## 5. Charges

Tell the owner plainly: **a diverted call is billed to them as if they had rung the GHL number.**

| Who                  | What we found                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mobile, monthly plan | Usually comes out of inclusive UK minutes, because the GHL number is a standard UK geographic (01/02) number. Charged at the plan rate once minutes run out. EE (Small Business) and Vodafone say this; O2 and Three are charged similarly per third-party sources (⚠ verify). |
| Mobile, PAYG         | Vodafone PAYG cannot divert to another number. Others: ⚠ verify.                                                                                                                                                                                                               |
| Roaming              | If the owner is abroad, the diverted leg may be charged at roaming rates (EE says normal roaming charges apply). Set diverts up before travelling.                                                                                                                             |
| BT landline          | Call Diversion included with Digital Voice. Diverted calls to non-BT services are charged at the standard rate (duration + set-up fee) unless covered by a call package. Amounts: ⚠ verify the current BT tariff.                                                              |
| GHL side             | Inbound minutes on the LC Phone number and Voice AI minutes are charged to the agency's GHL account. Rates: ⚠ verify current GHL pricing; not covered here.                                                                                                                    |

Setting, checking and cancelling diverts is free, according to a third-party guide (⚠ verify per
network).

---

## 6. Verify it works (do this with the owner, every time)

Use a **different phone** to ring the owner's business number. Do not use the owner's phone or the
GHL number. Record each result in the client's onboarding record.

| #   | Test                     | How                                                                                                                      | Pass                                                                                                                                                          |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Divert status            | On the owner's mobile dial `*#61#`, `*#62#`, `*#67#`. (BT: `*#61#`, `*#67#`.)                                            | Each shows the GHL number. `*#21#` shows **not active**.                                                                                                      |
| 2   | **No answer**            | Ring the owner's number. Owner lets it ring and does not touch the phone.                                                | Owner's phone rings for about the agreed time, then the AI greeting plays: "<business name>, virtual assistant speaking. Calls are recorded. How can I help?" |
| 3   | **Busy**                 | Ring the owner's number. Owner presses **Decline**. (Or ring while the owner is on another call, with call waiting off.) | AI greeting plays straight away.                                                                                                                              |
| 4   | **Unreachable** (mobile) | Owner switches the phone off or turns on flight mode. Wait 1 minute, then ring.                                          | AI greeting plays without ringing first.                                                                                                                      |
| 5   | Owner still gets calls   | Ring again. Owner answers.                                                                                               | Normal call with the owner. No AI.                                                                                                                            |
| 6   | GHL record               | In the client's sub-account, open the Voice AI call log.                                                                 | Calls 2–4 appear. The caller's number shown is the **test caller's number**, not the owner's (⚠ verify: see the troubleshooting table).                       |
| 7   | Clean up                 | End each AI call by saying it's a test. Tell the team which test contacts were created so they are not followed up.      | No owner alert for test calls. If one fires, check the outcome code.                                                                                          |

Turn the owner's phone back on after test 4.

---

## 7. Troubleshooting

| Symptom                                                                            | Likely cause                                                                                                                                                        | Fix                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Setting activation failed" / "Connection problem or invalid MMI code"             | Typo, wrong number format, PAYG restriction, or the network doesn't accept the code                                                                                 | Retype with the +44 number and no spaces. Try the handset menu (section 3). On Three, use the menu. On PAYG, ring the network.                                                                                                       |
| Missed calls still go to voicemail                                                 | No-answer divert not set, or the voicemail divert came back                                                                                                         | `*#61#`. Set `**61*NUMBER#` again.                                                                                                                                                                                                   |
| Owner's phone never rings; every call goes to the AI                               | **All calls** divert (`21`) is active, often from the iPhone Settings toggle                                                                                        | `##21#` (BT: `#21#`), and turn off iPhone Settings → Call Forwarding. Then set the conditional diverts again.                                                                                                                        |
| Declined calls go to voicemail, not the AI                                         | Busy divert (`67`) missing                                                                                                                                          | `**67*NUMBER#`                                                                                                                                                                                                                       |
| Phone switched off: caller hears "the person you are calling is not available"     | Unreachable divert (`62`) missing, or Wi-Fi calling changes how "unreachable" behaves (⚠ verify)                                                                    | `**62*NUMBER#`. Test again with Wi-Fi off.                                                                                                                                                                                           |
| When on a call, a second caller hears call waiting and then the AI after the timer | Call waiting is on, so the line isn't "busy" and the **no-answer** divert applies instead                                                                           | This is expected. If the owner wants a busy caller to go to the AI straight away, turn call waiting off (⚠ verify the menu on the handset).                                                                                          |
| Callers hang up before the AI answers                                              | Timer too long                                                                                                                                                      | Set 15–20 s (section 2.1). On BT it is fixed at 15 s.                                                                                                                                                                                |
| Unknown or withheld callers skip the owner and go straight to the AI or voicemail  | Phone features such as iPhone "Silence Unknown Callers", Focus/Do Not Disturb or Android call screening. These may count as declined (busy) or no answer (⚠ verify) | Explain to the owner. Turn the feature off if they want those calls to ring first.                                                                                                                                                   |
| AI answers but greets with the wrong business                                      | Wrong GHL number used in the divert, or the number is attached to another sub-account's agent                                                                       | Check the number with `*#61#` against the client's sub-account phone numbers.                                                                                                                                                        |
| Ringing then silence, or "number not recognised"                                   | GHL number not active / not attached to the agent, or a regulatory bundle issue                                                                                     | Ring the GHL number directly. If that fails, fix it in GHL first (Settings → Phone System → Phone Numbers).                                                                                                                          |
| Call log shows the **owner's** number as the caller                                | The forwarding network or GHL presented the diverting number instead of the original caller ID (⚠ verify)                                                           | Check the GHL number setting "Phone number I see when receiving the call" (Settings → Phone System → Phone Numbers → ⋮ → Edit Configuration). Test from another network. Escalate to the developer: callback numbers depend on this. |
| Works on a mobile, not from a landline                                             | Landline provider blocks or charges for diverting to that number type                                                                                               | Ring the provider.                                                                                                                                                                                                                   |
| Divert set on a VoIP system but no calls reach the AI                              | Forwarding to external numbers not allowed, or the rule is on the wrong extension/group                                                                             | Section 4.3, points 5–6.                                                                                                                                                                                                             |
| Divert stopped working after a SIM swap, new phone or plan change                  | Network reset the diverts                                                                                                                                           | Run section 6 again after any phone or plan change. Put this in the owner's handover note.                                                                                                                                           |

---

## Sources

Checked October 2026. Third-party sources are used only where the network publishes nothing; those
facts are marked ⚠ verify above.

- Vodafone UK, "How do I manage call diverts?" — https://www.vodafone.co.uk/help/mobile/how-do-i-manage-call-diverts
- Vodafone UK Business, "How do I manage call diverts?" — https://www.vodafone.co.uk/business/help/mobile-services/manage-call-diverts
- EE Business, "How do I set up and manage call diverts?" — https://business.ee.co.uk/help/ee-getting-started/manage-call-diverts/
- EE Community, "Call divert" thread (codes are industry standard; ring time range) — https://community.ee.co.uk/t5/Mobile-Services/Call-divert/m-p/1609121/highlight/true
- University of Cambridge, "Managing your voicemail & diverts" (O2 codes, ring time) — https://www.phone.cam.ac.uk/your-phone/mobile/voicemail
- Plan.com, "How do I set up call forwarding or diverts?" (O2 codes; iPhone toggle is unconditional) — https://help.plan.com/hc/en-gb/articles/14927022399133-How-do-I-set-up-call-forwarding-or-diverts
- Connection Technologies, "Call divert iPhone UK 2026: every network MMI codes" (third party; MVNO hosts, voicemail numbers, Three) — https://connection-technologies.co.uk/call-divert-iphone-uk-2026-every-network-mmi-codes-step-by-step/
- Connection Technologies, "Three call forwarding" (third party) — https://connection-technologies.co.uk/help/call-forwarding/three-call-forwarding
- BT Business, "Using call diversion to forward calls" — https://business.bt.com/help/article/using-call-diversion-to-forward-calls/
- BT, "All about Call Diversion for Digital Voice" — https://www.bt.com/help/landline/all-about-call-diversion-for-digital-voice
- Samsung, "How to enable/disable the call forwarding feature" — https://www.samsung.com/ph/support/mobile-devices/how-to-enable-or-disable-the-call-forwarding-feature-in-your-samsung-galaxy-smartphone/
- HighLevel, "Overview of Phone Number Configuration Options" — https://help.gohighlevel.com/support/solutions/articles/48001229976-phone-number-settings-explained
- ETSI TS 122 030 (GSM MMI procedures), referenced via the above; not read directly.
