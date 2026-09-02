# Investor Demo Runbook

This is the repeatable product story for investors, partners and serious MFD prospects. It demonstrates one connected operating system, not a tour of every menu item.

## Prepare

1. Run `npm run migrate:all` and `npm run seed` in an isolated demo environment.
2. Sign in as `owner@demo.in` using the non-production seed credentials.
3. Open `/dashboard/settings/readiness`. Every critical service must be either **Live** or **Configured**. Demo-only providers must be described as demo data; never present them as live integrations.
4. Open `/dashboard/rta-imports` and confirm the data-trust score is suitable for the demonstration.
5. Use a clean browser profile so report favorites, custom navigation and saved filters begin from the default state.

## Twelve-minute story

| Time | Screen | Business point |
|---|---|---|
| 0:00 | My Day | One prioritized operating queue replaces WhatsApp notes and spreadsheets. |
| 1:30 | Lead-to-client lifecycle | Every handoff has a stage owner, SLA and next action. |
| 3:00 | Lead detail | Discovery, communication history and blueprint evidence stay on one record. |
| 4:00 | Calculator meeting pack | Turn an abstract goal into an investor-ready illustration and save it to the client. |
| 5:30 | Proposal and onboarding | Move from advice to documentation, approval and first transaction without re-keying. |
| 7:00 | RTA imports | Show freshness, exceptions and the data-trust score before relying on portfolio totals. |
| 8:30 | Client profile | Show churn signals, audited AI advice, secure portal access and family succession readiness. |
| 10:00 | Workflow monitor | Prove that follow-ups run through consent and compliance gates. |
| 11:00 | Impact attribution | Show AUM protected/generated and SIP impact by workflow, campaign, meeting or team action. |

## Proof metrics

Use numbers from the product, not unsupported claims:

- Open work, SLA breaches and handled actions from **My Day**.
- Lead value and overdue stages from **Lead-to-client lifecycle**.
- Freshness and exception percentage from **RTA file imports**.
- Delivery, consent and compliance outcomes from **Communications**.
- Protected/generated AUM and monthly SIP from **Impact attribution**.
- Audit events for portal access, AI advisory use and recorded business outcomes.

## Mobile ownership

The field-team app owns fast capture: leads, calls, meetings, tasks, attendance, documents, service requests and live calculator conversations. Web owns administration, complex configuration, reconciliation, reporting and workflow design. Investor access uses an expiring portal link; it is not the staff mobile app.

## Reset discipline

The standard seed is idempotent and preserves the demo tenant if it already exists. For a completely fresh story, reset only an isolated demo database, run migrations, then run `npm run seed`. Never run a destructive reset against a customer or shared staging database.
