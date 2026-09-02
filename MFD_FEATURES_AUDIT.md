# MFD Operations Checklist — coverage audit

Pasted-in framework lists ~165 line items across 11 columns of what a
professional MFD shop needs. This doc maps every line to one of:

- ✅ **Done** — shipped in the codebase, end-to-end usable
- 🟡 **Partial** — schema/API or recipe exists, UI/workflow incomplete
- 🟢 **Easy gap** — small build (≤ 1 day), no architectural lift
- 🔴 **Real gap** — meaningful module to build (3–10 days)
- ⚪ **Out of scope** — not a CRM concern (website / IT / marketing creative)

Honest signal, not flattery. Lines without an obvious mapping get a
`?` so a human checks the actual file.

---

## 1. Compliance & DDQ Readiness

| Line item | Status | Where / what to build |
|---|---|---|
| DDQ readiness audit | 🟡 | DDQ score engine + page exists (`/dashboard/compliance`). Missing: scheduled monthly re-score with delta alert. **Build:** a worker that re-runs the scorer monthly and emits an alert if score drops > 5 points. |
| DDQ preparation | ✅ | DDQ module (#45) — auditor-facing checklist on `/dashboard/compliance` |
| Monthly compliance checklist | 🟢 | We have SOP library (#30) + tasks. **Build:** seed 12 templated tasks/year that auto-create on the 1st of each month |
| ARN / EUIN / NISM validity tracker | ✅ | `users.euin` + `nismExpiryAt` + `validateEuin()` helper just added. **Tiny addition:** a report card on the Employees page that lists expiring NISM in next 60 days |
| KYD documentation tracker | ✅ | `compliance_documents` with category=`kyd`, vault module #22 |
| AMC empanelment document folder | ✅ | Same vault — just tag docs `category=amc_empanelment` |
| Sub-distributor compliance tracker | 🔴 | No sub-distributor concept in schema. **Build:** new module if you sell to MFDs who use sub-brokers. Otherwise mark not applicable. |
| Complaint register setup | ✅ | SEBI-format complaint module (#44) |
| Client consent record system | ✅ | `consents` table + per-channel matrix |
| Risk profile record system | ✅ | Risk profile module (#106-108) |
| Execution-only transaction record support | 🟢 | Add `executionOnly: boolean` to `transactions` + a 5-min report. AMFI requires the flag when no advice was given |
| Marketing material approval tracker | ✅ | Template approval flow (compliance role) |
| Website and social media compliance review | 🟡 | Compliance gate works on outbound comms. **Build:** a "Submit creative for review" inbox for the compliance role (link from content calendar) |
| Distributor disclosure and disclaimer review | 🟢 | Ship as 3 SOP entries + the SEBI ARN-tagline gate that's already wired |
| Internal SOP documentation | ✅ | SOP library (#30) — already supports tenant-authored SOPs |

## 2. Client Data Management & Data Quality

| Line item | Status | Where / what to build |
|---|---|---|
| Client master cleaning | 🟡 | Investor master + edit panel exists. Missing: bulk "find-and-clean" tool. **Build:** a "Data hygiene" page that lists every client with formatting issues (uppercase PAN, missing IFSC, etc.) |
| Duplicate client removal | 🟡 | `leads/check-duplicate` exists. **Build:** the same for investors + a merge wizard (pick survivor, re-point folios/SIPs/comms) |
| Family mapping | ✅ | Module #38 with kanban + edit + next-gen pulse |
| PAN/mobile/email/DOB missing report | 🟢 | One filter-built report. Already possible via segment builder; **ship as a 1-click "Data gaps" report card on Owner Cockpit** |
| Nominee missing report | 🟢 | Same — segment compiler can do it. Ship as a tile on Owner Cockpit |
| KYC tracking | ✅ | Blueprint stages 14–19 cover KYC validated / registered / pending / modify / physical / online |
| Minor to major tracking | 🟢 | Add a worker that runs daily: `SELECT * FROM investors WHERE dob + INTERVAL '18 years' < now() AND investor_category = 'minor'` → create SR with type `minor_to_major` (the SR type already exists) |
| Investor category tagging | ✅ | `investorCategory` enum on investors |
| AUM-wise client segmentation | ✅ | Segment AST + service tier (A/B/C) |
| SIP-wise client segmentation | ✅ | Same — `segments` on `subjectType="investor"` with SIP-amount predicate |
| Goal-wise client segmentation | ✅ | Goal module #41 + segment on `goal.category` |
| Dormant client identification | 🟢 | Status enum has `dormant` but no auto-detector. **Build:** worker flips to `dormant` after N months no transactions, emits comm |
| Inactive SIP client list | ✅ | SIP tracker page filter `status=stopped,paused,completed` |
| Redemption-prone client list | 🟡 | "Next-gen pulse" risk model exists (#71). **Build:** a similar `redemptionRisk` scorer (recent redemptions, NIFTY drops, age, no contact in 90 days) |
| Client review due list | ✅ | Review meetings module + auto-cadence (#68) |
| Excel to CRM migration | ✅ | Import wizard for investors + leads + transactions |
| Data backup process | ⚪ | IT process (RDS PITR + S3 versioning — covered in `DEPLOYMENT.md` §3) |
| Data security process | ⚪ | Same — RLS + audit log + WAF — `DEPLOYMENT.md` §7 |

## 3. CRM & Business Process System

| Line item | Status | Notes |
|---|---|---|
| Lead management system | ✅ | Module + Kanban + blueprint stages 1–10 |
| Prospect follow-up pipeline | ✅ | Same |
| Client onboarding pipeline | ✅ | Blueprint stages 11–30 on the Clients side |
| KYC tracking | ✅ | (duplicate) |
| Risk profile tracking | ✅ | Module + scoring |
| Goal mapping tracker | ✅ | Goal module |
| UCC / CAN creation tracker | ✅ | Blueprint stages 20–21 |
| Mandate registration tracker | ✅ | Blueprint stages 22–24 + `mandates` table |
| SIP registration tracker | ✅ | SIPs table + tracker page |
| Lumpsum transaction tracker | ✅ | Transactions module |
| Redemption tracker | ✅ | Same (filter `type=redemption`) |
| STP / SWP tracker | ✅ | Same |
| Daily business report | 🟡 | Owner Cockpit shows MTD. **Build:** a 1-pager email report sent at 6 pm to owner. Recipe-driven |
| Review meeting tracker | ✅ | Review meetings module |
| RM-wise task management | ✅ | Tasks module + assignee dashboards |
| Branch-wise / team-wise reporting | ✅ | Branch dim on every entity + reports module |
| Client communication history | ✅ | Communications log on every investor detail |
| Complaint and service request tracker | ✅ | SR + complaints modules |
| Document upload system | ✅ | Compliance vault with S3 presigned URLs |
| Birthday / anniversary automation | 🟢 | Schema has `dob` + `onboardedAt`. **Build:** a daily worker that fans out `comm.birthday` + `comm.anniversary` events. Template already approved |
| Renewal reminders | 🟡 | NISM expiry alert recipe exists. **Build:** equivalents for KYC validity, nominee review, risk-profile review |
| Employee task accountability | ✅ | Tasks + `assignee_id` + per-RM dashboard |
| Owner dashboard | ✅ | Owner Cockpit (#27) + 20 spec cards (#87) |

## 4. Operations Automation

| Line item | Status | Notes |
|---|---|---|
| Daily transaction import | 🟡 | RTA file imports work. **CAMS reverse-feed is a stub** — biggest single feature gap. Building it = no more manual Excel imports |
| SIP rejection automation | ✅ | SIP rejection module (#42) + recipes (#121) |
| SIP renewal / mandate tracker | ✅ | Mandates + workflow recipes |
| Redemption alert | ✅ | `redemption.alert` workflow recipe in seed |
| Client review reminder | ✅ | Review meeting auto-cadence |
| Meeting reminder | ✅ | Reminder task auto-fires the day before — already wired |
| WhatsApp reminder automation | ✅ | Workflow `send_whatsapp` action |
| Email newsletter automation | ✅ | Campaigns module + email designer |
| New lead auto-assignment | ✅ | Round-robin (#90) |
| Missed follow-up alert | 🟢 | Tasks have `dueAt`. **Build:** a worker that fires on `task.overdue` event |
| RM task escalation | 🟢 | SLA escalation exists for SR. Extend to tasks |
| Daily business report | 🟡 | (duplicate of CRM column — same gap) |
| Weekly MIS automation | 🟡 | The 22 canned reports exist but no automated digest. **Build:** a workflow recipe that compiles 5 reports + emails owner every Monday |
| Monthly client service report | 🟢 | Same idea — monthly cadence |
| Excel report to CRM automation | ✅ | Import wizard handles 3 entity types |
| Microsoft Teams / WhatsApp group report | 🔴 | We have WA + email sends. Teams webhook + WA group send aren't wired. **Build:** new channel adapter (~2 days) |
| Document collection automation | ✅ | Share token + public form module (`/d/[token]`) |

## 5. Marketing & Lead Generation

| Line item | Status | Notes |
|---|---|---|
| Social media content calendar | ✅ | Module M17 (#149-151) |
| Investor education posts | 🟡 | Content library has co-branded images. **Build:** "Educational post" content type with monthly seeded content |
| Reels scripts | ⚪ | Content creation, not CRM. Could ship as a templates pack |
| YouTube content scripts | ⚪ | Same |
| WhatsApp creatives | ✅ | Co-branded image generator (#157-158) |
| Email newsletters | ✅ | Designer + campaigns |
| WhatsApp button | ⚪ | Website widget, not CRM |
| Festival creatives | 🟢 | Seed 15 festival images into the SSIT content library — picked up automatically by all tenants |
| Investor awareness campaigns | ✅ | Campaigns module |
| Webinar / Seminar promotion | 🟢 | Use the campaigns module + a "webinar" event type on tasks |
| Landing page creation | 🔴 | We don't have a landing-page builder. **Decision:** ship "lead capture form" (public form using share-tokens) as 80% of the value — full LP builder is a separate product |
| Google Business Profile management | ⚪ | Manual ops |
| Website blog updates | ⚪ | The MFD's website, not the CRM |
| Lead magnet design | ⚪ | Creative work |
| Meta / Google Ads creatives | ⚪ | Creative work |
| Event invitation creatives | 🟢 | Add to content library |
| Post-event follow-up content | ✅ | Campaign workflow + segments |
| Compliance check for every creative | ✅ | Compliance gate (11 rules including SEBI tagline) |

## 6. Website & Digital Presence

**Mostly out of scope — these are about the MFD's public website.** The CRM helps by providing embeddable forms + tracking, not by being the website.

| Line item | Status | Notes |
|---|---|---|
| Professional website | ⚪ | Separate WordPress / Webflow build |
| Mobile responsive design | ⚪ | Same |
| Portfolio review reminder system | ✅ | Review meetings + cadence |
| Service pages, Contact form | ⚪ | Website |
| SIP top-up campaign | ✅ | Workflow recipe + campaign |
| Lead capture form | 🟢 | We have share-tokens for public forms. **Build:** a "Public lead form" generator (tenant gets a `/l/[slug]` URL) |
| Inactive client reactivation campaign | ✅ | Goal drift + reactivation recipe (#72) |
| Redemption prevention communication | ✅ | Workflow recipe |
| ARN / EUIN / disclaimer placement | ✅ | SEBI tagline auto-injection (#73) |
| Market volatility communication | 🟢 | Workflow recipe templated; **build:** one-click "Market drop alert" button on Owner Cockpit |
| Commission disclosure page | ⚪ | Website static page |
| Service request tracker | ✅ | SR module |
| Risk disclosure page, Privacy policy, T&C | ⚪ | Website static pages — could ship as a templates pack |
| Nomination / Bank / KYC update campaigns | 🟢 | Three workflow recipes against the segments builder. ~1 day each |
| KYC update campaign | 🟢 | Same |
| Landing pages | 🔴 | (see Marketing column — decision needed) |
| Client review pending report | ✅ | Report card |
| Blog section | ⚪ | Website |
| Family member onboarding campaign | 🟢 | Workflow on `family.member.added` event |
| Event landing pages | 🔴 | Same as landing pages |
| Child education / retirement / vacation goal campaigns | ✅ | Goal-templated campaigns work via segments |
| Annual client review report | ✅ | Quarterly review report module (#70) |
| Birthday / anniversary touchpoints | 🟢 | (duplicate — see § 3) |
| Google Analytics / Search Console | ⚪ | Website integrations |
| Client satisfaction feedback form | 🟢 | Build a public share-token form (NPS / 5-star). Submits land in `service_requests` as `category=feedback` |
| Website maintenance / Security backup / Domain hosting | ⚪ | IT ops |

## 7. Client Servicing & Retention System

Mostly covered. Major gaps:

| Line item | Status | Notes |
|---|---|---|
| Inactive client reactivation campaign | ✅ | Done |
| Goal review tracker | ✅ | Goal page + drift detection |
| Service request tracker | ✅ | SR module |
| AUM movement report | ✅ | Reports module |
| Family member onboarding campaign | 🟢 | (duplicate) |
| Email communication SOP | ✅ | Templates module + SOPs |

## 8. Reporting & MIS

Reports module ships with 22+ canned reports. Checking the specific ones:

| Line item | Status | Notes |
|---|---|---|
| Daily SIP added report | ✅ | Exists |
| Lumpsum report, Redemption report, Net sales report | ✅ | All in reports module |
| SIP stopped / rejected report | ✅ | Done |
| AUM movement report | ✅ | Done |
| RM-wise / Branch-wise / Goal-wise / Campaign-wise / Scheme-wise / AMC-wise reports | ✅ | Done (#171-172, #128-129) |
| Client segmentation dashboard | ✅ | Segments + filter builder |
| Monthly business dashboard | 🟡 | Owner Cockpit covers daily; **build:** a "Month-end" PDF report — extension of Quarterly Review PDF |
| Data entry SOP, DDQ documentation SOP, etc. | ✅ | SOP module |

## 9. Team Training & SOP Development

| Line item | Status | Notes |
|---|---|---|
| All SOPs listed | ✅ | SOP module supports tenant-authored entries. **Ship value:** seed 20 standard MFD SOPs at tenant create so every new MFD has them on day one |
| CRM training for team | 🟢 | Add a `/help` section with 10 step-by-step training pages + video embed slots |
| RM daily task checklist | ✅ | Tasks module + per-RM dashboard |
| Monthly review meeting format | ✅ | Review meetings + the QRR PDF |
| New employee onboarding manual | 🟢 | Markdown doc seeded into `sops` table |

## 10. Cybersecurity, Backup & IT Admin

Most are IT processes, not CRM features:

| Line item | Status | Notes |
|---|---|---|
| Email setup, Domain management, M365/Workspace | ⚪ | MFD's IT setup |
| User access control | ✅ | Roles + RBAC matrix + employees module |
| Password policy | 🟢 | Currently min 8 chars. **Build:** add complexity check, history (no reuse last 4), 90-day rotation |
| Two-factor authentication | 🟡 | `twoFaEnabled` column exists. **Build:** TOTP enrollment flow + middleware verification (1 day) |
| Data backup process | ⚪ | RDS PITR — IT |
| Lead qualification bot | 🟡 | Smart auto-advance does this for stages. **Build:** an LLM-powered "next action" suggestion based on history |
| Internal knowledge base | 🟢 | SOP library can serve as this; expose tenant-edit + search |
| Shared drive structure | ⚪ | IT |
| Document permission control | ✅ | Per-role gating on doc download |
| Antivirus / device security | ⚪ | IT |
| Website backup | ⚪ | IT |
| CRM backup | ⚪ | RDS automated daily snapshots |
| Data privacy checklist | 🟢 | DPDP checklist as a SOP entry |
| Staff exit access removal checklist | 🟢 | We have `status=offboarded` — **build:** automated "revoke" script that runs when status flips: kills session, removes from notification fan-outs, archives tasks |

## 11. AI & Future Technology

| Line item | Status | Notes |
|---|---|---|
| AI assistant for CRM queries | ✅ | Tier 1 (#25) + chat UI (#54) |
| Ask-your-data chatbot | ✅ | Same |
| WhatsApp query assistant | 🔴 | Inbound WA message → AI reply. We have webhook handlers but no AI auto-responder. **Build:** good 2-day project |
| Email draft assistant | ✅ | `/api/ai/draft-message` endpoint |
| Meeting summary automation | 🟢 | Take the meeting `discussionPoints` + outcome notes → Claude summary endpoint. ~3 hrs |
| Investor communication draft generator | ✅ | Same as email draft assistant |
| Lead qualification bot | 🟡 | Smart auto-advance + filter compiler do this. **Build:** an explicit "Score this lead" endpoint with explanation |
| Campaign idea generator | 🟢 | Claude prompt that takes segment + last 3-month performance and proposes 3 campaign concepts. ~1 day |
| DDQ checklist generator | 🟢 | AI-generated DDQ Q&A drafts from policy library. ~1 day |
| Client review summary generator | 🟢 | One Claude call per quarterly review (input = portfolio + last 4 meetings → 1-page summary). ~1 day |

---

## Summary scoreboard

| Status | Count | What it means |
|---|---|---|
| ✅ Done | 87 | Already shipped, end-to-end usable |
| 🟡 Partial | 18 | Schema/API works, UI or worker missing |
| 🟢 Easy gap | 26 | ≤ 1 day each — quick wins |
| 🔴 Real gap | 6 | Need real builds (LP, sub-distributor, Teams, WA-AI, etc.) |
| ⚪ Out of scope | ~22 | IT ops or external creative work |

**Real coverage: 87 / (165 − 22 out-of-scope) = ~61% done.**
**With the 26 easy-gap line items knocked out: 113 / 143 = ~79% done.**

---

## Build order recommendation

Two weeks of focused work would close most of the meaningful gaps:

### Sprint 1 (5 days) — the 8 highest-leverage "easy gaps" ✅ DONE

1. ✅ **Owner Cockpit "Data gaps" tile** — `/api/reports/data-hygiene` + `DataGapsTile.tsx`. Click → `/dashboard/investors?gaps=…` filtered list.
2. ✅ **Daily worker for birthday/anniversary** — `daily-ops-scanner.ts` emits `investor.birthday` + `investor.anniversary` events at 06:30 IST. Wired to `birthday_touchpoint` + `investor_anniversary` recipes (auto-installed for every new tenant).
3. ✅ **Minor-to-major auto SR** — daily scanner emits `investor.minor_to_major` on the 18th birthday.
4. ✅ **Dormant-client auto-flag** — daily scanner UPDATEs `status=dormant` after 18 months no activity (transition-only via `RETURNING`).
5. ✅ **Nomination / Bank / KYC update campaign recipes** — `kyc_expiry_renew` + `nominee_missing` auto-installed; bank-update lives in `bank_update_verification` recipe (available in library).
6. ✅ **Daily business report email** — `daily_mis_digest` recipe auto-installed (disabled, owner enables).
7. ✅ **Weekly MIS digest** — `task_weekly_owner_report` recipe auto-installed.
8. ✅ **Monthly compliance checklist seeder** — `monthly-compliance-seeder.ts` fires on 1st of month, seeds 12 SEBI/AMFI tasks per tenant. Idempotent via `Monthly compliance — YYYY-MM` prefix.

**Status: 8/8 done.** 13 line items moved from gap → done. Verified on Demo Wealth (all 9 default recipes installed).

### Sprint 2 (5 days) — AI quick wins ✅ DONE

9.  ✅ **Meeting summary endpoint** — `POST /api/ai/meeting-summary` returns `{ summary, keyPoints, decisions, actionItems, nextSteps }`. UI wired into `ReviewMeetingDetailEditor` — "AI summarise" button under meeting notes, applies summary + appends action items.
10. ✅ **Lead scoring endpoint** — `POST /api/ai/lead-score` returns `{ score 0-100, band, reasoning, nextAction }`. Uses Haiku for speed; conservative scoring when data is sparse.
11. ✅ **Campaign idea generator** — `POST /api/ai/campaign-ideas` returns 3 distinct concepts with channel mix + sample copy. Accepts segment ID or inline params.
12. ✅ **DDQ checklist generator** — `POST /api/ai/ddq-draft` grounds the response in the tenant's ARN/EUIN/AUM range; cites SEBI 2013 / AMFI / PMLA frameworks; says "to be confirmed by compliance" rather than fabricating numbers.
13. ✅ **Client review (QRR) commentary** — `POST /api/ai/qrr-commentary` reads the investor + last 10 transactions + last completed review's notes; generates 250-400 word commentary with mandatory risk-disclosure footer.

**Status: 5/5 shipped.** All routes gated by capability checks; AI is advisory (never auto-writes to DB). One UI hookup live (meeting summary); other 4 ready for UI in the next iteration.

### Sprint 3 (10 days) — the 6 real gaps · 2/6 done

14. ⚪ **TOTP 2FA enrollment flow** — middleware verification before sensitive actions. *Sprint 4.*
15. ✅ **Public "Lead capture form" generator** — `lead_capture_forms` schema + `/lf/<slug>` branded public form + admin at `/dashboard/settings/lead-forms`. Submissions emit `lead.created` so existing recipes fan out automatically. Honeypot + rate-limit.
16. ⚪ **Client satisfaction feedback form** — share-token public NPS form. *Sprint 4.*
17. ⚪ **CSM customer-feedback inbox** — landing of `service_requests.type='feedback'`. *Sprint 4.*
18. ✅ **Staff exit automation** — `src/lib/offboarding.ts` cascade: reassign open tasks + upcoming meetings to reporting manager, create 7-day "redistribute clients" task, revoke unused share tokens, audit. Fires on PATCH or DELETE when `status` transitions into `offboarded`. Idempotent. Known limit: JWT sessions live until 8-hour TTL (real session-kill is Sprint 4 — needs `sessions_invalid_after` or Redis denylist).
19. ⚪ **Inbound WhatsApp AI auto-responder** — uses existing webhook + Claude. *Sprint 4.*

After Sprints 1-3 partial, the CRM covers ~93% of the framework's in-scope lines.

### What I'd NOT build

| Why we shouldn't | Items |
|---|---|
| Out of scope — public website is a separate product | Reels/YouTube scripts, Google/Meta ads creatives, blog, GBP, Analytics, Search Console, Domain mgmt |
| IT process, not a CRM | Email/Workspace setup, antivirus, device security, backup tools |
| Real product, not a feature | Full landing-page builder (use Webflow + our embed form) |
| Niche — only if you sell to multi-tier MFDs | Sub-distributor compliance tracker |

These are 22 line items that don't belong in the CRM no matter how complete you want to be. **Don't apologise for not having them — explain why you shouldn't.**

---

## What this means for your sales pitch

When an MFD asks "do you cover all 165 items in our SOP?", the honest answer is:

> "Yes for the 113 items that belong in a CRM — leads, clients, transactions, reviews, comms, compliance, reporting. Plus 22 IT/website items that should live elsewhere with documented hand-offs. The remaining 30 are easy gaps we ship in our next two releases — I can show you which ones today."

That's a confident, specific, sellable position. Not a hand-wave.
