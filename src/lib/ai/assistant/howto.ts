/**
 * SSIT CRM Copilot — PROCESS knowledge ("how do I …?").
 *
 * The copilot knows the firm's DATA (tools.ts) but was blind to how SSIT CRM
 * itself works, so "how do I convert a lead?" got answered with a lead COUNT.
 * This is the procedural half: step-by-step guides for the real workflows,
 * grounded in the actual routes and the actual stage machine — not invented.
 *
 * Keep every step truthful. If a flow changes in the product, change it here.
 */

export type HowTo = { id: string; title: string; match: RegExp; body: string };

export const HOWTOS: HowTo[] = [
  {
    id: "lead_to_client",
    title: "Lead → Client",
    match: /\b(convert|conversion)\b.*\b(lead|client)\b|\blead\b.*\b(to|into)\b.*\bclient\b|\bclient\b.*\bfrom\b.*\blead\b|\blead\b.*\bconvert\b/i,
    body: `**Lead → Client — the full process**

1. **Create the lead** — [Leads](/dashboard/leads) → *New lead*. You can also bulk-load via [Import leads](/dashboard/leads/import), or let your website capture form create them automatically.
2. **Work the pipeline** — open the lead and move it along as things happen:
   \`new → contacted → meeting_scheduled → meeting_done → risk_profile_sent → risk_profiled → proposal_drafted → proposal_shared → proposal_approved → docs_requested → docs_received → converted\`
   (\`follow_up\`, \`lost\` and \`not_interested\` are the off-ramps.)
3. **Risk-profile them** — [Risk Profile](/dashboard/risk-profiles) → new profile. The client confirms with an email OTP at the end and you get a signed PDF.
4. **Share a proposal** — [Proposals](/dashboard/proposals) → build it, share it, mark it approved once they agree.
5. **Collect documents & KYC** — request the docs; KYC must be in order before they can transact.
6. **Convert** — on the lead, hit **Convert**. **PAN is mandatory** (you can also set segment, category and RM). This:
   • creates the Client from the lead's name / email / phone / city + the PAN you supply,
   • stamps the lead \`converted\` and links it to the new client,
   • fires your welcome / onboarding automations.
7. **Finish the profile** — the client now appears in [Clients](/dashboard/investors). Add nominee, bank and family details and you're live.

**Heads-up:** conversion needs an active licence and a free client slot on your plan.`,
  },
  {
    id: "add_lead",
    title: "Add a lead",
    match: /\b(add|create|new|capture)\b.*\blead/i,
    body: `**Adding a lead**

- **One at a time** — [Leads](/dashboard/leads) → *New lead*. Name + a way to reach them is enough to start; stage begins at \`new\`.
- **In bulk** — [Import leads](/dashboard/leads/import): upload your sheet, map the columns, review, commit.
- **Automatically** — your public lead-capture form creates leads straight from your website.

Then work it through the stages — see *"how do I convert a lead to a client?"* for the full path.`,
  },
  {
    id: "add_client",
    title: "Add a client",
    match: /\b(add|create|new|onboard)\b.*\b(client|investor)\b/i,
    body: `**Adding a client**

- **Manually** — [Clients](/dashboard/investors) → *Add investor*.
- **In bulk** — [Import clients](/dashboard/investors/import): upload, map columns, review, commit.
- **From a lead** — convert the lead (PAN required) — see *"how do I convert a lead to a client?"*.
- **From your RTA** — import the CAMS / KFintech master so clients, folios and holdings arrive with real data: [RTA import](/dashboard/imports) or [RTA Imports](/dashboard/rta-imports).

Every route enforces your plan's client limit, and PAN is what de-duplicates a client.`,
  },
  {
    id: "risk_profile",
    title: "Risk profile a client",
    match: /\b(risk\s*profil|risk\s*assessment|suitability\s*profile)/i,
    body: `**Running a risk profile**

1. [Risk Profile](/dashboard/risk-profiles) → *New* (or start it from the client's page).
2. Pick the client — the questionnaire uses your firm's published template (falls back to the SEBI default).
3. Answer the questions; you see the live score and band as you go.
4. On **Review**, add any RM remarks, then the client confirms with a **one-time code sent to their email** — that's the compliance signature.
5. Submit → the profile is saved and you can download the signed **PDF** right away.

Profiles carry a review interval, so [Risk Profile](/dashboard/risk-profiles) will show you who's due for a refresh.`,
  },
  {
    id: "import_rta",
    title: "Import from CAMS / KFintech",
    match: /\b(rta|cams|kfin|karvy|mailback|wbr\s*9|mfsd)\b/i,
    body: `**Importing your RTA book**

- **Master / holdings** — [RTA import](/dashboard/imports): upload the CAMS (WBR9) or KFintech (MFSD211/203) file. It de-duplicates by PAN + folio, links minors to guardians, and creates clients/folios you don't already have.
- **Transaction feed** — [RTA Imports](/dashboard/rta-imports) for the ongoing feed.
- **Email forwarding** — RTA mailback reports can be auto-imported from a forwarding mailbox, so the book stays current without manual uploads.

Re-importing the same file overwrites rather than duplicating, so it's safe to re-run.`,
  },
  {
    id: "task",
    title: "Create a task",
    match: /\b(task|to.?do|follow.?up|reminder)\b/i,
    body: `**Tasks**

- Create one from [Tasks & Requests](/dashboard/tasks), or straight off a client / lead so it stays linked to them.
- Set assignee, priority and a due date — overdue items surface on your dashboard and in *"my overdue tasks"* here.
- Automations create tasks for you too (birthdays, SIP rejections, review due, etc.) via [Workflows](/dashboard/workflows).`,
  },
  {
    id: "meeting",
    title: "Schedule a review meeting",
    match: /\b(meeting|review\s*meeting|schedule.*(call|meet))\b/i,
    body: `**Review meetings**

1. [Meetings](/dashboard/review-meetings) → schedule against a client (or a lead / family).
2. Set the date, category and the RM attending.
3. After it happens, mark the outcome (ready / more info / not ready / not interested) — that's what moves a lead forward in the funnel.

Ask me *"meetings this week"* or *"overdue review meetings"* any time.`,
  },
  {
    id: "proposal",
    title: "Build a proposal",
    match: /\bproposal|recommend.*portfolio|pitch\b/i,
    body: `**Proposals**

1. [Proposals](/dashboard/proposals) → new proposal for the client.
2. Build the recommendation — it's checked against the client's risk profile for suitability, so profile them first.
3. Share it with the client; they can approve it from the link.
4. Approval moves the lead/client forward and feeds the onboarding steps.`,
  },
  {
    id: "insurance",
    title: "Add an insurance policy",
    match: /\b(insurance|policy|policies|premium)\b/i,
    body: `**Insurance**

- Add and track policies in [Insurance Policies](/dashboard/insurance) — insurer, plan, premium, sum assured and the next premium due date.
- Claims live in [Insurance Claims](/dashboard/insurance-claims).
- Because due dates are tracked, you can ask me *"renewals due in 30 days"* and I'll list them.`,
  },
  {
    id: "automation",
    title: "Set up an automation",
    match: /\b(workflow|automation|automate|recipe|trigger|journey|drip)\b/i,
    body: `**Automations (Workflows)**

1. [Workflows](/dashboard/workflows) → start from the **recipe library** (pre-built MFD plays: SIP rejection follow-up, birthday wishes, welcome onboarding, review due, and more) or build your own on the canvas.
2. A workflow is: a **trigger** (a domain event like \`lead.converted\`, a schedule, or a segment change) → **actions** (send WhatsApp / email / SMS, create a task, branch, wait).
3. Publish it. Runs already in flight keep using the version they started on, so editing never breaks a live journey.

Every outbound message still passes the consent + compliance gate before it sends.`,
  },
  {
    id: "campaign",
    title: "Send a campaign",
    match: /\b(campaign|broadcast|bulk\s*(message|email|whatsapp)|newsletter)\b/i,
    body: `**Campaigns**

1. Build the message in [Templates](/dashboard/templates) — WhatsApp templates need Meta approval before they can go out.
2. Create the campaign in [Campaigns](/dashboard/campaigns) and choose who it goes to.
3. Send. Every recipient runs through consent → compliance → channel, and anything skipped is logged with a reason in [Communications](/dashboard/communications).

I can draft the copy for you — just ask *"draft a WhatsApp for dormant clients"*.`,
  },
  {
    id: "duplicates",
    title: "Fix duplicate clients",
    match: /\b(duplicate|dedupe|merge|same\s*pan)\b/i,
    body: `**Duplicates**

[Find Duplicates](/dashboard/duplicates) groups clients that share a PAN or mobile. Review each group and merge — the survivor keeps the folios and history, and the merged record is linked, not deleted.

Your Clients list also shows a banner when it spots likely duplicates.`,
  },
  {
    id: "family",
    title: "Map a family",
    match: /\b(family|household|group\s*clients|family\s*head)\b/i,
    body: `**Family mapping**

Use [Family Mapping](/dashboard/families) to group members under a family head. That gives you household-level AUM and lets you run family-level reviews instead of chasing each member separately.`,
  },
  {
    id: "team",
    title: "Add a team member",
    match: /\b(employee|team\s*member|invite|staff|rm)\b.*\b(add|invite|create|new|onboard)\b|\b(add|invite)\b.*\b(employee|team|user|rm)\b/i,
    body: `**Adding a team member**

1. [Employees](/dashboard/employees) → invite by email and pick their role (RM / ops / compliance / branch head / marketing).
2. They set their own password from the invite link.
3. Seats are capped by your plan, and you must have verified your own email before inviting.

Offboarding redistributes their clients and revokes their sessions.`,
  },
  {
    id: "documents",
    title: "Collect documents",
    match: /\b(document|kyc\s*doc|upload|file)\b/i,
    body: `**Documents**

Store and request client documents from [Documents](/dashboard/documents). You can send a public collection link so the client uploads without logging in, and the file lands against their record.`,
  },
  {
    id: "reports",
    title: "Find a report",
    match: /\b(report|mis|analytics|dashboard)\b/i,
    body: `**Reports**

[Reports & MIS](/dashboard/reports) is the hub — business MIS, KYC tracker, nomination tracker, churn-risk radar, tax-harvesting, cross-sell radar, trail forecast and more.

You can also just ask me — *"business trend last 6 months"*, *"AUM by segment"*, *"dormant clients"* — and I'll pull it straight from your live data.`,
  },
];

/** True when the message is asking HOW to do something (not for a number). */
export function isHowToQuestion(q: string): boolean {
  return /\b(how\s+(do|can|should|would|to|does)|what'?s\s+the\s+(process|procedure|step)|step.?by.?step|steps?\b|process\s+(for|to|of)|procedure|guide\s+me|walk\s+me\s+through|where\s+(do|can|should)\s+i|how\s+is\s+.*\bwork|explain\s+how|tutorial|teach\s+me)\b/i.test(q);
}

/** Best-matching guide for a how-to question, or null. */
export function findHowTo(q: string): HowTo | null {
  for (const h of HOWTOS) if (h.match.test(q)) return h;
  return null;
}

/** Shown when it's clearly a how-to but no specific guide matched. */
export function howToIndex(): string {
  return `I can walk you through how SSIT CRM works. Pick one:

- *"How do I convert a lead to a client?"*
- *"How do I add a client?"* · *"How do I import from CAMS/KFintech?"*
- *"How do I risk-profile a client?"* · *"How do I build a proposal?"*
- *"How do I set up an automation?"* · *"How do I send a campaign?"*
- *"How do I fix duplicate clients?"* · *"How do I map a family?"*
- *"How do I add a team member?"* · *"How do I schedule a review meeting?"*`;
}
